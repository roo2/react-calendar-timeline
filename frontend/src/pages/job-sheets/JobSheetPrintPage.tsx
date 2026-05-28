import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { ApiError, apiFetch } from '../../api/client'
import { Link, useParams } from 'react-router-dom'
import type { SpecPayload } from '../../components/SpecPayloadForm'
import {
  JobSheetPrintOrderHeader,
  JobSheetPrintPageTitle,
  jobSheetPrintTitleSpreadClassName,
  type JobSheetPrintOrderHeaderModel,
} from './components/JobSheetPrintOrderHeader'
import { conversionPackingModeLabel, deriveConversionPackingMode } from '../../utils/conversionPacking'
import {
  buildExtrusionResinBlendPrintTable,
  coreWeightIncludedKgForBilling,
  formatBlendKgCell,
  formatBlendPct,
  formatExtrusionQty,
  kgPerRollWithCoreWeight,
  type ExtrusionResinBlendComponent,
  type ExtrusionResinBlendPrintTable,
} from '../../utils/extrusionResinBlendPrint'
import {
  CONVERSION_PUNCH_FIELDS,
  formatPunchPrintLines,
  INLINE_PUNCH_FIELDS,
  inlinePunchEnabled,
  punchedConversionEnabledFromConv,
  ventedEnabledFromConv,
} from '../../utils/punchHoleSpec'

/** Film geometry suffix for Uteco “Film Type Supplied” (e.g. …, Gusseted). */
function geometryLabelForUtecoFilmSupplied(dimsGeometry: unknown, productTypeRaw: unknown): string {
  const g = String(dimsGeometry ?? '')
    .trim()
    .toLowerCase()
  const p = String(productTypeRaw ?? '')
    .trim()
    .toLowerCase()
  if (p === 'u-film' || p === 'u_film' || p === 'ufilm') return 'U-Film'
  if (p === 'j-film' || p === 'j_film' || p === 'jfilm') return 'J-Film'
  // Sheet geometry or Sheet product (legacy rows may still have Flat + Sheet product).
  if (p === 'sheet' || g === 'sheet') return 'SWS'
  if (g === 'gusset' || g === 'bottomgusset' || g === 'bottom_gusset') return 'Gusseted'
  if (g === 'centrefold' || g === 'centerfold') return 'Centrefold'
  if (g === 'flat' || g === 'layflat') return 'Layflat'
  const head = displayGeometryHeadline(dimsGeometry)
  return head || ''
}

/** Uteco printed deck table: fixed row count so sheet height does not vary. */
const UTECO_DECK_COLOUR_PRINT_ROWS = 5

function buildUtecoDeckColourRows(
  front: Array<{ ink: string; plate: string; colourText: string }>,
  back: Array<{ ink: string; plate: string; colourText: string }>,
  printSideRaw: unknown,
  _numColoursRaw: unknown,
): Array<{ deck: number; colourText: string; inkCode: string }> {
  const rowParts = (row: { ink: string; plate: string; colourText: string }) => ({
    colourText: String(row.colourText ?? '').trim(),
    inkCode: String(row.ink ?? '').trim(),
  })
  const side = String(printSideRaw ?? '')
    .trim()
    .toLowerCase()
  const collected: Array<{ colourText: string; inkCode: string }> = []
  const pushFront = side === '' || side === 'front' || side === 'both'
  const pushBack = side === 'back' || side === 'both'
  if (pushFront) {
    for (const r of front) {
      collected.push(rowParts(r))
    }
  }
  if (pushBack) {
    for (const r of back) {
      collected.push(rowParts(r))
    }
  }
  const capped = collected.slice(0, UTECO_DECK_COLOUR_PRINT_ROWS)
  const out: Array<{ deck: number; colourText: string; inkCode: string }> = capped.map((r, i) => ({
    deck: i + 1,
    colourText: r.colourText,
    inkCode: r.inkCode,
  }))
  while (out.length < UTECO_DECK_COLOUR_PRINT_ROWS) {
    out.push({ deck: out.length + 1, colourText: '', inkCode: '' })
  }
  return out
}
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'
import { fetchProductSpecBundle } from '../../store/slices/productSpecSlice'
import { fetchQuoteRatebook } from '../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals, computeQuickQuotePreview } from '../../utils/quoteCalculator'
import { buildSpecQuantitySliceFromPersistedJobSheet } from '../../utils/jobSheetQuantityFromApi'
import {
  buildQuickQuoteInputsFromSpec,
  pickRollWeightBillingRaw,
  resolveRollWeightBillingSlug,
  type SpecQuantitySlice,
} from '../../utils/specToQuoteInputs'
import {
  computeProductCodeFromSpec,
  computeProductDescriptionFromSpec,
  productTypeFinishLabel,
} from '../../utils/productDescription'
import { jobSheetDescriptionWithPackagingTail } from '../../utils/quoteQuantityDescriptors'
import { buildJobSheetPrintHeaderSummaryLine } from '../../utils/jobSheetPrintHeaderSummary'
import { fmtCount, fmtQtyNumber } from '../../utils/quoteFormat'
import { derivedInlineSeal, formatSealTypeLabel, inlinePerforatedHighlight } from '../../utils/specCompat'
import {
  formatPrintPositionForPrint,
  isBottomSealType,
  normalizePrintRegistration,
  printPositionHighlight,
  type PrintPositionHighlight,
} from '../../utils/printRegistration'
import { runUpNumericalFromSlug } from '../../utils/runUpNumerical'
import { buildJobSheetPrintQualityCheckLabels, collectQualityFlagIds } from '../../utils/qualityFlagLabels'
import {
  customerFacingDescriptionFromSpec,
  customerOverproductionFromSpec,
  extrusionRollCountForPrint,
  orderQtyPrefsFromJobSheetAndSpec,
} from '../../utils/specOrderDefaults'
import {
  overproductionOptionLabel,
  overproductionPrintHighlight,
} from '../../utils/customerOverproductionHandling'
import { palletsRequiredCeil } from '../../utils/palletShippingEstimate'

function s(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  const t = String(v).trim()
  return t === '' ? fallback : t
}

/** Packed bag/film dimensions for conversion print: e.g. `(300+100)mm x 800Lmm x 45µm` (width uses `mm`, not `Wmm`). */
function formatConversionPackingDimensionShorthand(opts: {
  widthDisplay: string
  baseLengthMm: number | null
  lengthUnitsRaw: string
  thicknessUm: number | null
  gaugeLineFallback: string
}): string {
  const widthStr = String(opts.widthDisplay || '').trim()
  const widthNorm = widthStr.replace(/ \+ /g, '+')
  /** Conversion sheet: show layflat-style width with an `mm` suffix (not `Wmm`). */
  const widthPart = widthNorm !== '' ? `${widthNorm}mm` : ''
  const lenU = String(opts.lengthUnitsRaw || '').trim().toLowerCase()
  const lengthPart =
    lenU !== 'continuous' &&
    opts.baseLengthMm != null &&
    opts.baseLengthMm > 0 &&
    Number.isFinite(opts.baseLengthMm)
      ? `${Math.round(opts.baseLengthMm)}Lmm`
      : ''
  let gaugePart = ''
  if (opts.thicknessUm != null && opts.thicknessUm > 0 && Number.isFinite(opts.thicknessUm)) {
    gaugePart = `${Math.round(opts.thicknessUm)}µm`
  } else {
    const g = String(opts.gaugeLineFallback || '').trim()
    if (g !== '' && g !== '-') {
      const gNum = Number(g)
      gaugePart = Number.isFinite(gNum) && gNum > 0 ? `${Math.round(gNum)}µm` : `${g}µm`
    }
  }
  return [widthPart, lengthPart, gaugePart].filter(Boolean).join(' x ')
}

function n(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function normalizeHex(v: unknown): string | null {
  const t = String(v ?? '').trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(t) ? t : null
}

function textColorForHex(hex: string): string {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 160 ? '#111111' : '#FFFFFF'
}

/** Matches {@link ProductVersionSummary} / spec slugs like `2up`. */
function displayRunUp(slug: unknown): string {
  if (slug == null || slug === '' || slug === 'none') return ''
  const str = String(slug)
  if (str === '1up' || str === '2up' || str.endsWith('up')) return str.replace('up', ' up')
  return str
}

/** Matches labels in {@link SpecPayloadForm} slit select. */
function displaySlit(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '',
    none: 'None',
    one_side: 'Slit one side',
    both_sides: 'Slit both sides',
    middle: 'Slit up middle',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '')
}

/** Matches labels in {@link SpecPayloadForm} treat inside/outside select. */
function displayTreat(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '',
    none: 'None',
    inside: 'Inside',
    outside: 'Outside',
    both_sides: 'Inside and Outside',
    both: 'Inside and Outside',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '')
}

type InlinePunchPrintLines = {
  summary: string
  position: string
  holeSizeMm: number
  highlightHoleSize: boolean
}

type ExtrusionRunFlag = {
  key: string
  label: string
  value: string
  valueClassName?: string
  valueNode?: ReactNode
  flagClassName?: string
}

/** Job sheet print: yellow for emphasis; pink reserved for punch hole size ≠ 6mm and treat both sides. */
function jobSheetPrintPositionHighlightClass(kind: PrintPositionHighlight): string | undefined {
  if (kind === 'none') return undefined
  return 'js-yellow'
}

/** Non-default extrusion run flags only (for print spec line). */
function buildExtrusionRunFlags(input: {
  runUpLine: string
  slit: string
  treat: string
  treatHighlight: 'inside' | 'outside' | 'both' | ''
  shrink: boolean
  inlineSeal: boolean
  inlinePerforated: boolean
  inlinePunched: boolean
  inlinePunchPrint: InlinePunchPrintLines | null
  widthToleranceDisplay: string
  widthToleranceHighlight: boolean
  gaugeTrimDisplay: string
  gaugeTrimExplicit: boolean
  vented: boolean
}): ExtrusionRunFlag[] {
  const flags: ExtrusionRunFlag[] = []
  const hl = printHlValueClass('js-yellow')

  const runUp = String(input.runUpLine ?? '').trim()
  if (runUp && runUp !== '-' && runUp.toLowerCase() !== 'none') {
    flags.push({ key: 'runUp', label: 'Run up', value: runUp, valueClassName: hl })
  }

  const slit = String(input.slit ?? '').trim()
  if (slit && slit.toLowerCase() !== 'none') {
    flags.push({ key: 'slit', label: 'Slit', value: slit, valueClassName: hl })
  }

  const treat = String(input.treat ?? '').trim()
  if (treat && treat.toLowerCase() !== 'none') {
    flags.push({
      key: 'treat',
      label: 'Treat',
      value: treat,
      valueClassName:
        input.treatHighlight === 'both' ? printHlValueClass('js-pink') : hl,
    })
  }

  if (input.shrink) {
    flags.push({ key: 'shrink', label: 'Shrink', value: 'Yes', valueClassName: hl })
  }
  if (input.inlineSeal) {
    flags.push({ key: 'inlineSeal', label: 'Inline Seal', value: 'Yes', valueClassName: hl })
  }
  if (input.inlinePerforated) {
    flags.push({ key: 'inlinePerf', label: 'Inline perf', value: 'Yes', valueClassName: hl })
  }
  if (input.widthToleranceHighlight && String(input.widthToleranceDisplay ?? '').trim()) {
    flags.push({
      key: 'widthTol',
      label: 'Width tolerance',
      value: input.widthToleranceDisplay,
      valueClassName: hl,
    })
  }
  if (input.gaugeTrimExplicit && String(input.gaugeTrimDisplay ?? '').trim()) {
    flags.push({
      key: 'trim',
      label: 'Trim',
      value: input.gaugeTrimDisplay,
      valueClassName: hl,
    })
  }
  if (input.vented) {
    flags.push({ key: 'vented', label: 'Vented', value: 'Yes', valueClassName: hl })
  }
  if (input.inlinePunched) {
    const punch = input.inlinePunchPrint
    const hasDetail =
      punch != null &&
      (String(punch.summary ?? '').trim() !== '' || String(punch.position ?? '').trim() !== '')
    if (hasDetail && punch) {
      flags.push({
        key: 'inlinePunch',
        label: 'Inline punched',
        value: '',
        flagClassName: 'js-extrusion-run-flag--inline-punch',
        valueNode: (
          <ExtrusionInlinePunchFlagValue
            summary={punch.summary}
            position={punch.position}
            holeSizeMm={punch.holeSizeMm}
            highlightHoleSize={punch.highlightHoleSize}
          />
        ),
      })
    } else {
      flags.push({ key: 'inlinePunch', label: 'Inline punched', value: 'Yes', valueClassName: hl })
    }
  }

  return flags
}

/** Matches `SpecPayloadForm` resin blend dropdown (House LD vs custom / other presets). */
function displayBlendTypeLabel(blendType: unknown): string {
  const c = String(blendType ?? '').trim()
  if (c === '' || c === 'LD') return 'House Blend (LD)'
  if (c === 'Custom') return 'Custom'
  return c
}

/** Same row filter as {@link ProductVersionSummary} (catalog codes only — legacy summary). */
function meaningfulInkPlateRows(pairs: unknown): Array<{ ink: string; plate: string }> {
  return (Array.isArray(pairs) ? pairs : [])
    .map((r: { ink_code?: unknown; plate_code?: unknown }) => ({
      ink: (r?.ink_code ?? '').toString().trim(),
      plate: (r?.plate_code ?? '').toString().trim(),
    }))
    .filter((row) => row.ink || row.plate)
}

/** Job sheet print + forms: include free-text colour notes like the printing dialog. */
function meaningfulInkPlatePrintRows(pairs: unknown): Array<{ ink: string; plate: string; colourText: string }> {
  return (Array.isArray(pairs) ? pairs : [])
    .map((r: { ink_code?: unknown; plate_code?: unknown; ink_text?: unknown }) => ({
      ink: (r?.ink_code ?? '').toString().trim(),
      plate: (r?.plate_code ?? '').toString().trim(),
      colourText: (r?.ink_text ?? '').toString().trim(),
    }))
    .filter((row) => row.ink || row.plate || row.colourText)
}

function formatPrintSide(side: unknown): string {
  const x = String(side ?? 'front')
    .trim()
    .toLowerCase()
  if (x === 'front') return 'Front'
  if (x === 'back') return 'Back'
  if (x === 'both') return 'Both'
  return s(side)
}

function yn(v: unknown): string {
  return v ? 'Y' : 'N'
}

function valueOrDash(v: unknown): string {
  const t = String(v ?? '').trim()
  return t === '' ? '-' : t
}

/** Print form value: empty string renders as non-breaking space (no em dash) — unset ≠ voided. */
function printFormValueOrNbsp(v: unknown): string {
  const t = String(v ?? '').trim()
  return t === '' ? '\u00a0' : t
}

function formatEyeSpot(v: unknown): string {
  const x = String(v ?? '').trim().toLowerCase()
  if (x === '') return ''
  if (x === 'yes') return 'Yes'
  if (x === 'no') return 'No'
  return s(v)
}

function formatKgPerRoll(kprNum: number | null): string {
  return kprNum != null && kprNum > 0 && Number.isFinite(kprNum) ? `${formatExtrusionQty(kprNum)}kg/roll` : ''
}

/** Highlight background on print values — pair with js-pink, js-yellow, etc. */
function printHlValueClass(...highlights: Array<string | undefined | false>): string | undefined {
  const parts = highlights.filter(Boolean) as string[]
  if (parts.length === 0) return undefined
  return ['js-hl-value', ...parts].join(' ')
}

function perRollQtyDisplay(formatted: string): string {
  const t = String(formatted ?? '').trim()
  if (!t) return '-'
  return t.replace(/\/roll$/i, '')
}

/** Print model for extrusion spec quantity lines (ordered / per-roll). */
type JobSheetPrintExtrusionQuantitiesModel = {
  orderedM: string
  orderedKg: string
  highlightOrderedM: boolean
  highlightOrderedKg: boolean
  mPerRollFormatted: string
  /** KG/roll including core mass (extrusion spec line). */
  kgPerRollWithCoreFormatted: string
  coreWeightIncludedKg: number | null
  extruderOutputRollCount: number
}

function formatExtruderCodeForPrint(label: string): string {
  const t = String(label ?? '').trim()
  if (t === '') return ''
  if (t.startsWith('#')) return t
  if (/^\d+$/.test(t)) return `#${t}`
  return t
}

function JobSheetPrintResinBlendTable(props: { table: ExtrusionResinBlendPrintTable }): ReactNode {
  const { table } = props
  return (
    <tr>
      <td
        colSpan={6}
        className={`js-resin-blend-table-wrap js-resin-mix-blend--${table.variant} js-resin-spec-cell js-resin-spec-first js-resin-spec-last`}
      >
        {table.caption ? <div className="js-resin-mix-blend-caption">{table.caption}</div> : null}
        <table className="js-resin-blend-table" role="presentation">
          <thead>
            <tr>
              <th className="js-resin-blend-col-resin">Resin</th>
              <th className="js-resin-blend-col-pct">%</th>
              <th className="js-resin-blend-col-kg">KG</th>
              <th className="js-resin-blend-col-waste">Waste</th>
              <th className="js-resin-blend-col-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key}>
                <td
                  className={`js-resin-blend-col-resin${row.bgHex ? ' js-resin-blend-col-resin--hl' : ''}`}
                  style={
                    row.bgHex
                      ? {
                          backgroundColor: row.bgHex,
                          color: row.textColor || undefined,
                        }
                      : undefined
                  }
                >
                  {row.label}
                </td>
                <td className="js-resin-blend-col-pct">{formatBlendPct(row.pct)}</td>
                <td className="js-resin-blend-col-kg">{formatBlendKgCell(row.kg)}</td>
                <td className="js-resin-blend-col-waste">{formatBlendKgCell(row.wasteKg)}</td>
                <td className="js-resin-blend-col-total">{formatBlendKgCell(row.totalKg, { withSuffix: true })}</td>
              </tr>
            ))}
            <tr className="js-resin-blend-total-row">
              <td className="js-resin-blend-col-resin">Total</td>
              <td className="js-resin-blend-col-pct">{formatBlendPct(table.totalPct)}</td>
              <td className="js-resin-blend-col-kg">{formatBlendKgCell(table.totalProductiveKg, { withSuffix: true })}</td>
              <td className="js-resin-blend-col-waste">{formatBlendKgCell(table.totalWasteKg, { withSuffix: true })}</td>
              <td className="js-resin-blend-col-total">{formatBlendKgCell(table.totalExtrudedKg, { withSuffix: true })}</td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  )
}

function displayGeometryLabel(raw: unknown): string {
  const label = s(raw)
  if (label === '') return ''
  const normalized = label.trim().toLowerCase()
  if (normalized === 'flat') return 'Layflat'
  if (normalized === 'centerfold') return 'Centrefold'
  if (normalized === 'sheet') return 'Sheet'
  return label
}

function displayGeometryHeadline(raw: unknown): string {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'flat' || normalized === 'layflat') return 'Layflat'
  if (normalized === 'gusset' || normalized === 'bottomgusset' || normalized === 'bottom_gusset') return 'Gusseted'
  if (normalized === 'centrefold' || normalized === 'centerfold') return 'Centrefold'
  if (normalized === 'u_film' || normalized === 'ufilm') return 'Ufilm'
  if (normalized === 'j_film' || normalized === 'jfilm') return 'Jfilm'
  if (normalized === 'sheet') return 'SWS'
  return displayGeometryLabel(raw)
}

/** Matches {@link SpecPayloadForm} `intOrDash` for film / bag readouts. */
function intOrDashJob(n: unknown): string {
  if (n == null || n === '') return ''
  const x = typeof n === 'number' ? n : Number(String(n).trim())
  return Number.isFinite(x) && x > 0 ? String(Math.round(x)) : ''
}

/** Same string as the printing-details modal “Film type supplied”. */
function formatJobSheetFilmSuppliedFromSpec(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const um = dims.thickness_um
  if (w == null || um == null) return ''
  const geom = String(dims.geometry || '')
  const productType = String(spec?.identity?.product_type ?? '')
  const gusset = Number(dims.gusset_mm || 0) > 0
  const geoTag =
    geom === 'Gusset' || geom === 'BottomGusset' || gusset
      ? 'G'
      : geom === 'CentreFold'
        ? 'C/F'
        : geom === 'Sheet' || productType === 'Sheet'
          ? 'SWS'
          : 'L/F'
  return `${intOrDashJob(w)}mm ${intOrDashJob(um)}µm ${geoTag}`
}

/** Same string as the printing-details modal “Finished bag size”. */
function formatJobSheetFinishedBagSizeFromSpec(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const l = dims.base_length_mm
  const um = dims.thickness_um
  if (w == null) return ''
  const parts = [`${intOrDashJob(w)}mm`]
  if (l != null) parts.push(`${intOrDashJob(l)}mm`)
  if (um != null) parts.push(`${intOrDashJob(um)}µm`)
  return parts.join(' × ')
}

/** Compact full-width ink table for Inline printing job sheet. */
function JobSheetPrintInlineInkTable(props: { rows: Array<{ ink: string; plate: string; colourText: string }> }): ReactNode {
  const { rows } = props
  if (rows.length === 0) return <div className="js-print-form-v">—</div>
  return (
    <table className="js-print-inline-ink-table" role="presentation">
      <thead>
        <tr>
          <th className="js-print-inline-ink-th-deck">#</th>
          <th>Colour</th>
          <th className="js-print-inline-ink-th-plate">Plate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const hasColour = Boolean(String(r.colourText ?? '').trim())
          const hasInk = Boolean(String(r.ink ?? '').trim())
          const plate = String(r.plate ?? '').trim()
          return (
            <tr key={`${r.ink}-${r.plate}-${r.colourText}-${i}`}>
              <td className="js-print-inline-ink-td-deck">{i + 1}</td>
              <td className="js-print-inline-ink-td-colour">
                {hasColour ? <span className="js-print-pre">{r.colourText}</span> : null}
                {hasInk ? (
                  <span className="js-print-inline-ink-code">{hasColour ? ` (${r.ink})` : r.ink}</span>
                ) : !hasColour ? (
                  '—'
                ) : null}
              </td>
              <td className="js-print-inline-ink-td-plate">{plate || '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function JobSheetPrintPrintingFormShell(props: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="js-print-printing-form">
      <div className="js-print-printing-form-title">{props.title}</div>
      <div className="js-print-printing-form-body">{props.children}</div>
    </div>
  )
}

function JobSheetPrintPrintingFormField(props: {
  label: string
  children: ReactNode
  positionHighlight?: PrintPositionHighlight
}): ReactNode {
  const hl = jobSheetPrintPositionHighlightClass(props.positionHighlight ?? 'none')
  return (
    <div className="js-print-form-field">
      <span className="js-print-form-k">{props.label}</span>
      <div className={`js-print-form-v${hl ? ` ${hl}` : ''}`}>{props.children}</div>
    </div>
  )
}

function JobSheetPrintArtworkFileList(props: { names: string[] }): ReactNode {
  if (!props.names.length) return <>—</>
  return (
    <ul className="js-print-artwork-file-list">
      {props.names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  )
}

function JobSheetPrintWorkflowPanel(props: {
  jobSheetId: string
  files: Array<{ id: string; filename: string }>
  onPrintJobSheet: () => void
}): ReactNode {
  const { jobSheetId, files, onPrintJobSheet } = props
  const [busyFileId, setBusyFileId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function openArtworkPdf(fileId: string) {
    setErr(null)
    setBusyFileId(fileId)
    try {
      const res = await apiFetch<{ url: string }>(
        `/api/job-sheets/${encodeURIComponent(jobSheetId)}/printing-artwork/${encodeURIComponent(fileId)}/download-url`,
      )
      if (!res?.url) throw new Error('No download URL returned')
      window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to open PDF')
    } finally {
      setBusyFileId(null)
    }
  }

  return (
    <Box className="no-print js-print-workflow-panel" sx={{ mb: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
        How to print this job
      </Typography>

      {err ? (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      ) : null}

      <Stack spacing={1.5}>
        <Box
          sx={{
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between',gap: 2, alignItems: 'center' }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                Step 1 — Print the job sheet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Print this page first (all sections below: extrusion, printing details, QC, conversion, etc.).
              </Typography>
            </Stack>
            <Box sx={{ flexShrink: 0 }}>
              <Button type="button" variant="contained" color="primary" onClick={onPrintJobSheet}>
                Print job sheet
              </Button>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
            Step 2 — Print each artwork PDF
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: '550px' }}>
            Open each PDF below and use the browser&apos;s print command (e.g.{' '}
            <strong>Ctrl+P</strong>) on that PDF.
          </Typography>
          <Stack spacing={1}>
            {files.map((f, idx) => (
              <Box
                key={f.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {idx + 1}. {f.filename}
                </Typography>
                <Button
                  type="button"
                  size="small"
                  variant="contained"
                  disabled={busyFileId !== null}
                  onClick={() => void openArtworkPdf(f.id)}
                >
                  {busyFileId === f.id ? 'Opening…' : 'Open PDF to print'}
                </Button>
              </Box>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}


function JobSheetPrintInlinePrintingBlock(props: {
  p: {
    printDescription: string
    numColours: string
    printSide: string
    printPosition: string
    printPositionHighlight: PrintPositionHighlight
    artworkPdfNames: string[]
    frontRows: Array<{ ink: string; plate: string; colourText: string }>
    backRows: Array<{ ink: string; plate: string; colourText: string }>
    legacyInkPlate: string | null
    cylinder: string
    platesAround: string
    platesAcross: string
  }
}): ReactNode {
  const { p } = props
  const showFrontPrint = p.frontRows.length > 0
  const showBackPrint = p.backRows.length > 0

  return (
    <div className="js-print-inline-block-wrap">
      <JobSheetPrintPrintingFormShell title="Inline printing">
        <JobSheetPrintPrintingFormField label="Print description">
          {p.printDescription ? <span className="js-print-pre">{p.printDescription}</span> : '—'}
        </JobSheetPrintPrintingFormField>
        <div className="js-print-form-row-3">
          <JobSheetPrintPrintingFormField label="Cylinder">{printFormValueOrNbsp(p.cylinder)}</JobSheetPrintPrintingFormField>
          <JobSheetPrintPrintingFormField label="Around">{printFormValueOrNbsp(p.platesAround)}</JobSheetPrintPrintingFormField>
          <JobSheetPrintPrintingFormField label="Across">{printFormValueOrNbsp(p.platesAcross)}</JobSheetPrintPrintingFormField>
        </div>
        <div className="js-print-form-row-2">
          <JobSheetPrintPrintingFormField label="No. colours">{valueOrDash(p.numColours)}</JobSheetPrintPrintingFormField>
          <JobSheetPrintPrintingFormField label="Print side">{valueOrDash(p.printSide)}</JobSheetPrintPrintingFormField>
        </div>
        <JobSheetPrintPrintingFormField label="Print position" positionHighlight={p.printPositionHighlight}>
          {p.printPosition ? <span className="js-print-pre">{p.printPosition}</span> : '—'}
        </JobSheetPrintPrintingFormField>
        {p.artworkPdfNames.length > 0 ? (
          <JobSheetPrintPrintingFormField label="Artwork files">
            <JobSheetPrintArtworkFileList names={p.artworkPdfNames} />
          </JobSheetPrintPrintingFormField>
        ) : null}
        {showFrontPrint? (
          <div>
            <span className="js-print-form-k">Front print</span>
            <JobSheetPrintInlineInkTable rows={p.frontRows} />
          </div>
        ) : null}
        {showBackPrint ? (
          <div>
            <span className="js-print-form-k">Back print</span>
            <JobSheetPrintInlineInkTable rows={p.backRows} />
          </div>
        ) : null}
        {p.legacyInkPlate ? (
          <JobSheetPrintPrintingFormField label="Legacy ink / plate codes">
            <span className="js-print-pre">{p.legacyInkPlate}</span>
          </JobSheetPrintPrintingFormField>
        ) : null}
      </JobSheetPrintPrintingFormShell>
    </div>
  )
}

function JobSheetPrintUtecoField(props: {
  label: string
  children: ReactNode
  /** Extra classes on the value line (e.g. barcode monospace). */
  valueClass?: string
}): ReactNode {
  const vc = props.valueClass ? ` ${props.valueClass}` : ''
  return (
    <div className="js-print-uteco-field">
      <div className="js-print-uteco-label">{props.label}</div>
      <div className={`js-print-uteco-value${vc}`}>{props.children}</div>
    </div>
  )
}

function JobSheetPrintUtecoPage(props: {
  u: {
    customer: string
    productDescription: string
    printDescription: string
    jobNumber: string
    orderDate: string
    dueDate: string
    barcode: string
    cylinder: string
    platesAround: string
    platesAcross: string
    numColours: string
    printSide: string
    totalMeters: string
    printPosition: string
    printPositionHighlight: PrintPositionHighlight
    filmTypeSupplied: string
    finishedBagSize: string
    sealTypeLabel: string
    eyeSpotLabel: string
    artworkPdfNames: string[]
    deckColours: Array<{ deck: number; colourText: string; inkCode: string }>
  }
}): ReactNode {
  const { u } = props
  const blankLine = '\u00a0'
  const emDash = '—'
  return (
    <div className="js-print-uteco-sheet">
      <div className="js-print-uteco-card">
        <div className="js-print-uteco-cyl-grid">
          <JobSheetPrintUtecoField label="Cylinder">{u.cylinder.trim() ? u.cylinder : blankLine}</JobSheetPrintUtecoField>
          <JobSheetPrintUtecoField label="Around">{u.platesAround.trim() ? u.platesAround : blankLine}</JobSheetPrintUtecoField>
          <JobSheetPrintUtecoField label="Across">{u.platesAcross.trim() ? u.platesAcross : blankLine}</JobSheetPrintUtecoField>
        </div>
        <div className="js-print-uteco-split-grid">
          <JobSheetPrintUtecoField label="Colours">
            {u.numColours.trim() ? `(${u.numColours.trim()})` : emDash}
          </JobSheetPrintUtecoField>
          <JobSheetPrintUtecoField label="Side(s)">{u.printSide.trim() ? u.printSide : blankLine}</JobSheetPrintUtecoField>
        </div>
        <JobSheetPrintUtecoField label="Total meters">{u.totalMeters || blankLine}</JobSheetPrintUtecoField>
        <JobSheetPrintUtecoField
          label="Print position"
          valueClass={jobSheetPrintPositionHighlightClass(u.printPositionHighlight)}
        >
          <span className="js-print-pre">{u.printPosition.trim() ? u.printPosition : blankLine}</span>
        </JobSheetPrintUtecoField>
        {u.artworkPdfNames.length > 0 ? (
          <JobSheetPrintUtecoField label="Artwork files">
            <JobSheetPrintArtworkFileList names={u.artworkPdfNames} />
          </JobSheetPrintUtecoField>
        ) : null}
      </div>

      <div className="js-print-uteco-card">
        <JobSheetPrintUtecoField label="Film type supplied">{u.filmTypeSupplied || blankLine}</JobSheetPrintUtecoField>
        <JobSheetPrintUtecoField label="Finished bag size">{u.finishedBagSize || blankLine}</JobSheetPrintUtecoField>
      </div>

      <div className="js-print-uteco-card">
        <div className="js-print-uteco-2col">
          <div className="js-print-uteco-col">
            <div className="js-print-uteco-label js-print-uteco-label--table">Deck colours</div>
            <table className="js-print-uteco-deck-table" role="presentation">
              <thead>
                <tr>
                  <th style={{ width: '100px' }}>#</th>
                  <th>Colour</th>
                </tr>
              </thead>
              <tbody>
                {u.deckColours.map((r) => (
                  <tr key={r.deck}>
                    <td>
                      <div className="js-print-uteco-table-value">{r.deck}</div>
                    </td>
                    <td>
                      <div className="js-print-uteco-table-value">
                        {r.colourText || r.inkCode ? (
                          <>
                            {r.colourText ? (
                              <span className="js-print-pre js-print-deck-colour-freetext">{r.colourText}</span>
                            ) : null}
                            {r.inkCode ? (
                              <span
                                className={
                                  r.colourText
                                    ? 'js-print-deck-ink-code js-print-deck-ink-code--paired'
                                    : 'js-print-deck-ink-code'
                                }
                              >
                                {r.colourText ? ` (${r.inkCode})` : r.inkCode}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          blankLine
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="js-print-uteco-col js-print-uteco-col-right">
            <JobSheetPrintUtecoField label="Seal type">{u.sealTypeLabel}</JobSheetPrintUtecoField>
            <JobSheetPrintUtecoField label="Eye spot">{u.eyeSpotLabel}</JobSheetPrintUtecoField>
          </div>
        </div>
      </div>
    </div>
  )
}

type JobSheetPrintShippingModel = {
  palletType: string
  finishModeKey: string
  rollsPerPallet: string
  cartonsPerPallet: string
  orderUnitsForPallets: string
  orderUnitsLabel: string
  palletsRequired: string
  palletChecklistCount: number
  packingNotes: string
  overproductionAcceptLabel: string
  overproductionHighlightClass: string | undefined
}

function JobSheetPrintShippingDetailsTable(props: { ship: JobSheetPrintShippingModel }): ReactNode {
  const { ship } = props
  const highlightPalletType = ship.palletType.trim().toLowerCase() !== 'chep'
  return (
    <table className="js-grid js-print-table-shipping ">
      <tbody>
        <tr>
          <td className="js-sec" colSpan={4}>
            Packing details
          </td>
        </tr>
        <tr>
          <th className={highlightPalletType ? 'js-yellow' : undefined} style={{ width: '15%' }}>Pallet type</th>
          <td className={highlightPalletType ? 'js-yellow' : undefined} style={{ width: '35%' }}>{ship.palletType || '—'}</td>
          <th style={{ width: '15%' }}>{ship.finishModeKey === 'cartons' ? 'Cartons per pallet' : 'Rolls per pallet'}</th>
          <td style={{ width: '35%' }}>
            {ship.finishModeKey === 'cartons' ? ship.cartonsPerPallet || '—' : ship.rollsPerPallet || '—'}
          </td>
        </tr>
        <tr>
          <th>{ship.orderUnitsLabel}</th>
          <td>
            <span>{ship.orderUnitsForPallets || '—'}</span>
            {ship.overproductionAcceptLabel.trim() ? (
              <span
                className={
                  ship.overproductionHighlightClass
                    ? `js-ship-overproduction ${ship.overproductionHighlightClass}`
                    : 'js-ship-overproduction'
                }
              >
                {ship.overproductionAcceptLabel}
              </span>
            ) : null}
          </td>
          <th>Pallets required</th>
          <td>{ship.palletsRequired || '—'}</td>
        </tr>
        <tr>
          <th>{ship.finishModeKey === 'cartons' ? 'Cartons to ship' : 'Rolls to ship'}</th>
          <td>{'\u00a0'}</td>
          <th>{ship.finishModeKey === 'cartons' ? 'Cartons to stock' : 'Rolls to stock'}</th>
          <td>{'\u00a0'}</td>
        </tr>
        {ship.packingNotes.trim() || ship.palletChecklistCount > 0 ? (
          <tr>
            <td colSpan={4} className="js-ship-pallet-checklist-cell">
              {ship.packingNotes.trim() ? (
                <div className="js-ship-packing-notes-text js-print-pre-wrap js-yellow">{ship.packingNotes}</div>
              ) : null}
              {ship.palletChecklistCount > 0 ? (
                <div
                  className="js-ship-pallet-checklist"
                  aria-label="Pallet checklist"
                  style={ship.packingNotes.trim() ? { marginTop: '8px' } : undefined}
                >
                  {Array.from({ length: ship.palletChecklistCount }, (_, i) => (
                    <div key={i} className="js-ship-pallet-tick">
                      P{i + 1}
                    </div>
                  ))}
                </div>
              ) : null}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

type JobSheetPrintConversionModel = {
  carton: { bagsPerCarton: string; totalCartons: string } | null
  conversionNotes: string
  conversion: {
    sealType: string
    sealWatertightCritical: boolean
    cartonSize: string
    packing: string
    qtyPerFold: string
    qtyPerPack: string
    tagPacks: string
    tagCtn: string
    ventSummary: string
    ventPosition: string
    ventHoleSizeMm: number
    highlightVentHoleSize: boolean
    handle: string
    linedCartons: string
    highlightSeal?: boolean
    highlightCartonSize?: boolean
    highlightPacking?: boolean
    highlightQtyPerFold?: boolean
    highlightQtyPerPack?: boolean
    highlightTagPacks?: boolean
    highlightTagCtn?: boolean
    highlightVent?: boolean
    vented: string
    highlightVented?: boolean
    highlightHandle?: boolean
    highlightLinedCartons?: boolean
    printPositionDetails?: string
    printPositionDetailsHighlight?: PrintPositionHighlight
  } | null
}

/**
 * Extruder output row counts per printed page (A4, ~4mm @page margin).
 * First page shares space with order header, qty grid, settings, and QC checklist.
 * Continuation pages are mostly table rows (~40/page). Browser print margin headers
 * cannot be set to custom job titles from the app (dialog-only); chunking + repeat
 * title blocks are used instead.
 */
const EXTRUDER_OUTPUT_ROWS_FIRST_PAGE = 12
const EXTRUDER_OUTPUT_ROWS_PER_CONTINUATION_PAGE = 40

function chunkExtruderRollIndices(rollCount: number): number[][] {
  if (rollCount <= 0) return []
  const chunks: number[][] = []
  const pushRange = (from: number, to: number) => {
    const chunk: number[] = []
    for (let i = from; i < to; i++) chunk.push(i)
    chunks.push(chunk)
  }
  const firstEnd = Math.min(EXTRUDER_OUTPUT_ROWS_FIRST_PAGE, rollCount)
  pushRange(0, firstEnd)
  for (let start = firstEnd; start < rollCount; start += EXTRUDER_OUTPUT_ROWS_PER_CONTINUATION_PAGE) {
    pushRange(start, Math.min(start + EXTRUDER_OUTPUT_ROWS_PER_CONTINUATION_PAGE, rollCount))
  }
  return chunks
}

function JobSheetPrintExtrusionQcPage(props: {
  titleHighlight: JobSheetPrintOrderHeaderModel['titleHighlight']
  header: JobSheetPrintOrderHeaderModel['header']
  product: JobSheetPrintOrderHeaderModel['product']
  extruderOutputRollCount: number
}): ReactNode {
  const { titleHighlight, header, product, extruderOutputRollCount } = props
  const extruderRollChunks = chunkExtruderRollIndices(extruderOutputRollCount)
  const extruderTitleClass = `${jobSheetPrintTitleSpreadClassName(titleHighlight, 'js-title--extruder-repeat')}`
  return (
    <div className="js-print-extrusion-qc-sheet">
      <JobSheetPrintOrderHeader
        titleHighlight={titleHighlight}
        header={header}
        product={product}
      />

      <table className="js-grid js-extruder-settings-table">
        <tbody>
          <tr>
            <td className="js-sec" colSpan={12}>
              Extruder settings
            </td>
          </tr>
          <tr>
            <th>{'\u00a0'}</th>
            <th>Extruder</th>
            <th>Start Time</th>
            <th>Screw Speed</th>
            <th>Nip Speed</th>
            <th>Blower %</th>
            <th colSpan={2}>Nip Roller Tension/Speed</th>
            <th colSpan={2}>Winder Tension/Speed</th>
            <th>Inline Temp</th>
            <th>Seal Time</th>
          </tr>
          <tr>
            <th>Run 1</th>
            {Array.from({ length: 11 }, (_, i) => (
              <td key={`extruder-settings-run1-${i}`}>{'\u00a0'}</td>
            ))}
          </tr>
          <tr>
            <th>Run 2</th>
            {Array.from({ length: 11 }, (_, i) => (
              <td key={`extruder-settings-run2-${i}`}>{'\u00a0'}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <table className="js-grid js-extrusion-details-table">
        <tbody>
          <tr>
            <td className="js-sec" colSpan={6}>
              Extrusion details
            </td>
          </tr>
          <tr>
            <th>Start Date</th>
            <td>{'\u00a0'}</td>
            <th>Start Time</th>
            <td>{'\u00a0'}</td>
            <th>Sign</th>
            <td>{'\u00a0'}</td>
          </tr>
          <tr>
            <th>Finish Date</th>
            <td>{'\u00a0'}</td>
            <th>Finish Time</th>
            <td>{'\u00a0'}</td>
            <th>Sign</th>
            <td>{'\u00a0'}</td>
          </tr>
          <tr>
            <th>Setup Waste</th>
            <td>{'\u00a0'}</td>
            <th>Purge Waste</th>
            <td>{'\u00a0'}</td>
            <th>Other Waste</th>
            <td>{'\u00a0'}</td>
          </tr>
          <tr>
            <th>Notes</th>
            <td colSpan={5} className="js-extrusion-details-notes">
              {'\u00a0'}
            </td>
          </tr>
        </tbody>
      </table>
      <table className="js-grid js-qc-checklist" role="presentation">
        <tbody>
          <tr>
            <td colSpan={6} className="js-qc-title">
              Quality control checklist
            </td>
          </tr>
          <tr>
            <th className="js-qc-check-for" scope="col" colSpan={2}>
              Check for:
            </th>
            <th className="js-qc-wi" scope="col">
              WI
            </th>
            <th className="js-qc-narrow" scope="col">
              Pass / Fail ?
            </th>
            <th className="js-qc-narrow" scope="col">
              Sign
            </th>
            <th className="js-qc-narrow" scope="col">
              Date
            </th>
          </tr>
          <tr>
            <td className="js-qc-check-for" colSpan={2}>1. Check correct raw material spec</td>
            <td className="js-qc-wi">WI-01</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
          </tr>
          <tr>
            <td className="js-qc-check-for" colSpan={2}>{`2. Check spec's of Width/Length/um & Film Quality`}</td>
            <td className="js-qc-wi">WI-01/10</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
          </tr>
          <tr>
            <td className="js-qc-check-for" colSpan={2}>3. Check colour of film</td>
            <td className="js-qc-wi">WI-01</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
            <td className="js-qc-narrow">{'\u00a0'}</td>
          </tr>
          <tr>
            <td colSpan={6} className="js-qc-details-label">
              Details of changes/Variations/Concessions:
            </td>
          </tr>
        </tbody>
      </table>
      <table className="js-grid">
        <tbody>
          <tr>
            <td className="js-sec" colSpan={6}>
              Extruder output
            </td>
          </tr>
          <tr>
            <td colSpan={6} className="js-manual-wrap">
              {extruderRollChunks.map((rollIndices, chunkIdx) => (
                <div key={`extruder-out-chunk-${chunkIdx}`} className="js-extruder-output-chunk">
                  {chunkIdx > 0 ? (
                    <>
                      <div className="js-print-page-break" />
                      <JobSheetPrintPageTitle header={header} product={product} className={extruderTitleClass} />
                    </>
                  ) : null}
                  <table className="js-extruder-output-table js-extruder-output-table--pageable" role="presentation">
                    <thead>
                      <tr>
                        <th>Roll No.</th>
                        <th>Operator</th>
                        <th>Kgs/Roll</th>
                        <th>Mts/Roll</th>
                        <th>Width (mm)</th>
                        <th>Gauge</th>
                        <th>QC Check</th>
                        <th>Remark</th>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Adjustments</th>
                        <th>Checked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollIndices.map((rollIdx) => (
                        <tr key={`extruder-out-qc-${rollIdx}`}>
                          <td>{rollIdx + 1}</td>
                          {Array.from({ length: 11 }, (_, c) => (
                            <td key={`extruder-out-qc-${rollIdx}-c-${c}`}>{'\u00a0'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function InlinePunchSummaryInline(props: {
  summary: string
  holeSizeMm: number
  highlightHoleSize: boolean
}): ReactNode {
  const summary = String(props.summary ?? '').trim()
  if (!summary) return null
  if (!props.highlightHoleSize) return <>{summary}</>
  const prefix = `${props.holeSizeMm}mm`
  const rest = summary.startsWith(prefix) ? summary.slice(prefix.length) : summary
  return (
    <>
      <span className="js-pink">{prefix}</span>
      {rest}
    </>
  )
}

function ExtrusionInlinePunchFlagValue(props: InlinePunchPrintLines): ReactNode {
  const summary = String(props.summary ?? '').trim()
  const position = String(props.position ?? '').trim()
  if (!summary && !position) return <>Yes</>
  return (
    <span className={`js-extrusion-inline-punch-cell ${printHlValueClass('js-yellow') ?? ''}`}>
      {summary ? (
        <InlinePunchSummaryInline
          summary={summary}
          holeSizeMm={props.holeSizeMm}
          highlightHoleSize={props.highlightHoleSize}
        />
      ) : null}
      {summary && position ? <span className="js-extrusion-inline-punch-sep"> · </span> : null}
      {position ? <span className="js-extrusion-inline-punch-position">{position}</span> : null}
    </span>
  )
}

function VentSummaryPrintLine(props: { summary: string; holeSizeMm: number; highlightHoleSize: boolean }) {
  const summary = String(props.summary ?? '').trim()
  if (!summary) return null
  if (!props.highlightHoleSize) return <div>{summary}</div>
  const prefix = `${props.holeSizeMm}mm`
  const rest = summary.startsWith(prefix) ? summary.slice(prefix.length) : summary
  return (
    <div>
      <span className="js-pink">{prefix}</span>
      {rest}
    </div>
  )
}

function JobSheetPrintConversionInstructionsPage(props: {
  conv: JobSheetPrintConversionModel
  orderHeader: JobSheetPrintOrderHeaderModel
  packingDimensionShorthand: string
  /** When set (carton finish + conversion page), rendered at bottom of this sheet. */
  shipping?: JobSheetPrintShippingModel | null
}): ReactNode {
  const { conv, orderHeader, packingDimensionShorthand, shipping } = props
  const dash = '—'
  const v = (x: unknown) => {
    const t = String(x ?? '').trim()
    return t === '' ? dash : t
  }
  const c = conv.conversion
  const convHl = (on?: boolean) => (on ? 'js-print-qty-stock-hl' : undefined)
  return (
    <div className="js-print-conversion-sheet">
      <JobSheetPrintOrderHeader
        titleHighlight={orderHeader.titleHighlight}
        header={orderHeader.header}
        product={orderHeader.product}
      />
      <div className="js-conv-sheet">
        <div className="js-conv-main">
          <table className="js-conv-box" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={2}>
                  Conversion Specification
                </td>
              </tr>
              <tr>
                <td colSpan={2} className="js-conv-dimension">
                  <div className="js-conv-dimension-label">Dimensions:</div>
                  <div className="js-conv-dimension-value js-print-primary-text">
                    {packingDimensionShorthand.trim() !== '' ? packingDimensionShorthand : dash}
                  </div>
                </td>
              </tr>
              <tr>
                <th>Total cartons</th>
                <td>{v(conv.carton?.totalCartons)}</td>
              </tr>
              <tr>
                <th>Bags per carton</th>
                <td>{v(conv.carton?.bagsPerCarton)}</td>
              </tr>
              <tr className={convHl(c?.highlightSeal)}>
                <th>
                  Seal
                  {c?.sealWatertightCritical ? (
                    <>
                      {' '}
                      (<span className="js-yellow">Watertight seals critical</span>)
                    </>
                  ) : null}
                </th>
                <td>{v(c?.sealType)}</td>
              </tr>
              {c?.printPositionDetails != null ? (
                <tr>
                  <th className={jobSheetPrintPositionHighlightClass(c.printPositionDetailsHighlight ?? 'none')}>
                    Print position details
                  </th>
                  <td
                    className={`js-print-pre-wrap${jobSheetPrintPositionHighlightClass(c.printPositionDetailsHighlight ?? 'none') ? ` ${jobSheetPrintPositionHighlightClass(c.printPositionDetailsHighlight ?? 'none')}` : ''}`}
                  >
                    {v(c.printPositionDetails)}
                  </td>
                </tr>
              ) : null}
              <tr className={convHl(c?.highlightCartonSize)}>
                <th>Carton size</th>
                <td>{v(c?.cartonSize)}</td>
              </tr>
            </tbody>
          </table>

          <table className="js-conv-box" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={2}>
                  Conversion details
                </td>
              </tr>
              <tr className={convHl(c?.highlightPacking)}>
                <th>Packing</th>
                <td>{v(c?.packing)}</td>
              </tr>
              <tr className={convHl(c?.highlightQtyPerFold)}>
                <th>Qty per fold</th>
                <td>{v(c?.qtyPerFold)}</td>
              </tr>
              <tr className={convHl(c?.highlightQtyPerPack)}>
                <th>Qty per pack</th>
                <td>{v(c?.qtyPerPack)}</td>
              </tr>
              <tr className={convHl(c?.highlightTagPacks)}>
                <th>Tag Packs</th>
                <td>{v(c?.tagPacks)}</td>
              </tr>
              <tr className={convHl(c?.highlightTagCtn)}>
                <th>Tag Ctn</th>
                <td>{v(c?.tagCtn)}</td>
              </tr>
              <tr className={convHl(c?.highlightVent)}>
                <th>Punched</th>
                <td className="js-conv-vent-cell">
                  {c?.ventSummary?.trim() ? (
                    <VentSummaryPrintLine
                      summary={c.ventSummary}
                      holeSizeMm={c.ventHoleSizeMm}
                      highlightHoleSize={!!c.highlightVentHoleSize}
                    />
                  ) : null}
                  {c?.ventPosition?.trim() ? (
                    <div className={c?.ventSummary?.trim() ? 'js-conv-vent-position' : undefined}>{v(c?.ventPosition)}</div>
                  ) : null}
                  {!c?.ventSummary?.trim() && !c?.ventPosition?.trim() ? dash : null}
                </td>
              </tr>
              <tr className={convHl(c?.highlightVented)}>
                <th>Vented</th>
                <td>{v(c?.vented)}</td>
              </tr>
              <tr className={convHl(c?.highlightHandle)}>
                <th>Handle</th>
                <td>{v(c?.handle)}</td>
              </tr>
              <tr className={convHl(c?.highlightLinedCartons)}>
                <th>Lined Cartons</th>
                <td>{v(c?.linedCartons)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="js-conv-ops" role="presentation">
          <tbody>
            <tr>
              <th>Operator</th>
              <th>Start date</th>
              <th>Finish date</th>
              <th>Start time</th>
              <th>Finish time</th>
              <th>From box no.</th>
              <th>To box no.</th>
              <th>Total boxes</th>
            </tr>
            {Array.from({ length: 4 }, (_, i) => (
              <tr key={`conv-op-${i}`}>
                {Array.from({ length: 8 }, (_, j) => (
                  <td key={`conv-op-${i}-${j}`}>{'\u00a0'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="js-conv-footer">
          <table className="js-conv-box" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={2}>
                  Conversion Notes
                </td>
              </tr>
              <tr>
                <td className="js-conv-comment" colSpan={2} style={{ whiteSpace: 'pre-wrap', height: '100%' }}>
                  {String(props.conv.conversionNotes ?? '').trim() !== ''
                    ? props.conv.conversionNotes
                    : '\u00a0'}
                </td>
              </tr>
            </tbody>
          </table>
          <table className="js-conv-box js-conv-qc" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={6}>
                  QC checks
                </td>
              </tr>
              <tr>
                <th className="js-conv-qc-corner" scope="col">
                  QC Checks
                </th>
                <th className="js-conv-qc-phase-h" scope="col">
                  SET-UP
                </th>
                <th className="js-conv-qc-phase-h" scope="col">
                  1/4
                </th>
                <th className="js-conv-qc-phase-h" scope="col">
                  1/2
                </th>
                <th className="js-conv-qc-phase-h" scope="col">
                  3/4
                </th>
                <th className="js-conv-qc-phase-h" scope="col">
                  DONE
                </th>
              </tr>
              <tr>
                <th scope="row">Operator 1</th>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
              </tr>
              <tr>
                <th scope="row">Operator 2</th>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
              </tr>
              <tr>
                <th scope="row">Water test checks</th>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
                <td>{'\u00a0'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {shipping ? <JobSheetPrintShippingDetailsTable ship={shipping} /> : null}
    </div>
  )
}

export function JobSheetPrintPage() {
  const { jobSheetId } = useParams()
  const dispatch = useAppDispatch()
  const entry = useAppSelector((state) => (jobSheetId ? state.jobSheets.detail.byId[jobSheetId] : undefined))
  const data = entry?.data as { job_sheet?: Record<string, unknown>; spec_payload?: Record<string, unknown> } | null
  const err = entry?.error
  const quoteRatebook = useAppSelector((state) => state.quotes.quoteRatebook)
  const productSpecBundle = useAppSelector((state) => state.productSpec.bundle)
  /** Block rendering on cached detail until a fresh GET completes (avoids stale qty after save-then-print). */
  const [freshLoadDone, setFreshLoadDone] = useState(false)

  useEffect(() => {
    if (!jobSheetId) {
      setFreshLoadDone(false)
      return
    }
    let alive = true
    setFreshLoadDone(false)
    void (async () => {
      try {
        await dispatch(fetchJobSheet(jobSheetId)).unwrap()
      } catch {
        /* entry.error is set by the slice */
      } finally {
        if (alive) setFreshLoadDone(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [jobSheetId, dispatch])

  useEffect(() => {
    if (quoteRatebook.status === 'idle') void dispatch(fetchQuoteRatebook())
  }, [dispatch, quoteRatebook.status])

  useEffect(() => {
    if (productSpecBundle.status === 'idle') void dispatch(fetchProductSpecBundle())
  }, [dispatch, productSpecBundle.status])

  const model = useMemo(() => {
    const js = data?.job_sheet
    const spec = (data?.spec_payload || {}) as Record<string, any>
    const identity = (spec?.identity || {}) as Record<string, any>
    const dimensions = (spec?.dimensions || {}) as Record<string, any>
    const formulation = (spec?.formulation || {}) as Record<string, any>
    const printing = (spec?.printing || {}) as Record<string, any>
    const run = (spec?.run_requirements || {}) as Record<string, any>
    const packaging = (spec?.packaging || {}) as Record<string, any>
    const quality = (spec?.quality_expectations || {}) as Record<string, any>
    if (!js) return null

    const customer = js.customer_name ?? js.customer ?? ''
    const orderDate = js.order_date ?? ''
    const dueDate = js.due_date ?? ''
    const jobCode = js.job_no ?? ''
    const specTyped = spec as SpecPayload
    const computedSpecDescription = computeProductDescriptionFromSpec(specTyped)
    const customerFacingDescriptionPlain =
      customerFacingDescriptionFromSpec(specTyped).trim() ||
      String(js.customer_facing_description || '').trim()
    const generatedDescriptionBase =
      String(computedSpecDescription || '').trim() || String(js.product_description || '').trim()
    const notes = identity?.notes ?? run?.notes ?? packaging?.notes ?? spec?.notes ?? ''
    const qualityCheckLabels = buildJobSheetPrintQualityCheckLabels({
      quality_expectations: quality,
      identity,
      quality_checks: spec?.quality_checks,
    })

    const productType = identity?.product_type ?? spec?.product_type ?? ''
    const productTypeNorm = String(productType || '').trim().toLowerCase()
    const runUpNotApplicable = ['bag', 'tube', 'sleeve', 'u-film', 'j-film', 'u_film', 'j_film', 'ufilm', 'jfilm'].includes(productTypeNorm)
    const finishMode = identity?.finish_mode ?? spec?.finish_mode ?? ''
    const colourLookupRows = Array.isArray(productSpecBundle.colours) ? productSpecBundle.colours : []
    const colourHexByCode = new Map<string, string>()
    const colourHexByName = new Map<string, string>()
    for (const c of colourLookupRows) {
      const code = String((c as { colour_code?: unknown }).colour_code ?? '').trim().toUpperCase()
      const name = String((c as { name?: unknown }).name ?? '').trim().toUpperCase()
      const hx = normalizeHex((c as { hex_code?: unknown }).hex_code)
      if (!hx) continue
      if (code) colourHexByCode.set(code, hx)
      if (name) colourHexByName.set(name, hx)
    }
    const additiveLookupRows = Array.isArray(productSpecBundle.additives) ? productSpecBundle.additives : []
    const additiveHexByCode = new Map<string, string>()
    for (const a of additiveLookupRows) {
      const code = String((a as { additive_code?: unknown }).additive_code ?? '').trim().toUpperCase()
      const hx = normalizeHex((a as { highlight_hex_code?: unknown }).highlight_hex_code)
      if (!code || !hx) continue
      additiveHexByCode.set(code, hx)
    }
    const geometryLabelRaw = dimensions?.geometry ?? spec?.geometry ?? ''
    const widthMm = n(dimensions?.base_width_mm ?? spec?.base_width_mm)
    const widthShorthandWmm = widthMm != null && widthMm > 0 ? `${Math.round(widthMm)}` : ''
    const ufilmLeftMm = n(dimensions?.ufilm_left_width_mm ?? spec?.ufilm_left_width_mm)
    const ufilmRightMm = n(dimensions?.ufilm_right_width_mm ?? spec?.ufilm_right_width_mm)
    const gussetMm = n(dimensions?.gusset_mm ?? spec?.gusset_mm)
    const widthTolDefaultMm = 5
    const widthTolRaw = dimensions?.width_tolerance_mm ?? spec?.width_tolerance_mm
    const widthTolMm = n(widthTolRaw)
    const widthToleranceDisplay =
      widthTolMm != null && widthTolMm > 0
        ? `± ${widthTolMm} mm`
        : widthTolRaw != null && String(widthTolRaw).trim() !== ''
          ? s(widthTolRaw)
          : `± ${widthTolDefaultMm} mm`
    const widthToleranceHighlight =
      widthTolMm != null && widthTolMm > 0
        ? Math.abs(widthTolMm - widthTolDefaultMm) > 1e-6
        : widthTolRaw != null && String(widthTolRaw).trim() !== ''

    const lengthTolRaw = dimensions?.length_tolerance_mm ?? spec?.length_tolerance_mm
    const lengthTolMm = n(lengthTolRaw)
    const lengthToleranceDisplay =
      lengthTolMm != null && lengthTolMm > 0
        ? `± ${lengthTolMm} mm`
        : lengthTolRaw != null && String(lengthTolRaw).trim() !== ''
          ? s(lengthTolRaw)
          : '-'
    const lengthToleranceHighlight =
      (lengthTolMm != null && lengthTolMm > 0) || (lengthTolRaw != null && String(lengthTolRaw).trim() !== '')

    const isJFilmPrint = productTypeNorm === 'j-film' || productTypeNorm === 'j_film' || productTypeNorm === 'jfilm'
    const widthSplitMm: number[] = []
    if (isJFilmPrint) {
      if (ufilmLeftMm != null && ufilmLeftMm > 0) widthSplitMm.push(Math.round(ufilmLeftMm))
      if (ufilmRightMm != null && ufilmRightMm > 0) widthSplitMm.push(Math.round(ufilmRightMm))
    } else {
      if (ufilmLeftMm != null && ufilmLeftMm > 0) widthSplitMm.push(Math.round(ufilmLeftMm))
      if (widthMm != null && widthMm > 0) widthSplitMm.push(Math.round(widthMm))
      if (ufilmRightMm != null && ufilmRightMm > 0) widthSplitMm.push(Math.round(ufilmRightMm))
    }
    const geometryNorm = String(geometryLabelRaw ?? '')
      .trim()
      .toLowerCase()
    const runUpSlugPrint = String(run?.run_up ?? spec?.run_up ?? 'none').trim()
    const runUpNumPrint = runUpNumericalFromSlug(runUpSlugPrint, productType)
    const widthDisplay = (() => {
      if (widthSplitMm.length >= 3) return `${widthSplitMm.map((x) => Math.round(x)).join('/')}`
      if (
        (geometryNorm === 'gusset' || geometryNorm === 'bottomgusset' || geometryNorm === 'bottom_gusset') &&
        widthMm != null &&
        widthMm > 0 &&
        gussetMm != null &&
        gussetMm > 0
      ) {
        return `(${widthMm} + ${gussetMm})`
      }
      // Layflat bracket notation (e.g. 1000(500)) — Sheet / Centerfold only; bags use plain width.
      if (!runUpNotApplicable) {
        const ru = runUpNumPrint
        if ((geometryNorm === 'centrefold' || geometryNorm === 'centerfold') && widthMm != null && widthMm > 0) {
          const layflatMm = ru > 0 ? Math.round(widthMm * (ru / 2)) : Math.round(widthMm * 0.5)
          return `${widthMm}(${layflatMm})`
        }
        if (
          widthMm != null &&
          widthMm > 0 &&
          (geometryNorm === 'sheet' || geometryNorm === 'flat' || geometryNorm === 'layflat')
        ) {
          const layflatMm = ru > 0 ? Math.round(widthMm * (ru / 2)) : Math.round(widthMm)
          return `${widthMm}(${layflatMm})`
        }
      }
      if (widthSplitMm.length >= 2) return `${widthSplitMm.map((x) => Math.round(x)).join('/')}`
      if (widthMm != null && widthMm > 0) return `${widthMm}`
      return widthShorthandWmm
    })()

    /** Uteco / film-supplied line: product width only (no layflat expansion) for sheet, layflat, centrefold, U-Film / J-Film. */
    const useProductWidthOnlyForFilm =
      productTypeNorm === 'u-film' ||
      productTypeNorm === 'u_film' ||
      productTypeNorm === 'ufilm' ||
      productTypeNorm === 'j-film' ||
      productTypeNorm === 'j_film' ||
      productTypeNorm === 'jfilm' ||
      geometryNorm === 'sheet' ||
      geometryNorm === 'flat' ||
      geometryNorm === 'layflat' ||
      geometryNorm === 'centrefold' ||
      geometryNorm === 'centerfold'
    const widthDisplayProductForFilm =
      useProductWidthOnlyForFilm && widthMm != null && widthMm > 0 ? `${Math.round(widthMm)}` : widthDisplay

    const lengthUnitsRaw = String(dimensions?.length_units ?? spec?.length_units ?? '').trim()
    const lengthIsContinuous = lengthUnitsRaw.toLowerCase() === 'continuous'
    const lengthLine = lengthIsContinuous
      ? ''
      : s(
          lengthUnitsRaw === 'M'
            ? dimensions?.base_length_mm != null
              ? `${Number(dimensions.base_length_mm) / 1000}`
              : spec?.base_length_mm != null
                ? `${Number(spec.base_length_mm) / 1000}`
                : ''
            : dimensions?.base_length_mm != null
              ? `${dimensions.base_length_mm}`
              : spec?.base_length_mm != null
                ? `${spec.base_length_mm}`
                : '',
        )
    const lengthUnits = lengthIsContinuous ? 'continuous' : s(lengthUnitsRaw)
    const gaugeLine = s(
      dimensions?.thickness_um != null
        ? `${dimensions.thickness_um}`
        : spec?.thickness_um != null
          ? `${spec.thickness_um}`
          : spec?.gauge,
    )
    const trimPct =
      identity?.trim_pct != null
        ? `${identity.trim_pct}%`
        : spec?.trim_pct != null
          ? `${spec.trim_pct}%`
          : ''
    const gaugeTrimDisplay = trimPct !== '' ? trimPct : ''
    const gaugeTrimExplicit = trimPct !== ''
    const slitRaw = run?.slit ?? spec?.slit
    const treatRaw = run?.treat_inside_outside ?? run?.treat ?? spec?.treat
    const slit = displaySlit(slitRaw)
    const treat = displayTreat(treatRaw)
    const treatNorm = String(treatRaw ?? '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_')
      .replace(/\s+/g, '_')
    const treatHighlight: 'inside' | 'outside' | 'both' | '' = (() => {
      if (treatNorm === 'both_sides' || treatNorm === 'both') return 'both'
      if (treatNorm === 'inside' || treatNorm === 'treat_inside') return 'inside'
      if (treatNorm === 'outside' || treatNorm === 'treat_outside') return 'outside'
      if (treatNorm.endsWith('_inside') && !treatNorm.includes('outside')) return 'inside'
      if (treatNorm.endsWith('_outside')) return 'outside'
      return ''
    })()
    const runUpLine = displayRunUp(run?.run_up ?? spec?.run_up)
    const coresLine = s(packaging?.core_type ?? spec?.core_type)
    const shrink = !!run?.shrink
    const inlineSeal = derivedInlineSeal(String(productType || ''), String(finishMode || ''))
    const inlinePerforated = !!run?.inline_perforation
    const titleHighlight = inlinePerforatedHighlight(productType, finishMode, inlinePerforated)
    const runRecord = (run || {}) as Record<string, unknown>
    const holePunched = inlinePunchEnabled(runRecord)

    const qv = n(js.quantity_value)
    const qtyUnitRaw = String(js.quantity_unit || '').trim().toLowerCase()
    const totalKg = n(js.quantity_unit === 'kg' ? js.quantity_value : js.total_kg)
    const numRolls = n(js.num_rolls) ?? 1
    const numUnits = n(js.num_product_units)
    const weightPerRoll = n(js.weight_per_roll_kg)
    const totalMStored = n(js.total_m)
    const wasteKgFixed = n(spec?.waste_kg)
    const extFromJob =
      js?.production_extruder_code != null && String(js.production_extruder_code).trim() !== ''
        ? String(js.production_extruder_code).trim()
        : null
    const extLegacy =
      identity?.production_extruder_code != null && String(identity.production_extruder_code).trim() !== ''
        ? String(identity.production_extruder_code).trim()
        : null
    const productionExtruderCode = extFromJob || extLegacy

    const rb = quoteRatebook.data
    const extruderDieSizeMm = (() => {
      if (!productionExtruderCode || !Array.isArray(rb?.extruders)) return null
      const hit = rb.extruders.find((x) => String(x?.extruder_code ?? '').trim() === productionExtruderCode)
      const d = hit?.die_size_mm
      if (d == null || !Number.isFinite(Number(d))) return null
      return Math.round(Number(d))
    })()
    let geoDerived: ReturnType<typeof computeDerivedGeometryAndTotals> | null = null
    let quotePreviewForWaste: ReturnType<typeof computeQuickQuotePreview> | null = null
    let qtySliceForPrint: SpecQuantitySlice | null = null
    if (rb && spec && typeof spec === 'object') {
      try {
        qtySliceForPrint = buildSpecQuantitySliceFromPersistedJobSheet(js as Record<string, unknown>, spec as SpecPayload)
        const quick = buildQuickQuoteInputsFromSpec(spec as SpecPayload, qtySliceForPrint, {
          ratebook: rb,
          extruderCode: productionExtruderCode,
        })
        geoDerived = computeDerivedGeometryAndTotals(quick, rb)
        if (productionExtruderCode) {
          quotePreviewForWaste = computeQuickQuotePreview(quick, rb)
        }
      } catch {
        geoDerived = null
        quotePreviewForWaste = null
      }
    }

    let wasteKg: number | null = wasteKgFixed
    if (productionExtruderCode && quotePreviewForWaste) {
      const jobKg = quotePreviewForWaste.totals_kg
      const totalExt = quotePreviewForWaste.total_extruded_kg
      const wKg = quotePreviewForWaste.waste_kg
      if (jobKg != null && jobKg > 0 && totalExt != null && totalExt > 0) {
        wasteKg = wKg != null && wKg > 0 ? wKg : 0
      }
    }

    const totalKgIncludingWasteNum = (() => {
      const tex = quotePreviewForWaste?.total_extruded_kg
      if (tex != null && Number(tex) > 0 && Number.isFinite(Number(tex))) return Number(tex)
      if (totalKg != null && totalKg > 0) return totalKg
      if (qv != null && qtyUnitRaw === 'kg') return Number(qv)
      return null
    })()

    const derivedTotalM =
      geoDerived != null && geoDerived.derivedTotalM > 0 && Number.isFinite(geoDerived.derivedTotalM)
        ? geoDerived.derivedTotalM
        : null
    const derivedMPerRoll =
      geoDerived != null && geoDerived.mPerRoll != null && geoDerived.mPerRoll > 0 && Number.isFinite(geoDerived.mPerRoll)
        ? geoDerived.mPerRoll
        : null

    const finishNorm = String(finishMode || '').trim().toLowerCase()
    const inlinePunchPrint = holePunched ? formatPunchPrintLines(runRecord, INLINE_PUNCH_FIELDS) : null
    const highlightOrderedM =
      qtyUnitRaw === '1000' || qtyUnitRaw === 'cartons' || qtyUnitRaw === 'rolls'
    const highlightOrderedKg = qtyUnitRaw === 'kg'

    let cartonConversion: { bagsPerCarton: string; totalCartons: string } | null = null
    if (finishNorm === 'cartons') {
      const bpcN = n(packaging?.bags_per_carton)
      const qtyTypeStr = String(js.qty_type || '')
      const quLower = String(js.quantity_unit || '').toLowerCase()
      let totalCtns: number | null = null
      if (qtyTypeStr === 'units' && quLower === 'cartons' && qv != null && qv > 0) {
        totalCtns = Math.max(1, Math.round(qv))
      } else if (bpcN != null && bpcN > 0 && numUnits != null && numUnits > 0) {
        totalCtns = Math.max(1, Math.ceil(numUnits / bpcN))
      } else if (
        bpcN != null &&
        bpcN > 0 &&
        totalKg != null &&
        totalKg > 0 &&
        geoDerived?.kgPerUnit != null &&
        Number(geoDerived.kgPerUnit) > 0
      ) {
        const cartonKg = bpcN * Number(geoDerived.kgPerUnit)
        totalCtns = Math.max(1, Math.round(totalKg / cartonKg))
      }
      cartonConversion = {
        bagsPerCarton: (() => {
          const count = bpcN != null && bpcN > 0 ? String(Math.max(1, Math.round(bpcN))) : ''
          if (count === '') return ''
          const cartonKg =
            geoDerived?.kgPerUnit != null && Number(geoDerived.kgPerUnit) > 0
              ? Math.max(1, Math.round(bpcN!)) * Number(geoDerived.kgPerUnit)
              : null
          return cartonKg != null && Number.isFinite(cartonKg) && cartonKg > 0
            ? `${count} (${fmtQtyNumber(cartonKg, 2)}kg)`
            : count
        })(),
        totalCartons: totalCtns != null ? String(totalCtns) : '',
      }
    }

    const rollsPerPalletStored = n(packaging?.rolls_per_pallet)
    const cartonsPerPalletStored = n(packaging?.cartons_per_pallet)
    const perPalletConfigured =
      finishNorm === 'cartons'
        ? cartonsPerPalletStored != null && cartonsPerPalletStored > 0
          ? cartonsPerPalletStored
          : null
        : rollsPerPalletStored != null && rollsPerPalletStored > 0
          ? rollsPerPalletStored
          : null
    const orderUnitsForPallets =
      finishNorm === 'cartons'
        ? cartonConversion != null &&
          cartonConversion.totalCartons.trim() !== '' &&
          Number.isFinite(Number(cartonConversion.totalCartons)) &&
          Number(cartonConversion.totalCartons) > 0
          ? Math.round(Number(cartonConversion.totalCartons))
          : null
        : numRolls != null && Number.isFinite(numRolls) && numRolls > 0
          ? Math.max(1, Math.round(numRolls))
          : null
    const palletsRequiredForOrder =
      orderUnitsForPallets != null && orderUnitsForPallets > 0
        ? palletsRequiredCeil(orderUnitsForPallets, perPalletConfigured)
        : null

    const blendTypeRaw =
      formulation?.blend_type != null && String(formulation.blend_type).trim() !== ''
        ? String(formulation.blend_type).trim()
        : ''
    const blendTypeCode = blendTypeRaw || 'LD'
    const hasExplicitBlendType = blendTypeRaw !== ''
    const legacyBlendCodeOnly =
      !hasExplicitBlendType && spec?.resin_blend_code != null && String(spec.resin_blend_code).trim() !== ''

    const isCustomBlend =
      legacyBlendCodeOnly ||
      blendTypeRaw === 'Custom' ||
      blendTypeRaw.toUpperCase() === 'CUSTOM'

    const blendVariant: 'ld' | 'preset' | 'custom' = isCustomBlend
      ? 'custom'
      : blendTypeCode === 'LD'
        ? 'ld'
        : 'preset'

    const resinPresets = productSpecBundle.resinBlends
    const resinOpts = productSpecBundle.resins

    const blendRowsRaw = Array.isArray(formulation?.blend)
      ? formulation.blend
      : Array.isArray(spec?.blend)
        ? spec.blend
        : []
    const blendRowsSorted = [...blendRowsRaw].sort((a, b) => {
      const pa = Number((a as { pct?: unknown })?.pct ?? 0)
      const pb = Number((b as { pct?: unknown })?.pct ?? 0)
      return pb - pa
    })

    const explicitParts = blendRowsSorted
      .map((row) => {
        const code = s((row as { code?: unknown })?.code ?? (row as { resin_code?: unknown })?.resin_code, '')
        const pct = n((row as { pct?: unknown })?.pct)
        return { code, pct }
      })
      .filter((x) => x.code !== '' && x.pct != null && x.pct > 0) as Array<{ code: string; pct: number }>

    const lookupPresetParts = (code: string): Array<{ code: string; pct: number }> => {
      const t = code.trim()
      if (!t) return []
      const u = t.toUpperCase()
      const hit = resinPresets.find(
        (p) => String(p.blend_code ?? '').trim() === t || String(p.blend_code ?? '').trim().toUpperCase() === u,
      )
      if (!hit?.components?.length) return []
      return hit.components
        .map((c) => ({
          code: String(c.resin_code ?? '').trim(),
          pct: Number(c.pct),
        }))
        .filter((c) => c.code !== '' && Number.isFinite(c.pct) && c.pct > 0)
    }

    let baseParts: Array<{ code: string; pct: number }> = []
    const lookupKey = hasExplicitBlendType ? blendTypeRaw : blendTypeCode
    const presetPartsForPrint =
      !isCustomBlend && !legacyBlendCodeOnly ? lookupPresetParts(lookupKey) : []

    const singleFullPctPlaceholder =
      explicitParts.length === 1 &&
      explicitParts[0].pct != null &&
      Math.abs(explicitParts[0].pct - 100) < 0.0001

    if (explicitParts.length > 0) {
      if (
        presetPartsForPrint.length > 0 &&
        singleFullPctPlaceholder &&
        presetPartsForPrint.length !== explicitParts.length
      ) {
        baseParts = presetPartsForPrint
      } else {
        baseParts = explicitParts
      }
    } else if (!legacyBlendCodeOnly) {
      baseParts = presetPartsForPrint
    }

    const resinLabelForCode = (code: string): string => {
      const hit = resinOpts.find((r) => String(r.resin_code ?? '').trim() === code.trim())
      return hit?.name?.trim() ? `${code} · ${hit.name}` : code
    }

    let blendCaption = ''
    if (legacyBlendCodeOnly) {
      blendCaption = `Resin blend code: ${s(spec?.resin_blend_code)}`
    } else {
      const labelKey = hasExplicitBlendType ? blendTypeRaw : 'LD'
      blendCaption = `Resin blend: ${displayBlendTypeLabel(labelKey)}`
    }

    const resinBlendComponents: ExtrusionResinBlendComponent[] = []
    for (const p of baseParts) {
      resinBlendComponents.push({
        key: `resin-${p.code}`,
        label: resinLabelForCode(p.code),
        pct: p.pct,
      })
    }

    const colourRows = Array.isArray(formulation?.colour_components) ? formulation.colour_components : []
    for (const row of colourRows) {
      const code = s(row?.colour_code, '')
      const strength = n(row?.strength_pct)
      if (code === '' || strength == null || strength <= 0) continue
      const hx = colourHexByCode.get(code.trim().toUpperCase()) || colourHexByName.get(code.trim().toUpperCase()) || null
      resinBlendComponents.push({
        key: `colour-${code}`,
        label: `Colour ${code}`.trim(),
        pct: strength,
        bgHex: hx,
        textColor: hx ? textColorForHex(hx) : null,
      })
    }

    const additiveRows = Array.isArray(formulation?.additives) ? formulation.additives : []
    for (const row of additiveRows) {
      const code = s(row?.additive_code, '')
      const pct = n(row?.pct)
      if (code === '' || pct == null || pct <= 0) continue
      const addHx = additiveHexByCode.get(code.trim().toUpperCase()) || null
      resinBlendComponents.push({
        key: `additive-${code}`,
        label: `Additive ${code}`.trim(),
        pct,
        bgHex: addHx,
        textColor: addHx ? textColorForHex(addHx) : null,
      })
    }

    const productivePlasticKg =
      geoDerived?.derivedTotalKg != null &&
      geoDerived.derivedTotalKg > 0 &&
      Number.isFinite(geoDerived.derivedTotalKg)
        ? geoDerived.derivedTotalKg
        : null
    const extrusionWasteKgForBlend =
      wasteKg != null && wasteKg >= 0 && Number.isFinite(wasteKg) ? wasteKg : null
    const resinBlendTable = buildExtrusionResinBlendPrintTable(resinBlendComponents, {
      caption: blendCaption,
      variant: blendVariant,
      productivePlasticKg,
      extrusionWasteKg: extrusionWasteKgForBlend,
      totalExtrudedKg: totalKgIncludingWasteNum,
    })

    let resinBlendFallbackLine: string | null = null
    if (resinBlendComponents.length === 0) {
      if (legacyBlendCodeOnly) {
        resinBlendFallbackLine = `Resin blend code: ${s(spec?.resin_blend_code)}`
      } else if (hasExplicitBlendType) {
        resinBlendFallbackLine = `Resin blend: ${displayBlendTypeLabel(blendTypeRaw)}`
      } else if (blendRowsSorted.length > 0) {
        resinBlendFallbackLine = `Resin blend: ${displayBlendTypeLabel('LD')}`
      }
    }

    const printMethodDisplay = s(printing?.method ?? spec?.print_method ?? spec?.printing_method)
    const printed =
      printMethodDisplay.trim() !== '' && printMethodDisplay.trim().toLowerCase() !== 'none'

    const frontInkPlateSimple = meaningfulInkPlateRows(printing?.front_ink_plate)
    const backInkPlateSimple = meaningfulInkPlateRows(printing?.back_ink_plate)
    const frontInkPlatePrint = meaningfulInkPlatePrintRows(printing?.front_ink_plate)
    const backInkPlatePrint = meaningfulInkPlatePrintRows(printing?.back_ink_plate)
    const inkCodesLegacy = Array.isArray(printing?.ink_codes)
      ? (printing.ink_codes as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const plateCodesLegacy = Array.isArray(printing?.plate_codes)
      ? (printing.plate_codes as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const artworkRefs = Array.isArray(printing?.artwork_refs)
      ? (printing.artwork_refs as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const artworkFileRows = Array.isArray(printing?.artwork_files)
      ? (printing.artwork_files as Array<{ id?: unknown; filename?: unknown }>)
          .map((f) => ({
            id: String(f?.id ?? '').trim(),
            filename: String(f?.filename ?? '').trim() || 'Untitled.pdf',
          }))
          .filter((row) => row.id)
      : []
    const artworkPdfNames = artworkFileRows.map((f) => f.filename)

    const cylMm = n(printing?.cylinder_size_mm)
    const platesAroundDisp =
      printing?.plates_around != null && String(printing.plates_around).trim() !== '' ? s(printing.plates_around) : ''
    const platesAcrossDisp =
      printing?.plates_across != null && String(printing.plates_across).trim() !== ''
        ? s(printing.plates_across)
        : printed
          ? '1'
          : ''

    const legacyInkPlate =
      frontInkPlateSimple.length === 0 && backInkPlateSimple.length === 0 && (inkCodesLegacy.length > 0 || plateCodesLegacy.length > 0)
        ? [
            inkCodesLegacy.length ? `Inks: ${inkCodesLegacy.join(', ')}` : '',
            plateCodesLegacy.length ? `Plates: ${plateCodesLegacy.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null

    const printRegNorm = normalizePrintRegistration(printing?.print_registration)
    const printPositionCombined = formatPrintPositionForPrint(printRegNorm, printing?.print_position_notes)
    const printPositionHighlightKind = printPositionHighlight(printRegNorm, printing?.print_position_notes)

    const printingLayout = {
      printed,
      method: printMethodDisplay,
      printDescription: s(printing?.print_description ?? spec?.printing_notes ?? spec?.print_notes),
      barcode: s(printing?.barcode),
      numColours: s(printing?.num_colours ?? spec?.num_colours),
      printSide: formatPrintSide(printing?.side),
      treatLine: treat,
      printPosition: printPositionCombined,
      printPositionHighlight: printPositionHighlightKind,
      filmSupplied: formatJobSheetFilmSuppliedFromSpec(specTyped),
      finishedBagSize: formatJobSheetFinishedBagSizeFromSpec(specTyped),
      artworkRefs: artworkRefs.length ? artworkRefs.map((x) => String(x).trim()).join('; ') : '',
      artworkPdfs: artworkPdfNames.length ? artworkPdfNames.join('; ') : '',
      artworkPdfNames,
      frontRows: frontInkPlatePrint,
      backRows: backInkPlatePrint,
      legacyInkPlate,
      cylinder: cylMm != null ? `${cylMm} mm` : '',
      platesAround: platesAroundDisp,
      platesAcross: platesAcrossDisp,
    }

    const orderedKgForExtrusionRollCount =
      quotePreviewForWaste?.totals_kg != null &&
      Number(quotePreviewForWaste.totals_kg) > 0 &&
      Number.isFinite(Number(quotePreviewForWaste.totals_kg))
        ? Number(quotePreviewForWaste.totals_kg)
        : qtyUnitRaw === 'kg' && qv != null && qv > 0
          ? qv
          : totalKg != null && totalKg > 0
            ? totalKg
            : null
    const qtyPrefsForExtrusionRollCount = orderQtyPrefsFromJobSheetAndSpec(
      js as Record<string, unknown>,
      specTyped,
    )
    const extrusionRollWeightKgForCount =
      qtyPrefsForExtrusionRollCount.weight_per_roll_kg != null &&
      qtyPrefsForExtrusionRollCount.weight_per_roll_kg > 0
        ? qtyPrefsForExtrusionRollCount.weight_per_roll_kg
        : weightPerRoll != null && weightPerRoll > 0
          ? weightPerRoll
          : null
    const extruderOutputRollCount = extrusionRollCountForPrint({
      finishMode: finishNorm === 'cartons' ? 'Cartons' : 'Rolls',
      totalKg: orderedKgForExtrusionRollCount,
      weightPerRollKg: extrusionRollWeightKgForCount,
      schedulingRollCount: numRolls,
    })

    const geoSnapshotForTail =
      derivedTotalM != null ||
      derivedMPerRoll != null ||
      (geoDerived?.units != null && geoDerived.units > 0)
        ? {
            derivedTotalM: derivedTotalM ?? 0,
            mPerRoll: derivedMPerRoll,
            derivedProductUnits: geoDerived?.units ?? null,
          }
        : null
    const headerSummaryLine = buildJobSheetPrintHeaderSummaryLine(
      js as Record<string, unknown>,
      spec as Record<string, unknown>,
      geoSnapshotForTail,
      { extrusionRollCount: extruderOutputRollCount },
    )
    const generatedDescriptionWithPackagingTail = jobSheetDescriptionWithPackagingTail(
      String(generatedDescriptionBase ?? ''),
      js as Record<string, unknown>,
      spec as Record<string, unknown>,
      geoSnapshotForTail,
    )
    const generatedProductCode = computeProductCodeFromSpec(specTyped)
    const customerFacingDescriptionWithPackagingTail =
      customerFacingDescriptionPlain !== ''
        ? jobSheetDescriptionWithPackagingTail(
            customerFacingDescriptionPlain,
            js as Record<string, unknown>,
            spec as Record<string, unknown>,
            geoSnapshotForTail,
          )
        : ''
    const totalMNumForUteco =
      derivedTotalM != null && derivedTotalM > 0 && Number.isFinite(derivedTotalM)
        ? derivedTotalM
        : totalMStored != null && totalMStored > 0 && Number.isFinite(totalMStored)
          ? totalMStored
          : null
    const utecoTotalMeters =
      totalMNumForUteco != null && totalMNumForUteco > 0 ? `${fmtQtyNumber(totalMNumForUteco, 2)}m` : ''

    const umForFilm = dimensions?.thickness_um ?? spec?.thickness_um
    const gaugeUteco =
      umForFilm != null && Number.isFinite(Number(umForFilm)) ? `${Math.round(Number(umForFilm))}um` : ''
    const geoFilmSuffix = geometryLabelForUtecoFilmSupplied(geometryLabelRaw, productType)
    const baseLenMmForFilmLine = n(dimensions?.base_length_mm ?? spec?.base_length_mm)
    const lenUnitsForFilm = String(dimensions?.length_units ?? spec?.length_units ?? '').trim().toLowerCase()

    let utecoFilmTypeSupplied = ''
    const widthForUtecoFilm = widthDisplayProductForFilm
    if (useProductWidthOnlyForFilm) {
      const wPart = widthForUtecoFilm.trim() !== '' ? `${widthForUtecoFilm.trim()}Wmm` : ''
      const lPart =
        lenUnitsForFilm !== 'continuous' &&
        baseLenMmForFilmLine != null &&
        baseLenMmForFilmLine > 0 &&
        Number.isFinite(baseLenMmForFilmLine)
          ? `${Math.round(baseLenMmForFilmLine)}Lmm`
          : ''
      const gPart = gaugeUteco
      const core = [wPart, lPart, gPart].filter((p) => String(p ?? '').trim() !== '')
      utecoFilmTypeSupplied = core.join(' x ')
      if (geoFilmSuffix) {
        utecoFilmTypeSupplied = utecoFilmTypeSupplied ? `${utecoFilmTypeSupplied}, ${geoFilmSuffix}` : geoFilmSuffix
      }
    } else if (widthForUtecoFilm && gaugeUteco) {
      utecoFilmTypeSupplied = `${widthForUtecoFilm} x ${gaugeUteco}`
      if (geoFilmSuffix) utecoFilmTypeSupplied += `, ${geoFilmSuffix}`
    } else if (widthForUtecoFilm) {
      utecoFilmTypeSupplied = geoFilmSuffix ? `${widthForUtecoFilm}, ${geoFilmSuffix}` : widthForUtecoFilm
    } else if (gaugeUteco) {
      utecoFilmTypeSupplied = geoFilmSuffix ? `${gaugeUteco}, ${geoFilmSuffix}` : gaugeUteco
    } else if (geoFilmSuffix) {
      utecoFilmTypeSupplied = geoFilmSuffix
    }

    const bagWUteco = dimensions?.base_width_mm
    const bagLUteco = dimensions?.base_length_mm
    let utecoFinishedBagSize = ''
    if (
      bagWUteco != null &&
      Number.isFinite(Number(bagWUteco)) &&
      bagLUteco != null &&
      Number.isFinite(Number(bagLUteco))
    ) {
      utecoFinishedBagSize = `${Math.round(Number(bagWUteco))}mm x ${Math.round(Number(bagLUteco))}mm`
    }

    const sealTypeLabelUteco = formatSealTypeLabel(run?.seal_type ?? printing?.seal_type) || '—'
    const eyeSpotLabelUteco = formatEyeSpot(printing?.eye_spot) || '—'

    const deckColoursUteco = buildUtecoDeckColourRows(
      frontInkPlatePrint,
      backInkPlatePrint,
      printing?.side,
      printing?.num_colours ?? spec?.num_colours,
    )

    const utecoPrinting = {
      customer: s(customer),
      productDescription:
        customerFacingDescriptionWithPackagingTail.trim() !== ''
          ? customerFacingDescriptionWithPackagingTail
          : generatedDescriptionWithPackagingTail,
      printDescription: printingLayout.printDescription,
      jobNumber: s(jobCode),
      orderDate: s(orderDate),
      dueDate: s(dueDate),
      barcode: printingLayout.barcode,
      cylinder: printingLayout.cylinder,
      platesAround: printingLayout.platesAround,
      platesAcross: printingLayout.platesAcross,
      numColours: printingLayout.numColours,
      printSide: printingLayout.printSide,
      totalMeters: utecoTotalMeters,
      printPosition: printingLayout.printPosition,
      printPositionHighlight: printingLayout.printPositionHighlight,
      filmTypeSupplied: utecoFilmTypeSupplied,
      finishedBagSize: utecoFinishedBagSize,
      sealTypeLabel: sealTypeLabelUteco,
      eyeSpotLabel: eyeSpotLabelUteco,
      artworkPdfNames,
      deckColours: deckColoursUteco,
    }

    const convRaw = (run?.conversion || {}) as Record<string, unknown>
    const conversionPunchEnabledPrint = punchedConversionEnabledFromConv(convRaw)
    const ventPrint = conversionPunchEnabledPrint
      ? formatPunchPrintLines(convRaw, CONVERSION_PUNCH_FIELDS)
      : { summary: '', position: '', holeSizeMm: 6 as const, highlightHoleSize: false }
    const ventSummaryPrint = ventPrint.summary
    const ventPositionPrint = ventPrint.position
    const ventHoleSizeMmPrint = ventPrint.holeSizeMm
    const highlightVentHoleSizePrint = ventPrint.highlightHoleSize
    const sealTypeSlug = String(run?.seal_type ?? printing?.seal_type ?? 'end')
      .trim()
      .toLowerCase()
    const sealTypePrint = formatSealTypeLabel(sealTypeSlug) || 'Bottom'
    const watertightSealsCritical = collectQualityFlagIds(spec as Parameters<typeof collectQualityFlagIds>[0]).includes(
      'seal_integrity',
    )
    const cartonSizePrint =
      convRaw.carton_size != null && String(convRaw.carton_size).trim() !== '' ? String(convRaw.carton_size) : ''
    const packingModePrint = deriveConversionPackingMode(convRaw as Record<string, unknown>)
    const packingLabelPrint = conversionPackingModeLabel(packingModePrint, { forPrint: true })
    const qtyPerFoldPrint =
      convRaw.qty_per_fold != null && String(convRaw.qty_per_fold).trim() !== ''
        ? String(convRaw.qty_per_fold)
        : ''
    const packSizePrint =
      convRaw.pack_size != null && String(convRaw.pack_size).trim() !== '' ? String(convRaw.pack_size) : ''
    const highlightConversionSeal = sealTypeSlug !== 'end'
    const highlightConversionCartonSize = cartonSizePrint.trim() !== ''
    const highlightConversionPacking = packingLabelPrint.trim() !== ''
    const highlightConversionQtyPerFold = qtyPerFoldPrint.trim() !== ''
    const highlightConversionQtyPerPack = packSizePrint.trim() !== ''
    const highlightConversionTagPacks = !!convRaw.tag_packs
    const highlightConversionTagCtn = !!convRaw.tag_ctn
    const highlightConversionVent = conversionPunchEnabledPrint
    const ventedConversion = ventedEnabledFromConv(convRaw)
    const highlightConversionHandle = !!convRaw.handle
    const highlightConversionLinedCartons = !!convRaw.lined_cartons
    const showPrintPositionDetailsOnConv =
      finishNorm === 'cartons' && printed && isBottomSealType(sealTypeSlug)
    const printPositionDetailsOnConv = s(printing?.print_position_notes)
    const printPositionDetailsHighlightOnConv = printPositionHighlight(
      printRegNorm,
      printing?.print_position_notes,
    )

    const thicknessUmForConv = n(dimensions?.thickness_um ?? spec?.thickness_um)
    const baseLenMmForConv = n(dimensions?.base_length_mm ?? spec?.base_length_mm)
    const lengthUnitsRawForConv = String(dimensions?.length_units ?? spec?.length_units ?? '').trim()
    const packingDimensionShorthandForConversion = formatConversionPackingDimensionShorthand({
      widthDisplay,
      baseLengthMm: baseLenMmForConv,
      lengthUnitsRaw: lengthUnitsRawForConv,
      thicknessUm: thicknessUmForConv,
      gaugeLineFallback: gaugeLine,
    })

    const orderQuantities: JobSheetPrintExtrusionQuantitiesModel = (() => {
          const totalMNum =
            derivedTotalM != null && derivedTotalM > 0 && Number.isFinite(derivedTotalM)
              ? derivedTotalM
              : totalMStored != null && totalMStored > 0 && Number.isFinite(totalMStored)
                ? totalMStored
                : null
          const totalMPrint =
            totalMNum != null && totalMNum > 0 ? `${formatExtrusionQty(totalMNum)}m` : ''

          const orderedKgNum =
            n(quotePreviewForWaste?.totals_kg) ??
            (qtyUnitRaw === 'kg' ? qv : null) ??
            (totalKg != null && totalKg > 0 ? totalKg : null)
          const orderedKgPrint =
            orderedKgNum != null && orderedKgNum > 0 && Number.isFinite(orderedKgNum)
              ? `${formatExtrusionQty(orderedKgNum)}kg`
              : ''

          const kprFromPreview =
            quotePreviewForWaste?.kg_per_roll != null &&
            Number(quotePreviewForWaste.kg_per_roll) > 0 &&
            Number.isFinite(Number(quotePreviewForWaste.kg_per_roll))
              ? Number(quotePreviewForWaste.kg_per_roll)
              : null
          const kprNum =
            finishNorm === 'cartons'
              ? kprFromPreview != null
                ? kprFromPreview
                : extrusionRollWeightKgForCount != null
                  ? extrusionRollWeightKgForCount
                  : weightPerRoll != null && weightPerRoll > 0
                    ? weightPerRoll
                    : orderedKgNum != null &&
                        orderedKgNum > 0 &&
                        extruderOutputRollCount > 0 &&
                        Number.isFinite(orderedKgNum / extruderOutputRollCount)
                      ? orderedKgNum / extruderOutputRollCount
                      : null
              : kprFromPreview != null
                ? kprFromPreview
                : weightPerRoll != null && weightPerRoll > 0
                  ? weightPerRoll
                  : null

          const mprFromPreview =
            quotePreviewForWaste?.m_per_roll != null &&
            Number(quotePreviewForWaste.m_per_roll) > 0 &&
            Number.isFinite(Number(quotePreviewForWaste.m_per_roll))
              ? Number(quotePreviewForWaste.m_per_roll)
              : null
          const mprNum =
            derivedMPerRoll != null && derivedMPerRoll > 0 && Number.isFinite(derivedMPerRoll)
              ? derivedMPerRoll
              : mprFromPreview != null
                ? mprFromPreview
                : finishNorm === 'cartons' &&
                    totalMNum != null &&
                    totalMNum > 0 &&
                    extruderOutputRollCount > 0 &&
                    Number.isFinite(totalMNum / extruderOutputRollCount)
                  ? totalMNum / extruderOutputRollCount
                  : null
          const mPerRollPrint =
            mprNum != null && mprNum > 0 ? `${formatExtrusionQty(mprNum)}m` : ''
          const mPerRollFormatted = mPerRollPrint ? `${mPerRollPrint}/roll` : ''
          const rwbRaw = pickRollWeightBillingRaw(specTyped)
          const coreTypeStr = String(packaging?.core_type ?? spec?.core_type ?? '').trim()
          let coreKgNum: number | null = null
          if (rb?.cores && coreTypeStr) {
            const crow = (rb.cores as Record<string, { kg_per_meter?: number } | undefined>)[coreTypeStr]
            const kpm = crow?.kg_per_meter != null ? Number(crow.kg_per_meter) : NaN
            const cl =
              quotePreviewForWaste?.core_length_m != null ? Number(quotePreviewForWaste.core_length_m) : NaN
            if (Number.isFinite(kpm) && kpm > 0 && Number.isFinite(cl) && cl > 0) {
              coreKgNum = cl * kpm
            }
          }

          const billingSlugForKpr = resolveRollWeightBillingSlug(rwbRaw)
          const kprWithCoreNum = kgPerRollWithCoreWeight(kprNum, {
            billingSlug: billingSlugForKpr,
            totalCoreKg: coreKgNum,
            rollCount: extruderOutputRollCount,
          })
          const kgPerRollWithCoreFormatted = formatKgPerRoll(kprWithCoreNum)
          const coreTypeStrForBilling = String(packaging?.core_type ?? spec?.core_type ?? '').trim()
          const coreKpmForBilling = (() => {
            if (!rb?.cores || !coreTypeStrForBilling) return null
            const crow = (rb.cores as Record<string, { kg_per_meter?: number } | undefined>)[coreTypeStrForBilling]
            const kpm = crow?.kg_per_meter != null ? Number(crow.kg_per_meter) : NaN
            return Number.isFinite(kpm) && kpm > 0 ? kpm : null
          })()
          const coreLengthMForBilling =
            quotePreviewForWaste?.core_length_m != null &&
            Number(quotePreviewForWaste.core_length_m) > 0 &&
            Number.isFinite(Number(quotePreviewForWaste.core_length_m))
              ? Number(quotePreviewForWaste.core_length_m)
              : null
          const coreWeightIncludedKg =
            finishNorm === 'rolls'
              ? coreWeightIncludedKgForBilling(billingSlugForKpr, coreLengthMForBilling, coreKpmForBilling)
              : null

          return {
            orderedM: totalMPrint,
            orderedKg: orderedKgPrint,
            highlightOrderedM,
            highlightOrderedKg,
            mPerRollFormatted,
            kgPerRollWithCoreFormatted,
            extruderOutputRollCount,
            coreWeightIncludedKg,
          }
    })()

    const productFinishLabel =
      productTypeFinishLabel(productType, finishMode, {
        geometry: geometryLabelRaw,
        gussetMm,
      }) || ''

    return {
      titleHighlight,
      header: {
        customer: s(customer),
        orderDate: s(orderDate),
        dueDate: s(dueDate),
        jobCode: s(jobCode),
      },
      product: {
        generatedProductCode,
        productFinishLabel,
        summaryLine: headerSummaryLine,
        notes: s(notes),
        qualityChecks: qualityCheckLabels,
      },
      extrusion: {
        productType: s(productType),
        finishMode: s(finishMode),
        productFinishHeadline: productFinishLabel || '—',
        geometryLabel: displayGeometryLabel(geometryLabelRaw),
        geometryExtras: [
          gussetMm != null && gussetMm > 0 ? `Gusset ${Math.round(gussetMm)} mm` : '',
        ].filter(Boolean),
        widthSplitMm: widthSplitMm.length >= 2 ? widthSplitMm : null,
        widthPrimarySingle: widthDisplay,
        widthToleranceDisplay,
        lengthLine,
        lengthUnits,
        lengthToleranceDisplay,
        widthToleranceHighlight,
        lengthToleranceHighlight,
        gaugeLine,
        gaugeTrimDisplay,
        gaugeTrimExplicit,
        slit,
        treat,
        treatHighlight,
        shrink,
        inlineSeal,
        inlinePerforated,
        inlinePunched: holePunched,
        inlinePunchPrint,
        vented: ventedConversion,
        runUpLine: runUpNotApplicable ? '-' : runUpLine,
        coresLine,
        orderQuantities,
        resinBlendTable,
        resinBlendFallbackLine,
      },
      printingLayout,
      artworkFiles: artworkFileRows,
      shipping: {
        palletType: s(packaging?.pallet_type ?? spec?.pallet_type),
        finishModeKey: finishNorm,
        rollsPerPallet: rollsPerPalletStored != null && rollsPerPalletStored > 0 ? String(rollsPerPalletStored) : '',
        cartonsPerPallet: cartonsPerPalletStored != null && cartonsPerPalletStored > 0 ? String(cartonsPerPalletStored) : '',
        orderUnitsForPallets: orderUnitsForPallets != null ? `${orderUnitsForPallets} ${finishNorm === 'cartons' ? ' Cartons' : ' Rolls'}` : '',
        orderUnitsLabel: finishNorm === 'cartons' ? 'Order cartons' : 'Order rolls',
        palletsRequired: palletsRequiredForOrder != null ? String(palletsRequiredForOrder) : '',
        palletChecklistCount: palletsRequiredForOrder != null ? palletsRequiredForOrder : 0,
        packingNotes: s(packaging?.notes),
        ...(() => {
          const overproductionHandling = customerOverproductionFromSpec(
            specTyped,
            finishNorm === 'cartons' ? 'Cartons' : 'Rolls',
          )
          return {
            overproductionAcceptLabel: overproductionOptionLabel(overproductionHandling, productType),
            overproductionHighlightClass: (() => {
              const kind = overproductionPrintHighlight(overproductionHandling)
              return kind === 'none' ? undefined : 'js-yellow'
            })(),
          }
        })(),
      },
      conversionInstructions: {
        carton: cartonConversion,
        conversionNotes:
          convRaw.notes != null && String(convRaw.notes).trim() !== '' ? String(convRaw.notes).trim() : '',
        conversion:
          finishNorm === 'cartons'
            ? {
                sealType: sealTypePrint,
                sealWatertightCritical: watertightSealsCritical,
                cartonSize: cartonSizePrint,
                packing: packingLabelPrint,
                qtyPerFold: qtyPerFoldPrint,
                qtyPerPack: packSizePrint,
                tagPacks: yn(convRaw.tag_packs),
                tagCtn: yn(convRaw.tag_ctn),
                ventSummary: ventSummaryPrint,
                ventPosition: ventPositionPrint,
                ventHoleSizeMm: ventHoleSizeMmPrint,
                highlightVentHoleSize: highlightVentHoleSizePrint,
                vented: yn(ventedConversion),
                handle: yn(convRaw.handle),
                linedCartons: yn(convRaw.lined_cartons),
                highlightSeal: highlightConversionSeal,
                highlightCartonSize: highlightConversionCartonSize,
                highlightPacking: highlightConversionPacking,
                highlightQtyPerFold: highlightConversionQtyPerFold,
                highlightQtyPerPack: highlightConversionQtyPerPack,
                highlightTagPacks: highlightConversionTagPacks,
                highlightTagCtn: highlightConversionTagCtn,
                highlightVent: highlightConversionVent,
                highlightVented: ventedConversion,
                highlightHandle: highlightConversionHandle,
                highlightLinedCartons: highlightConversionLinedCartons,
                ...(showPrintPositionDetailsOnConv
                  ? {
                      printPositionDetails: printPositionDetailsOnConv,
                      printPositionDetailsHighlight: printPositionDetailsHighlightOnConv,
                    }
                  : {}),
              }
            : null,
      },
      extrusionSetup: {
        extruderLabel: productionExtruderCode != null ? productionExtruderCode : '',
        dieSizeMm: extruderDieSizeMm,
      },
      utecoPrinting,
      packingDimensionShorthandForConversion,
    }
  }, [data, quoteRatebook.data, productSpecBundle.additives, productSpecBundle.colours, productSpecBundle.resinBlends, productSpecBundle.resins])

  if (freshLoadDone && err && !data && entry?.status === 'failed') {
    return (
      <div className="js-print-root">
        <p>
          <strong>Error:</strong> {err}
        </p>
        <p>
          <Link to="/job-sheets">Back to job sheets</Link>
        </p>
      </div>
    )
  }

  if (!freshLoadDone || !model) {
    return (
      <div className="js-print-root">
        <p>Loading…</p>
      </div>
    )
  }

  const e = model.extrusion
  const qty = e.orderQuantities
  const extrusionSetup = model.extrusionSetup
  const conv = model.conversionInstructions
  const ship = model.shipping
  const coresLinePrint = e.coresLine ? String(e.coresLine).trim() : ''
  const highlightExtrusionCoreType = coresLinePrint !== '' && coresLinePrint.toLowerCase() !== '13mm'
  const palletTypePrint = ship.palletType ? String(ship.palletType).trim() : ''
  const highlightExtrusionPalletType = palletTypePrint !== '' && palletTypePrint.toLowerCase() !== 'chep'
  const extruderCodePrint = extrusionSetup.extruderLabel
    ? formatExtruderCodeForPrint(extrusionSetup.extruderLabel)
    : '-'
  const extrusionRunFlags = buildExtrusionRunFlags(e)
  const metersPerRollDisplay = perRollQtyDisplay(qty.mPerRollFormatted)
  const kgPerRollWithCoreDisplay = perRollQtyDisplay(qty.kgPerRollWithCoreFormatted)
  const hasConversionPrintPage = Boolean(conv.conversion || conv.carton)
  const shippingOnFirstPage = ship.finishModeKey !== 'cartons' || !hasConversionPrintPage
  const p = model.printingLayout
  const printMethodNorm = String(p.method || '').trim().toLowerCase()
  const isUtecoPrinted = Boolean(p.printed && printMethodNorm === 'uteco')
  const isInlinePrinted = Boolean(p.printed && printMethodNorm === 'inline')
  const printPath = jobSheetId ? `/job-sheets/${encodeURIComponent(jobSheetId)}/print` : ''
  const editHref = jobSheetId
    ? `/job-sheets/${encodeURIComponent(jobSheetId)}/edit?returnTo=${encodeURIComponent(printPath || '/job-sheets')}`
    : '/job-sheets'

  const artworkFiles = model.artworkFiles ?? []

  return (
    <>
      <style>{`
        .js-print-root, .js-print-root .js-sec, .js-print-root .js-sub, .js-print-root .js-tol, .js-print-root .js-pink, .js-print-root .js-yellow, .js-print-root .js-blue, .js-print-root .js-resin-mix-hl, .js-print-root .js-qc-title, .js-print-root .js-print-printing-form-title, .js-print-root tr.js-print-qty-stock-hl {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        /* Inline perforated (not bag on roll): blue title */
        .js-title.js-perf-hl {
          background: #dff1ff !important;
        }
        /* Inline perforated bag on roll: yellow title */
        .js-title.js-yellow {
          background: #fff566 !important;
        }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: A4; }
          .js-print-root {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 16px 18px !important;
            font-size: 13pt !important;
            line-height: 1.25;
            box-shadow: none !important;
            background: #fff !important;
          }
        }
        .js-print-root {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          color: #000;
          width: 210mm;
          max-width: calc(100vw - 24px);
          margin: 0 auto 16px;
          --js-print-page-padding: 16px 18px;
          padding: var(--js-print-page-padding);
          font-size: 13px;
          line-height: 1.35;
          font-weight: 400;
          background: #fff;
          box-sizing: border-box;
          box-shadow: 0 0 0 1px #d6d6d6;
          --js-print-fs-body: 13px;
          --js-print-fs-label: 12px;
          --js-print-fs-title: 16px;
          --js-print-fs-dim-primary: 16px;
          --js-print-fw-label: 500;
          --js-print-fw-value: 600;
        }
        .js-title {
          text-align: center;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-title);
          padding: 10px 8px;
          border: 1px solid #000;
          margin-bottom: 8px;
        }
        .js-title--spread {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          text-align: left;
        }
        .js-title-part {
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
          overflow: visible;
        }
        .js-title-part--job {
          text-align: left;
        }
        .js-title-part--customer {
          text-align: center;
          flex: 1 1 0;
        }
        .js-title-part--finish {
          text-align: center;
          flex: 1 1 auto;
        }
        .js-title-part--product {
          text-align: right;
        }
        .js-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
        .js-extrusion-grid { width: 100%; }
        .js-print-extrusion-specs {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .js-grid td, .js-grid th {
          border: 1px solid #000;
          padding: 5px 7px;
          vertical-align: top;
          word-break: break-word;
        }
        .js-grid th { font-weight: var(--js-print-fw-label); font-size: var(--js-print-fs-label); text-align: left;}
        .js-grid td { font-weight: var(--js-print-fw-value); font-size: var(--js-print-fs-body); }
        .js-print-primary-text {
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 700;
          line-height: 1.2;
        }
        .js-grid td.js-print-primary-text,
        .js-grid th.js-print-primary-text {
          font-size: var(--js-print-fs-dim-primary);
          font-weight: var(--js-print-fw-value);
        }
        /* Keep row height when a value cell is empty (padding alone can collapse in some print engines). */
        .js-grid > tbody > tr > th,
        .js-grid > tbody > tr > td {
          min-height: 2.75em;
          box-sizing: border-box;
        }
        .js-grid > tbody > tr > th:empty::before,
        .js-grid > tbody > tr > td:empty::before {
          content: '\\00a0';
        }
        .js-grid td.js-sec {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          height: 25px;
        }
        .js-grid td.js-sub {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-grid td.js-blue { font-weight: var(--js-print-fw-value); }
        .js-grid td.js-td-mixed { font-weight: var(--js-print-fw-value); }
        .js-grid td.js-product-outer { padding: 0 !important; }
        .js-product-split {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
        }
        .js-product-split td {
          border: none;
          padding: 5px 7px;
          vertical-align: top;
        }
        .js-product-split td.js-product-qty {
          border-left: 1px solid #000;
          width: 25%;
        }
        .js-product-split td.js-product-left {
          width: 75%;
        }
        .js-product-k { font-weight: var(--js-print-fw-label); }
        .js-product-code-val {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-sec {
          background: #f1f1f1;
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value);
        }
        .js-sub {
          background: #f1f1f1;
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value) !important;
        }
        .js-tol { background: #fff566; font-size: var(--js-print-fs-body) !important;}
        .js-pink { background: #ffc8d8 !important;}
        .js-yellow { background: #fff566 !important;}
        .js-blue { background: #b4d7ff !important;}
        .js-perf-bg { background: #dff1ff !important;}
        .js-hl-value {
          display: inline;
          padding: 2px 5px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .js-muted {
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
        }
        .js-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; }
        .js-dim-wrap { padding: 0 !important; }
        .js-extrusion-dim-run-cell .js-dim-grid { margin-bottom: 0; }
        .js-dim-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 8px; }
        .js-dim-grid th.js-dim-h {
          border-top: 2px solid #000;
          background: #f1f1f1;
          font-weight: 700;
          text-align: center;
          padding: 3px 6px;
          font-size: var(--js-print-fs-label);
        }
        .js-dim-grid th.js-dim-h:first-child {
          border-left: 2px solid #000;
        }
        .js-dim-grid th.js-dim-h:last-child {
          border-right: 2px solid #000;
        }
        .js-dim-grid tr.js-dim-row-primary td.js-dim-col,
        .js-dim-grid tr.js-dim-row-secondary td.js-dim-col {
          border-left: 1px solid #000;
          border-right: 1px solid #000;
          background: #e8e8e8;
          padding: 0;
          vertical-align: top;
          width: 33.33%;
        }
        .js-dim-grid tr.js-dim-row-primary td.js-dim-col {
          // border: none;
        }
        .js-dim-grid tr.js-dim-row-secondary td.js-dim-col {
          border-top: 1px solid #000;
          border-bottom: 2px solid #000;
        }
        .js-dim-grid tr.js-dim-row-primary td.js-dim-col:first-child,
        .js-dim-grid tr.js-dim-row-secondary td.js-dim-col:first-child {
          border-left: 2px solid #000;
        }
        .js-dim-grid tr.js-dim-row-primary td.js-dim-col:last-child,
        .js-dim-grid tr.js-dim-row-secondary td.js-dim-col:last-child {
          border-right: 2px solid #000;
        }
        .js-dim-primary {
          background: #e8e8e8;
          padding: 8px 10px;
          text-align: center;
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 700;
          line-height: 1.2;
        }
        .js-dim-primary.js-dim-primary-hl {
          background: #fff566;
        }
        .js-dim-primary-unit {
          font-size: var(--js-print-fs-body);
          font-weight: 400;
        }
        .js-dim-primary-unit-m {
          font-weight: 700;
          font-size: var(--js-print-fs-dim-primary);
        }
        .js-dim-primary.js-dim-primary-left { text-align: left; }
        .js-dim-secondary {
          background: #e8e8e8;
          padding: 6px 8px;
          font-weight: 700;
          font-size: var(--js-print-fs-body);
          white-space: normal;
        }
        .js-extrusion-run-flags {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          column-gap: 1.25em;
          row-gap: 8px;
          align-items: center;
          justify-content: space-between;
        }
        .js-extrusion-run-flags--run-requirements {
          justify-content: flex-start;
        }
        .js-extrusion-run-flag {
          display: inline-flex;
          align-items: baseline;
          white-space: nowrap;
          line-height: 1.4;
          gap: 2px;
        }
        .js-extrusion-run-flag--extruder {
          align-items: center;
        }
        .js-extrusion-run-flag--inline-punch {
          flex-basis: 100%;
          width: 100%;
          align-items: center;
          white-space: normal;
        }
        .js-extrusion-inline-punch-cell {
          display: inline-block;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          line-height: 1.35;
        }
        .js-extrusion-inline-punch-cell.js-hl-value {
          display: inline-block;
        }
        .js-extrusion-inline-punch-sep,
        .js-extrusion-inline-punch-position {
          display: inline;
        }
        .js-extrusion-extruder-value {
          display: inline-flex;
          align-items: center;
          flex-wrap: nowrap;
          line-height: 1.2;
        }
        .js-extrusion-extruder-code {
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 700;
        }
        .js-extrusion-extruder-die {
          font-size: var(--js-print-fs-body);
          font-weight: 400;
        }
        .js-dim-secondary.js-dim-secondary-hl { background: #fff566; }
        .js-run-triple { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
        .js-run-triple td {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          border: 1px solid #000;
          padding: 6px 8px;
          width: 25%;
        }
        .js-headline-split {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
        }
        .js-headline-split td {
          border: none;
          text-align: center;
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value);
          width: 50%;
        }
        .js-headline-split .js-headline-value {
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 700;
          line-height: 1.2;
        }
        .js-headline-split .js-headline-label {
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
          padding-bottom: 2px;
        }
        .js-extrusion-product-headline {
          text-align: center;
          padding: 4px 8px;
        }
        .js-extrusion-spec-label {
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-extrusion-spec-line {
          padding: 5px 7px;
          vertical-align: middle;
        }
        .js-extrusion-dim-inline {
          display: inline;
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 700;
          line-height: 1.2;
        }
        .js-extrusion-dim-inline.js-dim-primary-hl {
          background: #fff566;
          padding: 0 2px;
        }
        .js-extrusion-dim-sep {
          font-size: var(--js-print-fs-body);
          font-weight: 400;
          margin: 0 0.15em;
        }
        .js-run-triple > tbody > tr > td {
          min-height: 2.5em;
          box-sizing: border-box;
        }
        .js-run-triple > tbody > tr > td:empty::before {
          content: '\\00a0';
        }
        .js-resin-mix-hl { background: #fff566; }
        .js-resin-mix-blend-wrap {
          padding: 0 !important;
          vertical-align: top;
        }
        .js-resin-mix-blend-caption {
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value);
          padding: 5px 7px 3px;
          background: #f1f1f1;
        }
        .js-resin-mix-blend-bar {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
        }
        .js-resin-mix-blend-bar td {
          border: none;
          font-size: var(--js-print-fs-body);
          vertical-align: middle;
          word-break: break-word;
          box-sizing: border-box;
        }
        .js-resin-mix-blend-bar td.js-resin-mix-blend-resin {
          font-weight: var(--js-print-fw-value);
        }
        .js-resin-mix-blend-bar td.js-resin-mix-blend-pct {
          width: 5.5em;
          font-weight: var(--js-print-fw-value);
          text-align: right;
          white-space: nowrap;
        }
        .js-resin-mix-blend--ld .js-resin-mix-blend-bar td {
          background: #fff;
        }
        .js-resin-mix-blend--preset .js-resin-mix-blend-bar td { background: #fff; }
        .js-resin-mix-blend--custom .js-resin-mix-blend-bar td { background: #fff; }
        .js-resin-mix-blend--ld {
          background: #fff;
        }
        .js-resin-mix-blend--preset {
          background: #fff9cc;
        }
        .js-extrusion-grid td.js-resin-blend-table-wrap {
          padding: 0 !important;
          height: 1px; // take minimum height so that the cell does not grow with empty content
        }
        .js-resin-blend-table-wrap .js-resin-mix-blend-caption {
          border: none;
          border-bottom: 1px solid #000;
          margin: 0;
        }
        .js-resin-blend-table {
          width: 100%;
          border-collapse: collapse;
          margin: 0;
          border: none;
        }
        .js-resin-blend-table th,
        .js-resin-blend-table td {
          border: 1px solid #000;
          padding: 5px 7px;
          font-size: var(--js-print-fs-body);
          vertical-align: middle;
          word-break: break-word;
        }
        /* Inner grid lines only — outer edge comes from the wrap td (.js-grid border). */
        .js-resin-blend-table tr:first-child > th,
        .js-resin-blend-table tr:first-child > td {
          border-top: none;
        }
        .js-resin-blend-table tr:last-child > th,
        .js-resin-blend-table tr:last-child > td {
          border-bottom: none;
        }
        .js-resin-blend-table th:first-child,
        .js-resin-blend-table td:first-child {
          border-left: none;
        }
        .js-resin-blend-table th:last-child,
        .js-resin-blend-table td:last-child {
          border-right: none;
        }
        .js-resin-blend-table th {
          background: #f1f1f1;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          text-align: left;
        }
        .js-resin-blend-table .js-resin-blend-col-resin {
          width: 42%;
          font-weight: var(--js-print-fw-value);
        }
        .js-resin-blend-table .js-resin-blend-col-resin--hl {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .js-resin-blend-table .js-resin-blend-col-pct,
        .js-resin-blend-table .js-resin-blend-col-kg,
        .js-resin-blend-table .js-resin-blend-col-waste {
          width: 12%;
          text-align: right;
          white-space: nowrap;
        }
        .js-resin-blend-table .js-resin-blend-col-total {
          width: 14%;
          text-align: right;
          white-space: nowrap;
          background: #fff9cc;
          font-weight: 700;
        }
        .js-resin-blend-table tr.js-resin-blend-total-row td {
          font-weight: 700;
          background: #f1f1f1;
        }
        .js-resin-blend-table tr.js-resin-blend-total-row td.js-resin-blend-col-total {
          background: #fff566;
        }

        .js-printing-wrap {
          padding: 0 !important;
          vertical-align: top;
          border-left: none !important;
          border-right: none !important;
        }
        .js-printing-nested {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
          font-size: 14px;
        }
        .js-printing-nested > tbody > tr > th {
          background: #f1f1f1;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          text-align: left;
          border: 1px solid #000;
          padding: 4px 6px;
          vertical-align: top;
        }
        .js-printing-nested > tbody > tr > td {
          border: 1px solid #000;
          padding: 4px 6px;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          vertical-align: top;
          word-break: break-word;
        }
        .js-printing-nested > tbody > tr > th,
        .js-printing-nested > tbody > tr > td {
          min-height: 2.6em;
          box-sizing: border-box;
        }
        .js-printing-nested > tbody > tr > th:empty::before,
        .js-printing-nested > tbody > tr > td:empty::before {
          content: '\\00a0';
        }
        .js-printing-nested .js-print-block { padding: 5px 7px; }
        .js-print-k {
          display: block;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          margin-bottom: 3px;
        }
        .js-print-v {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-pre { white-space: pre-wrap; }
        .js-print-ink {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4px;
          font-size: var(--js-print-fs-body);
        }
        .js-print-ink th,
        .js-print-ink td {
          border: 1px solid #000;
          padding: 3px 6px;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          min-height: 2.2em;
          box-sizing: border-box;
        }
        .js-print-ink th:empty::before,
        .js-print-ink td:empty::before {
          content: '\\00a0';
        }
        .js-print-ink thead th {
          background: #f2f2f2;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
        }
        .js-print-ink-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: var(--js-print-fw-value);
        }
        .js-compact {
          border: 1px solid #000;
          padding: 8px 10px;
          margin-bottom: 8px;
        }
        .js-compact-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px 10px;
        }
        .js-compact-item {
          display: flex;
          gap: 6px;
          align-items: baseline;
          margin-bottom: 4px;
          min-width: 0;
        }
        .js-compact-k {
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          white-space: nowrap;
        }
        .js-compact-v {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          min-width: 0;
          word-break: break-word;
        }
        .js-compact-block {
          margin-top: 6px;
          gap: 6px;
          display: flex;
          flex-direction: column;
        }
        .js-order-header-summary-line {
          display: block;
          margin-top: 6px;
          font-size: var(--js-print-fs-title);
          font-weight: var(--js-print-fw-value);
          line-height: 1.35;
        }
        .js-order-header-desc-line {
          display: block;
          margin-top: 4px;
        }
        .js-order-header-desc-line .js-compact-v {
          display: block;
          width: 100%;
        }
        .js-order-header-desc-primary {
          display: block;
          width: 100%;
        }
        .js-order-header-desc-secondary,
        .js-order-header-notes {
          width: 100%;
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value);
          line-height: 1.35;
        }
        .js-quality-list {
          list-style: none;
          margin: 4px 0 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 4px 6px;
          align-items: center;
        }
        .js-quality-list li {
          display: inline-flex;
          align-items: center;
          margin: 0;
          padding: 2px 7px;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
          line-height: 1.25;
          border: 1px solid #000;
          border-radius: 3px;
          background: #f1f1f1;
        }
        .js-print-ink-num { width: 2rem; text-align: center; }
        .js-print-barcode-block { padding-top: 4px !important; padding-bottom: 5px !important; }
        .js-print-barcode-k {
          font-size: var(--js-print-fs-label) !important;
          font-weight: var(--js-print-fw-label) !important;
          margin-bottom: 2px !important;
        }
        .js-print-barcode-v {
          font-size: var(--js-print-fs-body) !important;
          font-weight: var(--js-print-fw-value) !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .js-manual-wrap {
          padding: 0 !important;
          vertical-align: top;
        }
        .js-extruder-output-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: var(--js-print-fs-body);
        }
        .js-extruder-output-table th,
        .js-extruder-output-table td {
          border: 1px solid #000;
          padding: 4px 2px;
          vertical-align: middle;
          text-align: center;
          word-break: break-word;
          min-height: 1.85em;
          box-sizing: border-box;
        }
        .js-extruder-output-table td {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-extruder-output-table th {
          background: #f1f1f1;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
          line-height: 1.15;
        }
        .js-extruder-output-table td:first-child,
        .js-extruder-output-table th:first-child {
          width: 5%;
        }
        .js-extruder-output-table--pageable thead {
          display: table-header-group;
        }
        .js-extruder-output-chunk + .js-extruder-output-chunk {
          margin-top: 0;
        }
        .js-title.js-title--extruder-repeat {
          margin-bottom: 8px;
        }
        .js-qc-checklist {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--js-print-fs-body);
          table-layout: auto;
        }
        .js-qc-checklist th,
        .js-qc-checklist td {
          border: 1px solid #000;
          padding: 5px 6px;
          vertical-align: middle;
          box-sizing: border-box;
        }
        .js-qc-checklist td.js-qc-title {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          background: #f1f1f1;
        }
        .js-qc-checklist .js-qc-check-for {
          text-align: left;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          width: 40%;
        }
        .js-qc-checklist .js-qc-wi {
          width: 12%;
          text-align: center;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-qc-checklist .js-qc-narrow {
          width: 10.66%;
          text-align: center;
        }
        .js-qc-checklist .js-qc-details-label {
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          text-align: left;
          height: 46px;
          vertical-align: top
        }
        .js-print-page-break {
          page-break-before: always;
          break-before: page;
        }
        .js-print-uteco-sheet {
          font-size: var(--js-print-fs-body);
          line-height: 1.4;
          margin-bottom: 6px;
          padding: 0;
          box-sizing: border-box;
        }
        .js-print-uteco-card {
          border: 1px solid #000;
          padding: 14px 18px 16px;
          margin-bottom: 14px;
          background: #fff;
          box-sizing: border-box;
        }
        .js-print-uteco-card:last-child { margin-bottom: 0; }
        .js-print-uteco-field {
          margin-bottom: 12px;
        }
        .js-print-description-card {
          margin-top: 12px;
          padding: 10px 12px 12px;
        }
        .js-print-uteco-field:last-child { margin-bottom: 0; }
        .js-print-uteco-label {
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          margin-bottom: 4px;
        }
        .js-print-uteco-label--table {
          margin-bottom: 6px;
        }
        .js-print-uteco-value {
          display: block;
          width: 100%;
          box-sizing: border-box;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          min-height: 1.25em;
          padding: 2px 2px 2px;
          border-bottom: 1px solid #111;
        }
        .js-print-uteco-meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px 18px;
          margin-top: 2px;
        }
        .js-print-uteco-meta-grid .js-print-uteco-field {
          margin-bottom: 0;
        }
        .js-print-uteco-cyl-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px 14px;
          margin-bottom: 12px;
        }
        .js-print-uteco-cyl-grid .js-print-uteco-field {
          margin-bottom: 0;
        }
        .js-print-uteco-split-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 18px;
          margin-bottom: 12px;
        }
        .js-print-uteco-split-grid .js-print-uteco-field {
          margin-bottom: 0;
        }
        .js-print-uteco-2col {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px 20px;
          align-items: start;
          margin-bottom: 0;
        }
        .js-print-uteco-col-right {
          padding-top: 0;
        }
        .js-print-uteco-col-right .js-print-uteco-field:first-child {
          margin-top: 0;
        }
        .js-print-uteco-deck-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .js-print-uteco-deck-table th,
        .js-print-uteco-deck-table td {
          border: 1px solid #000;
          padding: 6px 8px;
          vertical-align: top;
          box-sizing: border-box;
        }
        .js-print-uteco-deck-table th {
          background: #f1f1f1;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
        }
        .js-print-uteco-deck-table td {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          padding: 6px 8px;
        }
        .js-print-uteco-deck-table td:first-child {
          width: 22%;
          text-align: center;
        }
        .js-print-uteco-table-value {
          display: block;
          width: 100%;
          box-sizing: border-box;
          min-height: 1.25em;
          padding: 1px 0 5px;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          text-align: inherit;
        }
        .js-print-deck-colour-freetext {
          font-weight: var(--js-print-fw-value);
        }
        .js-print-deck-ink-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-deck-ink-code--paired {
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-value);
        }
        .js-print-uteco-deck-table td:first-child .js-print-uteco-table-value {
          text-align: center;
        }
        .js-print-conversion-sheet {
          padding: 0;
          box-sizing: border-box;
        }
        .js-print-conversion-sheet .js-title {
          margin-bottom: 4px;
          font-size: var(--js-print-fs-title);
        }
        .js-print-conversion-sheet .js-compact {
          margin-bottom: 10px;
        }
        .js-print-extrusion-qc-sheet {
          padding: 0;
          box-sizing: border-box;
          --js-extrusion-qc-fs-body: 11px;
          --js-extrusion-qc-fs-label: 10px;
          --js-extrusion-qc-fs-title: 14px;
          font-size: var(--js-extrusion-qc-fs-body);
          line-height: 1.2;
        }
        .js-print-extrusion-qc-sheet .js-title,
        .js-print-extrusion-qc-sheet .js-title-part,
        .js-print-extrusion-qc-sheet .js-compact,
        .js-print-extrusion-qc-sheet .js-compact-k,
        .js-print-extrusion-qc-sheet .js-compact-v,
        .js-print-extrusion-qc-sheet .js-order-header-notes,
        .js-print-extrusion-qc-sheet .js-order-header-desc-secondary,
        .js-print-extrusion-qc-sheet .js-order-header-summary-line,
        .js-print-extrusion-qc-sheet .js-quality-list li {
          line-height: 1.35;
        }
        .js-print-extrusion-qc-sheet .js-grid {
          margin-bottom: 6px;
        }
        .js-print-extrusion-qc-sheet .js-grid th,
        .js-print-extrusion-qc-sheet .js-grid td {
          padding: 2px 2px;
          font-size: var(--js-extrusion-qc-fs-body);
          white-space: normal;
          word-break: break-word;
        }
        .js-print-extrusion-qc-sheet .js-grid th {
          font-size: var(--js-extrusion-qc-fs-label);
        }
        .js-print-extrusion-qc-sheet .js-grid > tbody > tr > th,
        .js-print-extrusion-qc-sheet .js-grid > tbody > tr > td {
          min-height: 1.35em;
        }
        .js-print-extrusion-qc-sheet .js-grid td.js-sec {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-extrusion-qc-fs-body);
          height: auto;
          min-height: 1.35em;
        }
        .js-print-extrusion-qc-sheet .js-extrusion-details-table th {
          font-weight: var(--js-print-fw-label);
          width: 14%;
        }
        .js-print-extrusion-qc-sheet .js-extrusion-details-notes {
          min-height: 2.5em;
          vertical-align: top;
        }
        .js-print-extrusion-qc-sheet .js-qc-checklist th,
        .js-print-extrusion-qc-sheet .js-qc-checklist td {
          padding: 2px 2px;
          font-size: var(--js-extrusion-qc-fs-body);
        }
        .js-print-extrusion-qc-sheet .js-qc-checklist td.js-qc-title {
          font-size: var(--js-extrusion-qc-fs-body);
        }
        .js-print-extrusion-qc-sheet .js-qc-checklist .js-qc-check-for,
        .js-print-extrusion-qc-sheet .js-qc-checklist .js-qc-wi,
        .js-print-extrusion-qc-sheet .js-qc-checklist .js-qc-details-label {
          font-size: var(--js-extrusion-qc-fs-label);
        }
        .js-print-extrusion-qc-sheet .js-qc-checklist .js-qc-details-label {
          height: 32px;
        }
        .js-print-extrusion-qc-sheet .js-extruder-output-table {
          font-size: var(--js-extrusion-qc-fs-body);
        }
        .js-print-extrusion-qc-sheet .js-extruder-output-table th,
        .js-print-extrusion-qc-sheet .js-extruder-output-table td {
          padding: 2px 2px;
          font-size: var(--js-extrusion-qc-fs-body);
          min-height: 1.25em;
        }
        .js-print-extrusion-qc-sheet .js-extruder-output-table th {
          font-size: var(--js-extrusion-qc-fs-label);
          line-height: 1.1;
        }
        .js-extrusion-cert-side-note {
          min-height: 92px;
        }
        .js-conv-sheet {
          border: 1px solid #000;
          font-size: 13px;
          line-height: 1.25;
        }
        .js-conv-head,
        .js-conv-box,
        .js-conv-ops {
          width: 100%;
          border-collapse: collapse;
        }
        .js-conv-head td,
        .js-conv-box td,
        .js-conv-box th,
        .js-conv-ops td,
        .js-conv-ops th {
          border: 1px solid #000;
          padding: 4px 6px;
          vertical-align: top;
          box-sizing: border-box;
        }
        .js-conv-head .js-conv-title {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-conv-main {
          display: grid;
          grid-template-columns: 58% 42%;
        }
        .js-conv-subtitle {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          background: #f1f1f1;
          height: 1.8em;
          vertical-align: middle;
          box-sizing: border-box;
          line-height: 1.25;
        }
        .js-conv-box > tbody > tr > .js-conv-subtitle:empty::before {
          content: '\\00a0';
        }
        .js-conv-box th {
          width: 35%;
          text-align: left;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-conv-vent-cell .js-conv-vent-position {
          margin-top: 0.35em;
        }
        .js-conv-ops th {
          text-align: center;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-conv-ops td {
          min-height: 1.9em;
        }
        .js-conv-footer {
          display: grid;
          grid-template-columns: 60% 40%;
        }
        .js-conv-comment { height: 70px; }
        .js-conv-qc th {
          text-align: left;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-conv-dimension {
          text-align: center;
          font-size: 11px;
          vertical-align: middle;
        }
        .js-conv-dimension-label {
          font-weight: var(--js-print-fw-label);
          text-align: center;
          padding: 3px 6px;
          font-size: var(--js-print-fs-label);
        }
        .js-conv-dimension-value {
          padding: 8px 10px;
          text-align: center;
        }
        .js-conv-qc th.js-conv-qc-corner {
          width: 34%;
          min-width: 4.5rem;
          font-size: 11px;
          vertical-align: middle;
        }
        .js-conv-qc th.js-conv-qc-phase-h {
          width: 13.2%;
          text-align: center;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-label);
          vertical-align: middle;
        }
        .js-conv-qc tbody > tr:not(:first-child) > th:first-child {
          width: 34%;
          text-align: left;
        }
        .js-conv-qc td {
          text-align: center;
          min-height: 1.8em;
        }
        .js-print-uteco-sheet .js-print-barcode-v {
          font-size: var(--js-print-fs-body) !important;
        }
        @media screen {
          .js-print-page-break {
            margin-top: 28px;
            padding-top: 20px;
            border-top: 1px dashed #bbb;
          }
        }
        .js-print-inline-block-wrap {
          width: 100%;
          margin-bottom: 8px;
          box-sizing: border-box;
        }
        .js-print-inline-ink-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
          padding-top: 10px;
        }
        .js-print-inline-ink-table th,
        .js-print-inline-ink-table td {
          border: 1px solid #000;
          padding: 2px 6px;
          vertical-align: top;
          word-break: break-word;
        }
        .js-print-inline-ink-table th {
          background: #f1f1f1;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
        }
        .js-print-inline-ink-th-deck {
          width: 15%;
          text-align: center;
        }
        .js-print-inline-ink-th-plate {
          width: 30%;
        }
        .js-print-inline-ink-td-deck {
          text-align: center;
          font-weight: var(--js-print-fw-value);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: var(--js-print-fs-body);
        }
        .js-print-inline-ink-td-colour {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-inline-ink-td-plate {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-inline-ink-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-printing-form {
          border: 1px solid #000;
          padding: 10px 12px 12px;
        }
        .js-print-printing-form-title {
          margin: -10px -12px 10px -12px;
          padding: 5px 12px;
          border-bottom: 1px solid #000;
          background: #f1f1f1;
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
        }
        .js-print-form-field { margin-bottom: 10px; }
        .js-print-form-field:last-child { margin-bottom: 0; }
        .js-print-form-k {
          display: block;
          font-weight: var(--js-print-fw-label);
          font-size: var(--js-print-fs-label);
          margin-bottom: 2px;
        }
        .js-print-form-v {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          word-break: break-word;
          min-height: 1.25em;
          padding: 2px 0 4px 0;
          border-bottom: 1px solid black;
        }
        .js-print-form-row-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 10px;
        }
        .js-print-form-row-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 10px;
        }
        .js-print-form-row-2 .js-print-form-field,
        .js-print-form-row-3 .js-print-form-field {
          margin-bottom: 0;
        }
        .js-print-ink-form-row {
          border: 1px solid #000;
          padding: 8px 10px;
          margin-bottom: 8px;
        }
        .js-print-ink-form-row:last-child { margin-bottom: 0; }
        .js-print-ink-form-row .js-print-form-field { margin-bottom: 8px; }
        .js-print-ink-form-row .js-print-form-field:last-child { margin-bottom: 0; }
        .js-ship-pallet-checklist-cell {
          vertical-align: top;
        }
        .js-ship-packing-notes-text {
          font-weight: var(--js-print-fw-value);
          font-size: var(--js-print-fs-body);
          white-space: pre-wrap;
          word-break: break-word;
          padding: 4px 6px;
        }
        .js-ship-pallet-checklist {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 8px;
          align-items: stretch;
          width: 100%;
          box-sizing: border-box;
        }
        .js-ship-pallet-tick {
          border: 1px solid #000;
          min-width: 2.1rem;
          text-align: center;
          padding: 3px 5px 4px;
          font-size: var(--js-print-fs-label);
          font-weight: var(--js-print-fw-value);
          line-height: 1.2;
          box-sizing: border-box;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        tr.js-print-qty-stock-hl > th,
        tr.js-print-qty-stock-hl > td {
          font-weight: var(--js-print-fw-value);
          background: #fff566;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .js-print-table-shipping {
          margin-top: 14px;
          table-layout:auto;
        }
        .js-ship-overproduction {
          margin-top: 0.35em;
          font-size: 0.92em;
          font-weight: var(--js-print-fw-value);
        }
        .js-ship-overproduction.js-pink,
        .js-ship-overproduction.js-yellow {
          display: inline-block;
          padding: 0.15em 0.35em;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .js-print-artwork-file-list {
          margin: 0;
          padding-left: 1.1em;
          font-size: var(--js-print-fs-body);
          font-weight: var(--js-print-fw-value);
        }
        .js-print-artwork-file-list li { margin: 0.15em 0; }
      `}</style>

      <div className="js-print-root">
        <div className="js-actions no-print">
          <Button variant="text" color="primary" component={Link} to={editHref}>
            Edit job sheet
          </Button>
          {artworkFiles.length === 0 ? (
            <Button type="button" variant="contained" color="primary" onClick={() => window.print()}>
              Print job sheet
            </Button>
          ) : null}
        </div>

        {jobSheetId && artworkFiles.length > 0 ? (
          <JobSheetPrintWorkflowPanel
            jobSheetId={jobSheetId}
            files={artworkFiles}
            onPrintJobSheet={() => window.print()}
          />
        ) : null}

        <JobSheetPrintOrderHeader
          titleHighlight={model.titleHighlight}
          header={model.header}
          product={model.product}
        />

        <div className="js-print-extrusion-specs">
          <table className="js-grid js-extrusion-grid">
            <tbody>
              <tr><td className="js-sec" colSpan={6}>Extrusion specifications</td></tr>
              <tr>
                <td colSpan={6} className="js-extrusion-spec-line" aria-label="Extrusion setup">
                  <div className="js-extrusion-run-flags">
                    <div className="js-extrusion-run-flag js-extrusion-run-flag--extruder">
                      <span className="js-extrusion-spec-label">Extruder: </span>
                      <span className="js-extrusion-extruder-value">
                        <span className="js-extrusion-extruder-code">{extruderCodePrint}</span>
                        {extrusionSetup.dieSizeMm != null ? (
                          <span className="js-extrusion-extruder-die">
                            ({String(extrusionSetup.dieSizeMm)}mm die)
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Cores: </span>
                      <b className={printHlValueClass(highlightExtrusionCoreType && 'js-yellow')}>
                        {coresLinePrint || '-'}
                      </b>
                    </div>
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Pallets: </span>
                      <b className={printHlValueClass(highlightExtrusionPalletType && 'js-yellow')}>
                        {palletTypePrint || '-'}
                      </b>
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <td colSpan={6} className="js-extrusion-spec-line" aria-label="Extrusion dimensions">
                  <div className="js-extrusion-run-flags">
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Dimensions:</span>{' '}
                      <span className="js-extrusion-dim-inline">
                        <span>{e.widthPrimarySingle ?? '-'}</span>
                        <span className="js-dim-primary-unit">mm</span>
                      </span>
                      <span className="js-extrusion-dim-sep">x</span>
                      <span className="js-extrusion-dim-inline">
                        {String(e.lengthUnits ?? '')
                          .trim()
                          .toLowerCase() === 'continuous' ? (
                          <span className={printHlValueClass('js-yellow')}>continuous</span>
                        ) : e.lengthUnits === 'M' ? (
                          <span className={printHlValueClass('js-yellow')}>
                            <span>{e.lengthLine || '-'}</span>
                            <span className="js-dim-primary-unit js-dim-primary-unit-m">{e.lengthUnits}</span>
                          </span>
                        ) : (
                          <>
                            <span>{e.lengthLine || '-'}</span>
                            <span className="js-dim-primary-unit">{e.lengthUnits}</span>
                          </>
                        )}
                      </span>
                      <span className="js-extrusion-dim-sep">x</span>
                      <span className="js-extrusion-dim-inline">
                        <span>{e.gaugeLine || '-'}</span>
                        <span className="js-dim-primary-unit">µm</span>
                      </span>
                    </div>
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Number of rolls: </span>
                      <b>{qty.extruderOutputRollCount > 0 ? fmtCount(qty.extruderOutputRollCount) : '-'}</b>
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <td colSpan={6} className="js-extrusion-spec-line" aria-label="Extrusion order quantities">
                  <div className="js-extrusion-run-flags">
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Ordered Meters: </span>
                      <b
                        className={printHlValueClass(
                          qty.highlightOrderedM && qty.orderedM ? 'js-yellow' : undefined,
                        )}
                      >
                        {qty.orderedM || '-'}
                      </b>
                    </div>
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Meters per roll: </span>
                      <b
                        className={printHlValueClass(
                          qty.highlightOrderedM && metersPerRollDisplay !== '-' ? 'js-yellow' : undefined,
                        )}
                      >
                        {metersPerRollDisplay}
                      </b>
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <td colSpan={6} className="js-extrusion-spec-line" aria-label="Extrusion roll quantities">
                  <div className="js-extrusion-run-flags">
                    
                  <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">Ordered KG: </span>
                      <b
                        className={printHlValueClass(
                          qty.highlightOrderedKg && qty.orderedKg ? 'js-yellow' : undefined,
                        )}
                      >
                        {qty.orderedKg || '-'}
                      </b>
                      {qty.coreWeightIncludedKg != null && qty.coreWeightIncludedKg > 0 ? (
                        <span className="js-extrusion-core-weight-note">
                          {' ('}
                          <span className="js-extrusion-spec-label">including </span>
                          <b>{formatExtrusionQty(qty.coreWeightIncludedKg)}kg</b>
                          <span className="js-extrusion-spec-label"> core weight</span>
                          {')'}
                        </span>
                      ) : null}
                    </div>
                    <div className="js-extrusion-run-flag">
                      <span className="js-extrusion-spec-label">KG per roll: </span>
                      <b
                        className={printHlValueClass(
                          qty.highlightOrderedKg && kgPerRollWithCoreDisplay !== '-' ? 'js-yellow' : undefined,
                        )}
                      >
                        {kgPerRollWithCoreDisplay}
                      </b>
                      {kgPerRollWithCoreDisplay !== '-' ? (
                        <span className="js-extrusion-spec-label"> (with core)</span>
                      ) : null}
                    </div>
                  </div>
                </td>
              </tr>
              {e.resinBlendTable ? <JobSheetPrintResinBlendTable table={e.resinBlendTable} /> : null}
              {e.resinBlendFallbackLine ? (
                <tr>
                  <td colSpan={6} className="js-extrusion-spec-line js-resin-spec-cell">
                    <div className="js-extrusion-run-flags">
                      <div className="js-extrusion-run-flag">{e.resinBlendFallbackLine}</div>
                    </div>
                  </td>
                </tr>
              ) : null}
              {extrusionRunFlags.length > 0 ? (
                <tr>
                  <td colSpan={6} className="js-extrusion-spec-line" aria-label="Extrusion run requirements">
                    <div className="js-extrusion-run-flags js-extrusion-run-flags--run-requirements">
                      {extrusionRunFlags.map((flag) => (
                        <div
                          key={flag.key}
                          className={`js-extrusion-run-flag${flag.flagClassName ? ` ${flag.flagClassName}` : ''}`}
                        >
                          <span className="js-extrusion-spec-label">{flag.label}: </span>
                          {flag.valueNode != null ? (
                            flag.valueNode
                          ) : (
                            <b className={flag.valueClassName}>{flag.value}</b>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {isInlinePrinted ? <JobSheetPrintInlinePrintingBlock p={p} /> : null}
        </div>

        {shippingOnFirstPage ? <JobSheetPrintShippingDetailsTable ship={ship} /> : null}

        <div className="js-print-page-break">
          <JobSheetPrintExtrusionQcPage
            titleHighlight={model.titleHighlight}
            header={model.header}
            product={model.product}
            extruderOutputRollCount={qty.extruderOutputRollCount}
          />
        </div>

        {isUtecoPrinted ? (
          <div className="js-print-page-break">
             <JobSheetPrintOrderHeader
              titleHighlight={model.titleHighlight}
              header={model.header}
              product={model.product}
              printingFooter={{
                printDescription: p.printDescription,
                barcode: p.barcode,
              }}
            />
            <JobSheetPrintUtecoPage u={model.utecoPrinting} />
          </div>
        ) : null}

        {conv.conversion || conv.carton ? (
          <div className="js-print-page-break">
            <JobSheetPrintConversionInstructionsPage
              conv={conv}
              orderHeader={{
                titleHighlight: model.titleHighlight,
                header: model.header,
                product: model.product,
              }}
              packingDimensionShorthand={model.packingDimensionShorthandForConversion}
              shipping={ship.finishModeKey === 'cartons' && hasConversionPrintPage ? ship : null}
            />
          </div>
        ) : null}

      </div>
    </>
  )
}

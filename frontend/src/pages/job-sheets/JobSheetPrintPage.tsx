import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import type { SpecPayload } from '../../components/SpecPayloadForm'
import { JobSheetPrintOrderHeader, type JobSheetPrintOrderHeaderModel } from './components/JobSheetPrintOrderHeader'

/** Film geometry suffix for Uteco “Film Type Supplied” (e.g. …, Gusseted). */
function geometryLabelForUtecoFilmSupplied(dimsGeometry: unknown, productTypeRaw: unknown): string {
  const g = String(dimsGeometry ?? '')
    .trim()
    .toLowerCase()
  const p = String(productTypeRaw ?? '')
    .trim()
    .toLowerCase()
  if (p === 'u-film' || p === 'u_film' || p === 'ufilm') return 'U-Film'
  if (g === 'gusset' || g === 'bottomgusset' || g === 'bottom_gusset') return 'Gusseted'
  if (g === 'centrefold' || g === 'centerfold') return 'Centrefold'
  if (g === 'sheet') return 'Sheet'
  if (g === 'flat' || g === 'layflat') return 'Layflat'
  const head = displayGeometryHeadline(dimsGeometry)
  return head || ''
}

function buildUtecoDeckColourRows(
  front: Array<{ ink: string; plate: string; colourText: string }>,
  back: Array<{ ink: string; plate: string; colourText: string }>,
  printSideRaw: unknown,
  numColoursRaw: unknown,
): Array<{ deck: number; colour: string }> {
  const colourCell = (row: { ink: string; plate: string; colourText: string }) => {
    const t = String(row.colourText ?? '').trim()
    if (t) return t
    const ink = String(row.ink ?? '').trim()
    if (ink) return ink
    return ''
  }
  const side = String(printSideRaw ?? '')
    .trim()
    .toLowerCase()
  const rows: Array<{ deck: number; colour: string }> = []
  let deck = 1
  const pushFront = side === '' || side === 'front' || side === 'both'
  const pushBack = side === 'back' || side === 'both'
  if (pushFront) {
    for (const r of front) {
      rows.push({ deck: deck++, colour: colourCell(r) })
    }
  }
  if (pushBack) {
    for (const r of back) {
      rows.push({ deck: deck++, colour: colourCell(r) })
    }
  }
  const nCol = n(numColoursRaw)
  const target =
    nCol != null && nCol > 0 && Number.isFinite(nCol) ? Math.max(rows.length, Math.round(nCol)) : rows.length
  while (rows.length < target) {
    rows.push({ deck: rows.length + 1, colour: '' })
  }
  return rows.map((r, i) => ({ deck: i + 1, colour: r.colour }))
}
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'
import { fetchProductSpecBundle } from '../../store/slices/productSpecSlice'
import { fetchQuoteRatebook } from '../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals, computeQuickQuotePreview } from '../../utils/quoteCalculator'
import { buildSpecQuantitySliceFromPersistedJobSheet } from '../../utils/jobSheetQuantityFromApi'
import { buildQuickQuoteInputsFromSpec, type SpecQuantitySlice } from '../../utils/specToQuoteInputs'
import { computeProductDescriptionFromSpec } from '../../utils/productDescription'
import {
  jobSheetDescriptionWithPackagingTail,
  jobSheetOrderQuantityLabel,
} from '../../utils/quoteQuantityDescriptors'
import { fmtCount, fmtQtyNumber } from '../../utils/quoteFormat'
import { derivedInlineSeal } from '../../utils/specCompat'
import { runUpNumericalFromSlug } from '../../utils/runUpNumerical'

function s(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  const t = String(v).trim()
  return t === '' ? fallback : t
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

type ResinMixPrintRow =
  | {
      kind: 'blend'
      variant: 'ld' | 'preset' | 'custom'
      caption: string
      segments: Array<{ code: string; label: string; pct: number }>
    }
  | {
      kind: 'label_pct'
      label: string
      pct: number
      highlight: boolean
      bgHex?: string | null
      textColor?: string | null
    }
  | { kind: 'line'; text: string; highlight: boolean; bgHex?: string | null; textColor?: string | null }

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
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '')
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

function formatSealType(v: unknown): string {
  const x = String(v ?? '').trim().toLowerCase()
  if (x === '') return ''
  if (x === 'side') return 'Side'
  if (x === 'end') return 'End'
  if (x === 'none') return 'None'
  return s(v)
}

function yn(v: unknown): string {
  return v ? 'Y' : 'N'
}

function valueOrDash(v: unknown): string {
  const t = String(v ?? '').trim()
  return t === '' ? '-' : t
}

function formatEyeSpot(v: unknown): string {
  const x = String(v ?? '').trim().toLowerCase()
  if (x === '') return ''
  if (x === 'yes') return 'Yes'
  if (x === 'no') return 'No'
  return s(v)
}

function formatKgPerRoll(kprNum: number | null): string {
  return kprNum != null && kprNum > 0 && Number.isFinite(kprNum) ? `${fmtQtyNumber(kprNum, 2)}kg/roll` : ''
}

function formatRollWeightBilling(v: unknown): string {
  const x = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  if (x === '') return ''
  if (
    x === 'core_included' ||
    x === 'include_core' ||
    x === 'include' ||
    x === 'with_core'
  ) {
    return 'Include Core'
  }
  if (
    x === 'core_off' ||
    x === 'exclude_core' ||
    x === 'exclude' ||
    x === 'without_core' ||
    x === 'no_core'
  ) {
    return 'Exclude Core'
  }
  if (x === 'core_half_off' || x === 'half_core' || x === 'half') return 'Half Core'
  return s(v)
}

/** Legacy specs sometimes only set `packaging.core_policy` (quote import / older saves). */
function rollBillingRawFromCorePolicy(policy: unknown): unknown {
  const x = String(policy ?? '')
    .trim()
    .toLowerCase()
  if (x === 'include') return 'core_included'
  if (x === 'exclude') return 'core_off'
  if (x === 'half') return 'core_half_off'
  return undefined
}

function pickRollWeightBillingRaw(
  identity: Record<string, any>,
  spec: Record<string, any>,
  packaging?: Record<string, any>,
): unknown {
  const id = identity || {}
  const sp = spec || {}
  const pack = packaging || {}
  const fromPolicy = rollBillingRawFromCorePolicy(pack.core_policy)
  return (
    id.roll_weight_billing ??
    (id as { rollWeightBilling?: unknown }).rollWeightBilling ??
    sp.roll_weight_billing ??
    (sp.identity as { roll_weight_billing?: unknown } | undefined)?.roll_weight_billing ??
    fromPolicy
  )
}

/** Print model for the 5-column “Order quantities” block (main job sheet + extrusion QC). */
type JobSheetPrintOrderQuantitiesModel = {
  orderedM: string
  orderedKg: string
  highlightOrderedM: boolean
  highlightOrderedKg: boolean
  rollsDisplay: string
  /** Row label before rolls count, e.g. “Num. Rolls” / “Num. Ctns”. */
  rollsLabel: string
  mPerRollFormatted: string
  kgPerRollFormatted: string
  wasteLines: string[]
  totalRecommendedKg: string
  suggestedRollWeight: string | null
  suggestedRollWeightExplanation: string | null
  qtyUnitRaw: string
  rollWeightBilling: string
  extruderOutputRollCount: number
}

function jobSheetPrintOrderQuantitiesRows(q: JobSheetPrintOrderQuantitiesModel): ReactNode {
  const wasteInner =
    q.wasteLines.length > 0 ? (
      <div className="js-oq-waste-lines">
        {q.wasteLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    ) : (
      '\u00a0'
    )
    
  return (
    <>
      <tr>
        <td className="js-sec js-oq-sec-title" colSpan={1}>
          {q.rollsLabel}
        </td>
        <th className={`js-sec${q.highlightOrderedM ? ' js-pink' : ''}`}>Ordered M</th>
        <th className={`js-sec${q.highlightOrderedKg ? ' js-pink' : ''}`}>Ordered KG</th>
        <th className="js-sec">Recommended KG</th>
        <th className="js-sec">Waste estimates</th>
      </tr>
      <tr>
        <td className="js-qty-billing">
          <span>Billing: </span>
          { q.qtyUnitRaw == 'kg' ? (
            <div style={{'display': 'inline-block'}}>
              <span className="js-print-val"> Per KG</span>
              <div className="js-print-val">{ q.rollWeightBilling }</div>
            </div>
          ) : (
            <span className="js-print-val">Per {q.qtyUnitRaw}</span>
          )}
        </td>
        <td className={q.highlightOrderedM ? 'js-pink' : undefined}>
          {q.orderedM ? <span className="js-print-val">{q.orderedM}</span> : <span className="js-print-val" />}
        </td>
        <td className={q.highlightOrderedKg ? 'js-pink' : undefined}>
          {q.orderedKg ? <span className="js-print-val">{q.orderedKg}</span> : <span className="js-print-val" />}
        </td>
        <td >
          <span className="js-print-val">{q.totalRecommendedKg}</span>
        </td>
        <td className="js-oq-waste-cell">
          {wasteInner}
        </td>
      </tr>
      <tr>
        <td>{q.rollsDisplay ? q.rollsDisplay : <span className="js-print-val" />}</td>
        <td className={q.highlightOrderedM ? 'js-pink' : undefined}>
          {q.mPerRollFormatted ? q.mPerRollFormatted : <span className="js-print-val" />}
        </td>
        <td className={q.highlightOrderedKg ? 'js-pink' : undefined}>
          {q.kgPerRollFormatted ? q.kgPerRollFormatted : <span className="js-print-val" />}
        </td>
        <td >
          {q.suggestedRollWeight ? <span className="js-print-val">{q.suggestedRollWeight}</span> : <span className="js-print-val" />}
        </td>
        <td>
          {q.suggestedRollWeightExplanation ? <span className="js-print-val">{q.suggestedRollWeightExplanation}</span> : <span className="js-print-val" />}
        </td>
      </tr>
    </>
  )
}

function formatExtruderCodeForPrint(label: string): string {
  const t = String(label ?? '').trim()
  if (t === '') return ''
  if (t.startsWith('#')) return t
  if (/^\d+$/.test(t)) return `#${t}`
  return t
}

function displayGeometryLabel(raw: unknown): string {
  const label = s(raw)
  if (label === '') return ''
  const normalized = label.trim().toLowerCase()
  if (normalized === 'flat') return 'Layflat'
  if (normalized === 'centerfold') return 'Centrefold'
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
  if (normalized === 'sheet') return 'Sheet'
  return displayGeometryLabel(raw)
}

function displayGeometryMode(rawGeometry: unknown, rawProductType: unknown): string {
  const g = String(rawGeometry ?? '')
    .trim()
    .toLowerCase()
  const p = String(rawProductType ?? '')
    .trim()
    .toLowerCase()
  if (p === 'u-film' || p === 'u_film' || p === 'ufilm') return 'U-Film'
  if (p === 'centerfold' || p === 'centrefold') return 'Centrefold'
  if (p === 'sheet') return 'Single Sheet'
  if (p === 'tube') {
    if (g === 'gusset' || g === 'bottomgusset' || g === 'bottom_gusset') return 'Gusseted Tube'
    return 'Layflat Tube'
  }
  return displayGeometryHeadline(rawGeometry)
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
  const gusset = Number(dims.gusset_mm || 0) > 0
  const geoTag =
    geom === 'Gusset' || geom === 'BottomGusset' || gusset ? 'G' : geom === 'CentreFold' ? 'C/F' : 'L/F'
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

function JobSheetPrintInkFormList(props: {
  rows: Array<{ ink: string; plate: string; colourText: string }>
  showPlate: boolean
}): ReactNode {
  const { rows, showPlate } = props
  if (rows.length === 0) return <div className="js-print-form-v">—</div>
  return (
    <div className="js-print-ink-form-list">
      {rows.map((r, i) => (
        <div key={`${r.ink}-${r.plate}-${r.colourText}-${i}`} className="js-print-ink-form-row">
          <div className="js-print-form-field">
            <span className="js-print-form-k">{`Colour ${i + 1}`}</span>
            <div className="js-print-form-v js-print-pre">{r.colourText || '—'}</div>
          </div>
          <div className="js-print-form-field">
            <span className="js-print-form-k">Ink code</span>
            <div className="js-print-form-v js-print-ink-mono">{r.ink || '—'}</div>
          </div>
          {showPlate ? (
            <div className="js-print-form-field">
              <span className="js-print-form-k">Plate</span>
              <div className="js-print-form-v js-print-ink-mono">{r.plate || '—'}</div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
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

function JobSheetPrintPrintingFormField(props: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="js-print-form-field">
      <span className="js-print-form-k">{props.label}</span>
      <div className="js-print-form-v">{props.children}</div>
    </div>
  )
}

function JobSheetPrintInlinePrintingBlock(props: {
  p: {
    printDescription: string
    numColours: string
    printSide: string
    printPosition: string
    eyeSpot: string
    frontRows: Array<{ ink: string; plate: string; colourText: string }>
    backRows: Array<{ ink: string; plate: string; colourText: string }>
    legacyInkPlate: string | null
    cylinder: string
    platesAround: string
    platesAcross: string
  }
}): ReactNode {
  const { p } = props
  const showCylinderRow = Boolean(
    (p.cylinder && p.cylinder.trim() !== '') ||
      (p.platesAround && p.platesAround.trim() !== '') ||
      (p.platesAcross && p.platesAcross.trim() !== ''),
  )
  return (
    <JobSheetPrintPrintingFormShell title="Inline printing">
      <JobSheetPrintPrintingFormField label="Print description">
        {p.printDescription ? <span className="js-print-pre">{p.printDescription}</span> : '—'}
      </JobSheetPrintPrintingFormField>
      <div className="js-print-form-row-2">
        <JobSheetPrintPrintingFormField label="No. colours">{valueOrDash(p.numColours)}</JobSheetPrintPrintingFormField>
        <JobSheetPrintPrintingFormField label="Print side">{valueOrDash(p.printSide)}</JobSheetPrintPrintingFormField>
      </div>
      <JobSheetPrintPrintingFormField label="Print position details">
        {p.printPosition ? <span className="js-print-pre">{p.printPosition}</span> : '—'}
      </JobSheetPrintPrintingFormField>
      <JobSheetPrintPrintingFormField label="Eye spot">{valueOrDash(p.eyeSpot)}</JobSheetPrintPrintingFormField>
      <JobSheetPrintPrintingFormField label="Ink colours">
        <JobSheetPrintInkFormList rows={p.frontRows} showPlate />
      </JobSheetPrintPrintingFormField>
      <JobSheetPrintPrintingFormField label="Back print">
        <JobSheetPrintInkFormList rows={p.backRows} showPlate />
      </JobSheetPrintPrintingFormField>
      {p.legacyInkPlate ? (
        <JobSheetPrintPrintingFormField label="Legacy ink / plate codes">
          <span className="js-print-pre">{p.legacyInkPlate}</span>
        </JobSheetPrintPrintingFormField>
      ) : null}
      {showCylinderRow ? (
        <div className="js-print-form-row-3">
          <JobSheetPrintPrintingFormField label="Cylinder">{valueOrDash(p.cylinder)}</JobSheetPrintPrintingFormField>
          <JobSheetPrintPrintingFormField label="Around">{valueOrDash(p.platesAround)}</JobSheetPrintPrintingFormField>
          <JobSheetPrintPrintingFormField label="Across">{valueOrDash(p.platesAcross)}</JobSheetPrintPrintingFormField>
        </div>
      ) : null}
    </JobSheetPrintPrintingFormShell>
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
    filmTypeSupplied: string
    finishedBagSize: string
    sealTypeLabel: string
    eyeSpotLabel: string
    deckColours: Array<{ deck: number; colour: string }>
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
        <JobSheetPrintUtecoField label="Print position details">
          <span className="js-print-pre">{u.printPosition || blankLine}</span>
        </JobSheetPrintUtecoField>
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
                  <th>Deck</th>
                  <th>Colour</th>
                </tr>
              </thead>
              <tbody>
                {u.deckColours.length ? (
                  u.deckColours.map((r) => (
                    <tr key={r.deck}>
                      <td>
                        <div className="js-print-uteco-table-value">{r.deck}</div>
                      </td>
                      <td>
                        <div className="js-print-uteco-table-value js-print-pre">{r.colour || blankLine}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td>
                      <div className="js-print-uteco-table-value">1</div>
                    </td>
                    <td>
                      <div className="js-print-uteco-table-value">{blankLine}</div>
                    </td>
                  </tr>
                )}
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

type JobSheetPrintConversionModel = {
  carton: { bagsPerCarton: string; totalCartons: string } | null
  conversion: {
    sealType: string
    cartonSize: string
    packLayFlat: string
    tagPacks: string
    tagCtn: string
    vent: string
    pack: string
    innerPack: string
    loose: string
    qtyToStock: string
    sendAllBags: string
    handle: string
    linedCartons: string
  } | null
}

function JobSheetPrintExtrusionQcPage(props: {
  perforated: boolean
  header: JobSheetPrintOrderHeaderModel['header']
  product: JobSheetPrintOrderHeaderModel['product']
  q: JobSheetPrintOrderQuantitiesModel
}): ReactNode {
  const { perforated, header, product, q } = props
  return (
    <div className="js-print-extrusion-qc-sheet">
      <JobSheetPrintOrderHeader
        titleLine="EXTRUSION QC SHEET"
        perforated={perforated}
        header={header}
        product={product}
      />

      <table className="js-grid js-order-qty-grid">
        <tbody>{jobSheetPrintOrderQuantitiesRows(q)}</tbody>
      </table>

      <table className="js-grid js-extruder-settings-table">
        <tbody>
          <tr>
            <td className="js-sec" colSpan={12}>
              EXTRUDER SETTINGS
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

      <table className="js-grid">
        <tbody>
          <tr>
            <td className="js-sec" colSpan={6}>
              Extruder output
            </td>
          </tr>
          <tr>
            <td colSpan={6} className="js-manual-wrap">
              <table className="js-extruder-output-table" role="presentation">
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
                  {Array.from({ length: q.extruderOutputRollCount }, (_, rollIdx) => (
                    <tr key={`extruder-out-qc-${rollIdx}`}>
                      <td>{rollIdx + 1}</td>
                      {Array.from({ length: 11 }, (_, c) => (
                        <td key={`extruder-out-qc-${rollIdx}-c-${c}`}>{'\u00a0'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="js-grid">
        <tbody>
          <tr>
            <td colSpan={6} className="js-manual-wrap">
              <table className="js-qc-checklist" role="presentation">
                <tbody>
                  <tr>
                    <td colSpan={6} className="js-qc-title">
                      Quality control checklist (non-food grade)
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
                  <tr>
                    <td colSpan={6} className="js-qc-notes">
                      {'\u00a0'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function JobSheetPrintConversionInstructionsPage(props: {
  conv: JobSheetPrintConversionModel
  meta: {
    orderNumber: string
    formDate: string
    customer: string
    productDescription: string
    width: string
    length: string
    gauge: string
  }
}): ReactNode {
  const { conv, meta } = props
  const dash = '—'
  const v = (x: unknown) => {
    const t = String(x ?? '').trim()
    return t === '' ? dash : t
  }
  return (
    <div className="js-print-conversion-sheet">
      <div className="js-conv-sheet">
        <table className="js-conv-head" role="presentation">
          <tbody>
            <tr>
              <td className="js-conv-title">CONVERSION SHEET - BAGS</td>
              <td>Form date: {v(meta.formDate)}</td>
            </tr>
            <tr>
              <td>Order number: {v(meta.orderNumber)}</td>
              <td>Customer: {v(meta.customer)}</td>
            </tr>
            <tr>
              <td colSpan={2}>Product: {v(meta.productDescription)}</td>
            </tr>
          </tbody>
        </table>

        <div className="js-conv-main">
          <table className="js-conv-box" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={2}>
                  Final specification after setup
                </td>
              </tr>
              <tr>
                <th>Width (mm)</th>
                <td>{v(meta.width)}</td>
              </tr>
              <tr><th>Length</th><td>{v(meta.length)}</td></tr>
              <tr><th>Gauge</th><td>{v(meta.gauge)}</td></tr>
              <tr><th>Total cartons</th><td>{v(conv.carton?.totalCartons)}</td></tr>
              <tr><th>Bags per carton</th><td>{v(conv.carton?.bagsPerCarton)}</td></tr>
              <tr><th>Seal</th><td>{v(conv.conversion?.sealType)}</td></tr>
              <tr><th>Carton size</th><td>{v(conv.conversion?.cartonSize)}</td></tr>
            </tbody>
          </table>

          <table className="js-conv-box" role="presentation">
            <tbody>
              <tr>
                <td className="js-conv-subtitle" colSpan={2}>
                  Conversion details
                </td>
              </tr>
              <tr><th>Pack Lay Flat</th><td>{v(conv.conversion?.packLayFlat)}</td></tr>
              <tr><th>Tag Packs</th><td>{v(conv.conversion?.tagPacks)}</td></tr>
              <tr><th>Tag Ctn</th><td>{v(conv.conversion?.tagCtn)}</td></tr>
              <tr><th>Vent</th><td>{v(conv.conversion?.vent)}</td></tr>
              <tr><th>Pack</th><td>{v(conv.conversion?.pack)}</td></tr>
              <tr><th>Inner Pack</th><td>{v(conv.conversion?.innerPack)}</td></tr>
              <tr><th>Loose</th><td>{v(conv.conversion?.loose)}</td></tr>
              <tr><th>Qty to Stock</th><td>{v(conv.conversion?.qtyToStock)}</td></tr>
              <tr><th>Send all bags</th><td>{v(conv.conversion?.sendAllBags)}</td></tr>
              <tr><th>Handle</th><td>{v(conv.conversion?.handle)}</td></tr>
              <tr><th>Lined Cartons</th><td>{v(conv.conversion?.linedCartons)}</td></tr>
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
              <tr><td className="js-conv-subtitle">Special comments for setup of bagging machine</td></tr>
              <tr><td className="js-conv-comment">{'\u00a0'}</td></tr>
            </tbody>
          </table>
          <table className="js-conv-box js-conv-qc" role="presentation">
            <tbody>
              <tr><td className="js-conv-subtitle" colSpan={6}>QC checks</td></tr>
              <tr><th>Operator 1</th><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td></tr>
              <tr><th>Operator 2</th><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td></tr>
              <tr><th>Water test checks</th><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td><td>{'\u00a0'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
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

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
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
    const invoiceNo = js.invoice_no ?? ''
    const purchaseOrderNo = js.customer_purchase_order_number ?? js.purchase_order_no ?? ''
    const orderDate = js.order_date ?? ''
    const dueDate = js.due_date ?? ''
    const jobCode = js.job_no ?? ''
    const productCode = js.product_code ?? ''
    const specTyped = spec as SpecPayload
    const computedSpecDescription = computeProductDescriptionFromSpec(specTyped)
    const productDescription =
      String(computedSpecDescription || '').trim() ||
      String(js.customer_facing_description || '').trim() ||
      String(js.product_description || '').trim()
    const notes = identity?.notes ?? run?.notes ?? packaging?.notes ?? spec?.notes ?? ''
    const qualityChecks = Array.isArray(quality?.flags)
      ? quality.flags
      : Array.isArray(spec?.quality_checks)
        ? spec.quality_checks
        : []

    const productType = identity?.product_type ?? spec?.product_type ?? ''
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
    const geometryLabelRaw = dimensions?.geometry ?? spec?.geometry ?? ''
    const widthMm = n(dimensions?.base_width_mm ?? spec?.base_width_mm)
    const widthShorthandWmm = widthMm != null && widthMm > 0 ? `${Math.round(widthMm)} mm` : ''
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

    const widthSplitMm: number[] = []
    if (ufilmLeftMm != null && ufilmLeftMm > 0) widthSplitMm.push(Math.round(ufilmLeftMm))
    if (widthMm != null && widthMm > 0) widthSplitMm.push(Math.round(widthMm))
    if (ufilmRightMm != null && ufilmRightMm > 0) widthSplitMm.push(Math.round(ufilmRightMm))
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
      if (widthSplitMm.length >= 2) return `${widthSplitMm.map((x) => Math.round(x)).join('/')}`
      if (widthMm != null && widthMm > 0) return `${widthMm}`
      return widthShorthandWmm
    })()

    const lengthLine = s(
      String(dimensions?.length_units ?? '').trim().toLowerCase() === 'continuous'
        ? ''
        : dimensions?.length_units === 'M'
          ? `${dimensions.base_length_mm / 1000}`
          : `${dimensions.base_length_mm}`,
    )
    const lengthUnits = s(dimensions?.length_units ?? spec?.length_units ?? '')
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
    const treatHighlight: 'inside' | 'outside' | '' = (() => {
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
    const perforated = !!run?.inline_perforation
    const holePunched = !!run?.hole_punched
    const productTypeNorm = String(productType || '')
      .trim()
      .toLowerCase()
    const runUpNotApplicable = ['bag', 'tube', 'sleeve'].includes(productTypeNorm)

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
        bagsPerCarton: bpcN != null && bpcN > 0 ? String(Math.max(1, Math.round(bpcN))) : '',
        totalCartons: totalCtns != null ? String(totalCtns) : '',
      }
    }

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
    if (explicitParts.length > 0) {
      baseParts = explicitParts
    } else if (!legacyBlendCodeOnly) {
      const lookupKey = hasExplicitBlendType ? blendTypeRaw : blendTypeCode
      baseParts = lookupPresetParts(lookupKey)
    }

    const resinLabelForCode = (code: string): string => {
      const hit = resinOpts.find((r) => String(r.resin_code ?? '').trim() === code.trim())
      return hit?.name?.trim() ? `${code} · ${hit.name}` : code
    }

    const resinMixRows: ResinMixPrintRow[] = []

    if (baseParts.length > 0) {
      const segments = baseParts.map((p) => ({
        code: p.code,
        label: resinLabelForCode(p.code),
        pct: p.pct,
      }))
      let blendCaption = ''
      if (legacyBlendCodeOnly) {
        blendCaption = `Resin blend code: ${s(spec?.resin_blend_code)}`
      } else {
        const labelKey = hasExplicitBlendType ? blendTypeRaw : 'LD'
        blendCaption = `Resin blend: ${displayBlendTypeLabel(labelKey)}`
      }
      resinMixRows.push({ kind: 'blend', variant: blendVariant, caption: blendCaption, segments })
    } else {
      if (legacyBlendCodeOnly) {
        resinMixRows.push({
          kind: 'line',
          text: `Resin blend code: ${s(spec?.resin_blend_code)}`,
          highlight: true,
        })
      } else if (hasExplicitBlendType) {
        resinMixRows.push({
          kind: 'line',
          text: `Resin blend: ${displayBlendTypeLabel(blendTypeRaw)}`,
          highlight: blendVariant !== 'ld',
        })
      } else if (blendRowsSorted.length > 0) {
        resinMixRows.push({
          kind: 'line',
          text: `Resin blend: ${displayBlendTypeLabel('LD')}`,
          highlight: false,
        })
      }
    }

    const colourRows = Array.isArray(formulation?.colour_components) ? formulation.colour_components : []
    for (const row of colourRows) {
      const code = s(row?.colour_code, '')
      const strength = n(row?.strength_pct)
      if (code === '' || strength == null || strength <= 0) continue
      resinMixRows.push({
        kind: 'label_pct',
        label: `Colour ${code}`.trim(),
        pct: strength,
        highlight: false,
        bgHex: colourHexByCode.get(code.trim().toUpperCase()) || colourHexByName.get(code.trim().toUpperCase()) || null,
        textColor: (() => {
          const hx = colourHexByCode.get(code.trim().toUpperCase()) || colourHexByName.get(code.trim().toUpperCase()) || null
          return hx ? textColorForHex(hx) : null
        })(),
      })
    }

    const additiveRows = Array.isArray(formulation?.additives) ? formulation.additives : []
    for (const row of additiveRows) {
      const code = s(row?.additive_code, '')
      const pct = n(row?.pct)
      if (code === '' || pct == null || pct <= 0) continue
      resinMixRows.push({
        kind: 'label_pct',
        label: `Additive ${code}`.trim(),
        pct,
        highlight: true,
      })
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
    const artworkPdfNames = Array.isArray(printing?.artwork_files)
      ? (printing.artwork_files as Array<{ filename?: unknown }>)
          .map((f) => String(f?.filename ?? '').trim())
          .filter(Boolean)
      : []

    const cylMm = n(printing?.cylinder_size_mm)
    const platesAroundDisp =
      printing?.plates_around != null && String(printing.plates_around).trim() !== '' ? s(printing.plates_around) : ''
    const platesAcrossDisp =
      printing?.plates_across != null && String(printing.plates_across).trim() !== '' ? s(printing.plates_across) : ''

    const legacyInkPlate =
      frontInkPlateSimple.length === 0 && backInkPlateSimple.length === 0 && (inkCodesLegacy.length > 0 || plateCodesLegacy.length > 0)
        ? [
            inkCodesLegacy.length ? `Inks: ${inkCodesLegacy.join(', ')}` : '',
            plateCodesLegacy.length ? `Plates: ${plateCodesLegacy.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null

    const printingLayout = {
      printed,
      method: printMethodDisplay,
      printDescription: s(printing?.print_description ?? spec?.printing_notes ?? spec?.print_notes),
      barcode: s(printing?.barcode),
      numColours: s(printing?.num_colours ?? spec?.num_colours),
      printSide: formatPrintSide(printing?.side),
      treatLine: treat,
      printPosition: s(printing?.print_position_notes),
      filmSupplied: formatJobSheetFilmSuppliedFromSpec(specTyped),
      finishedBagSize: formatJobSheetFinishedBagSizeFromSpec(specTyped),
      eyeSpot: formatEyeSpot(printing?.eye_spot),
      artworkRefs: artworkRefs.length ? artworkRefs.map((x) => String(x).trim()).join('; ') : '',
      artworkPdfs: artworkPdfNames.length ? artworkPdfNames.join('; ') : '',
      frontRows: frontInkPlatePrint,
      backRows: backInkPlatePrint,
      legacyInkPlate,
      cylinder: cylMm != null ? `${cylMm} mm` : '',
      platesAround: platesAroundDisp,
      platesAcross: platesAcrossDisp,
    }

    const geoSnapshotForTail =
      derivedTotalM != null || derivedMPerRoll != null
        ? { derivedTotalM: derivedTotalM ?? 0, mPerRoll: derivedMPerRoll }
        : null
    const orderedQuantityLabel = jobSheetOrderQuantityLabel(js as Record<string, unknown>, spec as Record<string, unknown>)
    const descriptionWithPackagingTail = jobSheetDescriptionWithPackagingTail(
      String(productDescription ?? ''),
      js as Record<string, unknown>,
      spec as Record<string, unknown>,
      geoSnapshotForTail,
    )

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
    let utecoFilmTypeSupplied = ''
    if (widthDisplay && gaugeUteco) {
      utecoFilmTypeSupplied = `${widthDisplay} x ${gaugeUteco}`
      if (geoFilmSuffix) utecoFilmTypeSupplied += `, ${geoFilmSuffix}`
    } else if (widthDisplay) {
      utecoFilmTypeSupplied = geoFilmSuffix ? `${widthDisplay}, ${geoFilmSuffix}` : widthDisplay
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

    const sealTypeLabelUteco = formatSealType(run?.seal_type ?? printing?.seal_type) || '—'
    const eyeSpotLabelUteco = formatEyeSpot(printing?.eye_spot) || '—'

    const deckColoursUteco = buildUtecoDeckColourRows(
      frontInkPlatePrint,
      backInkPlatePrint,
      printing?.side,
      printing?.num_colours ?? spec?.num_colours,
    )

    const utecoPrinting = {
      customer: s(customer),
      productDescription: descriptionWithPackagingTail,
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
      filmTypeSupplied: utecoFilmTypeSupplied,
      finishedBagSize: utecoFinishedBagSize,
      sealTypeLabel: sealTypeLabelUteco,
      eyeSpotLabel: eyeSpotLabelUteco,
      deckColours: deckColoursUteco,
    }

    const convRaw = (run?.conversion || {}) as Record<string, unknown>
    const ventRows = n(convRaw.vent_rows)
    const ventHoles = n(convRaw.vent_holes_per_row)
    const ventTotal =
      ventRows != null && ventRows > 0 && ventHoles != null && ventHoles > 0
        ? Math.round(ventRows) * Math.round(ventHoles)
        : 0

    return {
      titleLine: `JOB SHEET ${s(jobCode, '') ? `— ${s(jobCode, '')}` : ''}`.trim(),
      perforated,
      header: {
        customer: s(customer),
        invoiceNo: s(invoiceNo),
        purchaseOrderNo: s(purchaseOrderNo),
        orderDate: s(orderDate),
        dueDate: s(dueDate),
        jobCode: s(jobCode),
      },
      product: {
        productCode: s(productCode),
        productDescription: s(productDescription),
        descriptionWithPackagingTail,
        orderedQuantityLabel,
        notes: s(notes),
        qualityChecks: qualityChecks.map((x: unknown) => s(x, '')).filter(Boolean),
      },
      extrusion: {
        productType: s(productType),
        finishMode: s(finishMode),
        geometryHeadline: displayGeometryMode(geometryLabelRaw, productType),
        productFinishHeadline: `${s(productType)} ${
          String(finishMode || '')
            .trim()
            .toLowerCase() === 'cartons'
            ? 'in Carton'
            : 'on Roll'
        }`,
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
        inlinePerforated: perforated,
        inlinePunched: holePunched,
        runUpLine: runUpNotApplicable ? '-' : runUpLine,
        coresLine,
        orderQuantities: (() => {
          const totalMNum =
            derivedTotalM != null && derivedTotalM > 0 && Number.isFinite(derivedTotalM)
              ? derivedTotalM
              : totalMStored != null && totalMStored > 0 && Number.isFinite(totalMStored)
                ? totalMStored
                : null
          const totalMPrint =
            totalMNum != null && totalMNum > 0 ? `${fmtQtyNumber(totalMNum, 2)}m` : ''

          const kprFromPreview =
            quotePreviewForWaste?.kg_per_roll != null &&
            Number(quotePreviewForWaste.kg_per_roll) > 0 &&
            Number.isFinite(Number(quotePreviewForWaste.kg_per_roll))
              ? Number(quotePreviewForWaste.kg_per_roll)
              : null
          const kprNum =
            finishNorm === 'cartons'
              ? null
              : kprFromPreview != null
                ? kprFromPreview
                : weightPerRoll != null && weightPerRoll > 0
                  ? weightPerRoll
                  : null

          const mprNum =
            derivedMPerRoll != null && derivedMPerRoll > 0 && Number.isFinite(derivedMPerRoll)
              ? derivedMPerRoll
              : null
          const mPerRollPrint =
            mprNum != null && mprNum > 0 ? `${fmtQtyNumber(mprNum, 2)}m` : ''
          const mPerRollFormatted = mPerRollPrint ? `${mPerRollPrint}/roll` : ''
          const kgPerRollFormatted = formatKgPerRoll(kprNum)
          const rwbRaw = pickRollWeightBillingRaw(identity, spec, packaging)
          const hasRwb = rwbRaw != null && String(rwbRaw).trim() !== ''
          const rollWeightBilling = formatRollWeightBilling(
            hasRwb ? rwbRaw : finishNorm !== 'cartons' ? 'core_off' : '',
          )

          const rollsLabel = finishNorm === 'cartons' ? 'Ctns' : 'Rolls'
          const rollsCount =
            finishNorm === 'cartons' &&
            cartonConversion != null &&
            cartonConversion.totalCartons !== '' &&
            Number(cartonConversion.totalCartons) > 0
              ? Math.round(Number(cartonConversion.totalCartons))
              : numRolls

          const rollsDisplay =`${fmtCount(rollsCount)} ${rollsLabel}`

          const orderedKgNum =
            n(quotePreviewForWaste?.totals_kg) ??
            (qtyUnitRaw === 'kg' ? qv : null) ??
            (totalKg != null && totalKg > 0 ? totalKg : null)
          const orderedKgPrint =
            orderedKgNum != null && orderedKgNum > 0 && Number.isFinite(orderedKgNum)
              ? `${fmtQtyNumber(orderedKgNum, 2)}kg`
              : ''

          const coreTypeStr = String(packaging?.core_type ?? spec?.core_type ?? '').trim()
          let coreKgNum: number | null = null
          let suggestedRollWeight: string | null = null
          let suggestedRollWeightExplanation: string | null = null
          if (rb?.cores && coreTypeStr) {
            const crow = (rb.cores as Record<string, { kg_per_meter?: number } | undefined>)[coreTypeStr]
            const kpm = crow?.kg_per_meter != null ? Number(crow.kg_per_meter) : NaN
            const cl =
              quotePreviewForWaste?.core_length_m != null ? Number(quotePreviewForWaste.core_length_m) : NaN
            if (Number.isFinite(kpm) && kpm > 0 && Number.isFinite(cl) && cl > 0) {
              coreKgNum = cl * kpm
              const coreWeightPerRoll = coreKgNum / numRolls
              // if we are including core or half core, add core weight to the roll weight.
              if (rollWeightBilling === 'core_included') {
                suggestedRollWeight = formatKgPerRoll(kprNum ?? 0)
                suggestedRollWeightExplanation = `${coreTypeStr}\u00a0cores: ${formatKgPerRoll(coreWeightPerRoll)}. Included`
              } else if (rollWeightBilling === 'core_half_off') {
                suggestedRollWeight = formatKgPerRoll(coreWeightPerRoll / 2 + (kprNum ?? 0))
                suggestedRollWeightExplanation = `${coreTypeStr}\u00a0cores: ${formatKgPerRoll(coreWeightPerRoll)}. Half`
              } else {
                suggestedRollWeight = formatKgPerRoll(coreWeightPerRoll + (kprNum ?? 0))
                suggestedRollWeightExplanation = `${coreTypeStr}\u00a0cores: ${formatKgPerRoll(coreWeightPerRoll)}. Excluded`
              }
            }
          }


          const wasteLines: string[] = []
          const wkExtr = wasteKg != null && wasteKg > 0 && Number.isFinite(wasteKg) ? wasteKg : null
          if (wkExtr != null) wasteLines.push(`- ${fmtQtyNumber(wkExtr, 1)}kg extrusion waste`)

          const totalBaseNum = totalKgIncludingWasteNum
          const totalRecNum = totalBaseNum != null && Number.isFinite(totalBaseNum) ? totalBaseNum : 0
          const totalRecommendedPrint =
            totalRecNum > 0 && Number.isFinite(totalRecNum) ? `${fmtQtyNumber(totalRecNum, 2)}kg inc waste` : ''

          const extruderOutputRollCount =
            rollsCount != null && rollsCount > 0 ? rollsCount : 5

          return {
            orderedM: totalMPrint,
            orderedKg: orderedKgPrint,
            highlightOrderedM,
            highlightOrderedKg,
            rollsDisplay,
            rollsLabel,
            mPerRollFormatted,
            kgPerRollFormatted,
            suggestedRollWeight,
            suggestedRollWeightExplanation,
            qtyUnitRaw,
            wasteLines,
            totalRecommendedKg: totalRecommendedPrint,
            rollWeightBilling,
            extruderOutputRollCount,
          }
        })(),
        resinMixRows,
      },
      printingLayout,
      shipping: {
        palletType: s(packaging?.pallet_type ?? spec?.pallet_type),
      },
      conversionInstructions: {
        carton: cartonConversion,
        conversion:
          finishNorm === 'cartons'
            ? {
                sealType: formatSealType(run?.seal_type ?? printing?.seal_type ?? 'end') || 'End',
                cartonSize:
                  convRaw.carton_size != null && String(convRaw.carton_size).trim() !== '' ? String(convRaw.carton_size) : '',
                packLayFlat: yn(convRaw.pack_lay_flat),
                tagPacks: yn(convRaw.tag_packs),
                tagCtn: yn(convRaw.tag_ctn),
                vent:
                  ventRows != null && ventRows > 0 && ventHoles != null && ventHoles > 0
                    ? `${Math.round(ventRows)} x ${Math.round(ventHoles)} -> ${ventTotal}`
                    : '',
                pack: convRaw.pack_size != null && String(convRaw.pack_size).trim() !== '' ? String(convRaw.pack_size) : '',
                innerPack: yn(convRaw.inner_pack),
                loose: yn(convRaw.loose),
                qtyToStock:
                  convRaw.qty_to_stock != null && String(convRaw.qty_to_stock).trim() !== '' ? String(convRaw.qty_to_stock) : '',
                sendAllBags: yn(convRaw.send_all_bags),
                handle: yn(convRaw.handle),
                linedCartons: yn(convRaw.lined_cartons),
              }
            : null,
      },
      extrusionSetup: {
        extruderLabel: productionExtruderCode != null ? productionExtruderCode : '',
        dieSizeMm: extruderDieSizeMm,
      },
      utecoPrinting,
    }
  }, [data, quoteRatebook.data, productSpecBundle.colours, productSpecBundle.resinBlends, productSpecBundle.resins])

  if (err && !data && entry?.status === 'failed') {
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

  if (!model) {
    return (
      <div className="js-print-root">
        <p>Loading…</p>
      </div>
    )
  }

  const e = model.extrusion
  const q = e.orderQuantities
  const extrusionSetup = model.extrusionSetup
  const conv = model.conversionInstructions
  const ship = model.shipping
  const p = model.printingLayout
  const printMethodNorm = String(p.method || '').trim().toLowerCase()
  const isUtecoPrinted = Boolean(p.printed && printMethodNorm === 'uteco')
  const isInlinePrinted = Boolean(p.printed && printMethodNorm === 'inline')
  const printPath = jobSheetId ? `/job-sheets/${encodeURIComponent(jobSheetId)}/print` : ''
  const editHref = jobSheetId
    ? `/job-sheets/${encodeURIComponent(jobSheetId)}/edit?returnTo=${encodeURIComponent(printPath || '/job-sheets')}`
    : '/job-sheets'

  const orderQuantitiesRows = jobSheetPrintOrderQuantitiesRows(q)

  return (
    <>
      <style>{`
        .js-print-root, .js-print-root .js-sec, .js-print-root .js-sub, .js-print-root .js-tol, .js-print-root .js-pink, .js-print-root .js-blue, .js-print-root .js-resin-mix-hl, .js-print-root .js-qc-title, .js-print-root .js-print-printing-form-title {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        /* Perforated bag on roll: highlight job title only */
        .js-title.js-perf-hl {
          background: #dff1ff !important;
        }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: A4; }
          .js-print-root {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11pt !important;
            line-height: 1.25;
            box-shadow: none !important;
            background: #fff !important;
          }
        }
        .js-print-root {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          color: #111;
          width: 210mm;
          max-width: calc(100vw - 24px);
          margin: 0 auto 16px;
          padding: 8mm 8mm 6mm;
          font-size: 11px;
          line-height: 1.35;
          font-weight: 600;
          background: #fff;
          box-sizing: border-box;
          box-shadow: 0 0 0 1px #d6d6d6;
          --js-print-fs-body: 11px;
          --js-print-fs-label: 10px;
          --js-print-fs-title: 15px;
          --js-print-fs-dim-primary: 15px;
          --js-print-fw-label: 700;
          --js-print-fw-value: 700;
        }
        .js-title {
          text-align: center;
          font-weight: 800;
          font-size: var(--js-print-fs-title);
          letter-spacing: 0.04em;
          padding: 10px 8px;
          border: 1px solid #000;
          margin-bottom: 8px;
        }
        .js-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
        .js-extrusion-grid { width: 50%; }
        .js-grid td, .js-grid th {
          border: 1px solid #000;
          padding: 5px 7px;
          vertical-align: top;
          word-break: break-word;
        }
        .js-grid th { font-weight: var(--js-print-fw-label); font-size: var(--js-print-fs-label); text-align: left; color: #333; }
        .js-grid td { font-weight: var(--js-print-fw-value); font-size: var(--js-print-fs-body); }
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
        .js-grid td.js-sec { font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
        .js-grid td.js-sub { font-weight: 600; }
        .js-grid td.js-blue { font-weight: 400; }
        .js-grid td.js-td-mixed { font-weight: 400; }
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
        .js-product-k { font-weight: 400; }
        .js-product-code-val {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: 700;
        }
        .js-print-val { font-weight: 700; font-size: var(--js-print-fs-body); }
        .js-sec {
          background: #d9d9d9;
          font-size: var(--js-print-fs-body);
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .js-sub { background: #F0F0F0; font-size: var(--js-print-fs-body); font-weight: 700 !important;}
        .js-tol { background: #fff566; font-size: var(--js-print-fs-body) !important;}
        .js-pink { background: #ffc8d8 !important;}
        .js-blue { background: #b4d7ff !important;}
        .js-perf-bg { background: #dff1ff !important;}
        .js-muted { color: #444; font-size: var(--js-print-fs-label); font-weight: 600; }
        .js-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; }
        .js-dim-wrap { padding: 0 !important; }
        .js-extrusion-dim-run-cell .js-dim-grid { margin-bottom: 0; }
        .js-order-qty-grid { margin-top: 14px; }
        .js-order-qty-grid td.js-oq-head-row-spacer {
          padding: 0 !important;
          height: 0 !important;
          min-height: 0 !important;
          border: none !important;
          line-height: 0;
          font-size: 0;
        }
        .js-order-qty-grid td.js-oq-head-row-spacer::before {
          content: none !important;
        }
        .js-order-qty-grid td.js-oq-sec-title {
          text-transform: none;
        }
        .js-order-qty-grid th.js-sec {
          background: #d9d9d9;
          font-weight: 800;
          text-align: left;
          font-size: var(--js-print-fs-body);
          letter-spacing: 0.04em;
          text-transform: none;
          color: #111;
          border: 1px solid #000;
          padding: 4px 6px;
        }
        .js-order-qty-grid .js-oq-row-label {
          background: #e8e8e8;
          font-weight: 600;
          border: 1px solid #000;
          padding: 4px 6px;
          vertical-align: top;
        }
        .js-order-qty-grid .js-oq-waste-cell {
          vertical-align: top;
          border: 1px solid #000;
          padding: 4px 6px;
        }
        .js-order-qty-grid .js-oq-waste-lines > div {
          line-height: 1.35;
        }
        .js-order-qty-grid .js-oq-total-rec {
          font-size: 14px;
        }
        .js-order-qty-grid .js-oq-foot-row td {
          border: 1px solid #000;
          padding: 4px 6px;
        }
        .js-dim-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 8px; }
        .js-dim-grid th.js-dim-h {
          border: 2px solid #000;
          border-bottom: none;
          background: #d9d9d9;
          font-weight: 700;
          text-align: center;
          padding: 3px 6px;
          font-size: 10px;
          letter-spacing: 0.02em;
        }
        .js-dim-grid td.js-dim-col {
          border: 2px solid #000;
          border-top: none;
          padding: 0;
          vertical-align: top;
          width: 25%;
        }
        .js-dim-stack { display: flex; flex-direction: column; min-height: 100%; }
        .js-dim-primary {
          background: #e8e8e8;
          padding: 8px 10px;
          font-weight: 700;
          flex: 1;
          text-align: center;
          font-size: var(--js-print-fs-dim-primary);
          line-height: 1.2;
        }
        .js-dim-primary.js-dim-primary-hl {
          background: #fff59d;
        }
        .js-dim-primary-unit {
          font-size: var(--js-print-fs-body);
          font-weight: 400;
          color: #444;
        }
        .js-dim-primary-unit-m {
          font-weight: 700;
          font-size: var(--js-print-fs-dim-primary);
          color: #000;
        }
        .js-dim-primary.js-dim-primary-left { text-align: left; }
        .js-dim-secondary {
          background: #e8e8e8;
          padding: 6px 8px;
          font-weight: 700;
          font-size: var(--js-print-fs-body);
          border-top: 1px solid #000;
          white-space: normal;
        }
        .js-print-flag-grid {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
        }
        .js-print-flag-grid td {
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: var(--js-print-fs-label);
          font-weight: 600;
          vertical-align: middle;
          background: #fff;
        }
        .js-print-flag-grid td b {
          font-size: var(--js-print-fs-body);
          font-weight: 700;
          display: block;
        }
        .js-print-flag-grid td.js-print-flag--treat-outside { background: #fff59d; }
        .js-print-flag-grid td.js-print-flag--treat-inside { background: #ffcdd2; }
        .js-print-flag-grid td.js-print-flag-val--yes {
          background: #fff59d;
        }
        .js-dim-secondary.js-dim-secondary-hl { background: #fff59d; }
        .js-run-triple { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
        .js-run-triple td {
          font-weight: 400;
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
          font-weight: 600;
          padding: 10px 6px;
          width: 50%;
        }
        .js-headline-split .js-headline-value {
          font-size: var(--js-print-fs-dim-primary);
          font-weight: 800;
          line-height: 1.2;
        }
        .js-headline-split .js-headline-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #444;
          padding-bottom: 2px;
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
          font-size: 12px;
          font-weight: 600;
          color: #333;
          padding: 5px 7px 3px;
          letter-spacing: 0.02em;
          background: #d9d9d9;
        }
        .js-resin-mix-blend-bar {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
        }
        .js-resin-mix-blend-bar td {
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: 12px;
          vertical-align: middle;
          word-break: break-word;
          box-sizing: border-box;
        }
        .js-resin-mix-blend-bar td.js-resin-mix-blend-resin {
          font-weight: 600;
        }
        .js-resin-mix-blend-bar td.js-resin-mix-blend-pct {
          width: 5.5em;
          font-weight: 700;
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
        .js-resin-mix-blend--custom {
          background: #ffe8ec;
        }

        .js-grid .js-qty-billing {    
          font-size: var(--js-print-fs-label);
          font-weight: 600;
        }
          
        .js-qty-billing span{
           vertical-align: top;
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
          font-size: 12px;
        }
        .js-printing-nested > tbody > tr > th {
          background: #ededed;
          font-weight: 600;
          font-size: 10px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          text-align: left;
          border: 1px solid #000;
          padding: 4px 6px;
          vertical-align: top;
        }
        .js-printing-nested > tbody > tr > td {
          border: 1px solid #000;
          padding: 4px 6px;
          font-weight: 700;
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
          font-weight: 600;
          font-size: 10px;
          color: #333;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .js-print-v { font-weight: 700; font-size: 12px; }
        .js-print-pre { white-space: pre-wrap; }
        .js-print-ink {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4px;
          font-size: 11px;
        }
        .js-print-ink th,
        .js-print-ink td {
          border: 1px solid #000;
          padding: 3px 6px;
          font-weight: 600;
          min-height: 2.2em;
          box-sizing: border-box;
        }
        .js-print-ink th:empty::before,
        .js-print-ink td:empty::before {
          content: '\\00a0';
        }
        .js-print-ink thead th {
          background: #f2f2f2;
          font-size: 10px;
          font-weight: 600;
        }
        .js-print-ink-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: 700;
        }
        .js-compact {
          border: 1px solid #000;
          padding: 8px 10px;
          margin-bottom: 8px;
        }
        .js-compact-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px 10px;
        }
        .js-compact-item {
          display: flex;
          gap: 6px;
          align-items: baseline;
          min-width: 0;
        }
        .js-compact-k {
          font-weight: 600;
          color: #444;
          white-space: nowrap;
          font-size: var(--js-print-fs-label);
        }
        .js-compact-v {
          font-weight: 700;
          font-size: var(--js-print-fs-body);
          min-width: 0;
          word-break: break-word;
        }
        .js-compact-v-strong {
          font-weight: 800;
          font-size: 12px;
          line-height: 1.25;
        }
        .js-compact-block {
          margin-top: 8px;
        }
        .js-quality-list {
          margin: 4px 0 0 18px;
          padding: 0;
          font-weight: 600;
        }
        .js-quality-list li { margin: 1px 0; }
        .js-print-ink-num { width: 2rem; text-align: center; }
        .js-print-barcode-block { padding-top: 4px !important; padding-bottom: 5px !important; }
        .js-print-barcode-k {
          font-size: 9px !important;
          letter-spacing: 0.04em;
          margin-bottom: 2px !important;
        }
        .js-print-barcode-v {
          font-size: 11px !important;
          font-weight: 600;
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
          font-size: 10px;
        }
        .js-extruder-output-table th,
        .js-extruder-output-table td {
          border: 1px solid #000;
          padding: 4px 2px;
          vertical-align: middle;
          text-align: center;
          font-weight: 600;
          word-break: break-word;
          min-height: 1.85em;
          box-sizing: border-box;
        }
        .js-extruder-output-table th {
          background: #ededed;
          font-size: 9px;
          letter-spacing: 0.01em;
          line-height: 1.15;
          font-weight: 700;
        }
        .js-extruder-output-table td:first-child,
        .js-extruder-output-table th:first-child {
          width: 5%;
        }
        .js-qc-checklist {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: var(--js-print-fs-body);
        }
        .js-qc-checklist th,
        .js-qc-checklist td {
          border: 1px solid #000;
          padding: 5px 6px;
          vertical-align: middle;
          box-sizing: border-box;
        }
        .js-qc-checklist td.js-qc-title {
          text-align: center;
          font-weight: 800;
          font-size: var(--js-print-fs-body);
          letter-spacing: 0.03em;
          text-transform: uppercase;
          padding: 8px 6px;
          background: #d9d9d9;
        }
        .js-qc-checklist .js-qc-check-for {
          text-align: left;
          font-weight: 600;
          width: 56%;
        }
        .js-qc-checklist .js-qc-wi {
          width: 12%;
          text-align: center;
          font-weight: 600;
        }
        .js-qc-checklist .js-qc-narrow {
          width: 10.66%;
          text-align: center;
        }
        .js-qc-checklist .js-qc-details-label {
          font-weight: 700;
          text-align: left;
        }
        .js-qc-checklist .js-qc-notes {
          min-height: 6.5rem;
          vertical-align: top;
          text-align: left;
          font-weight: 400;
        }
        .js-print-page-break {
          page-break-before: always;
          break-before: page;
        }
        .js-print-uteco-sheet {
          font-size: 12px;
          line-height: 1.4;
          margin-bottom: 6px;
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
          font-weight: 700;
          color: #444;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .js-print-uteco-label--table {
          margin-bottom: 6px;
        }
        .js-print-uteco-value {
          display: block;
          width: 100%;
          box-sizing: border-box;
          font-weight: 600;
          font-size: 13px;
          color: #111;
          min-height: 1.25em;
          padding: 4px 2px 6px;
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
          background: #ededed;
          font-size: 10px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          font-weight: 700;
          color: #444;
        }
        .js-print-uteco-deck-table td {
          font-weight: 600;
          font-size: 13px;
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
          border-bottom: 1px solid #111;
          font-weight: 600;
          font-size: 13px;
          text-align: inherit;
        }
        .js-print-uteco-deck-table td:first-child .js-print-uteco-table-value {
          text-align: center;
        }
        .js-print-conversion-sheet {
          padding: 16px 18px;
          box-sizing: border-box;
        }
        .js-print-extrusion-qc-sheet {
          padding: 6px 0 0;
          box-sizing: border-box;
          font-size: var(--js-print-fs-body);
          line-height: 1.35;
        }
        .js-print-extrusion-qc-sheet .js-grid {
          margin-bottom: 8px;
        }
        .js-print-extrusion-qc-sheet .js-title {
          font-size: var(--js-print-fs-title);
        }
        .js-extruder-settings-table th,
        .js-extruder-settings-table td {
          font-size: var(--js-print-fs-body);
          white-space: normal;
          word-break: break-word;
        }
        .js-extruder-settings-table td.js-sec {
          font-weight: 800;
        }
        .js-extrusion-cert-side-note {
          min-height: 92px;
        }
        .js-conv-sheet {
          border: 1px solid #000;
          font-size: 11px;
          line-height: 1.25;
        }
        .js-conv-head,
        .js-conv-box,
        .js-conv-ops {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
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
          font-weight: 800;
          letter-spacing: 0.03em;
        }
        .js-conv-main {
          display: grid;
          grid-template-columns: 58% 42%;
        }
        .js-conv-subtitle {
          font-weight: 700;
          background: #f1f1f1;
        }
        .js-conv-box th {
          width: 45%;
          text-align: left;
          font-weight: 700;
        }
        .js-conv-ops th {
          text-align: center;
          font-weight: 700;
          font-size: 10px;
        }
        .js-conv-ops td {
          min-height: 1.9em;
        }
        .js-conv-footer {
          display: grid;
          grid-template-columns: 68% 32%;
        }
        .js-conv-comment { height: 70px; }
        .js-conv-qc th {
          width: 40%;
          text-align: left;
          font-weight: 700;
        }
        .js-conv-qc td {
          text-align: center;
          min-height: 1.8em;
        }
        .js-print-uteco-sheet .js-print-barcode-v {
          font-size: 12px !important;
        }
        @media screen {
          .js-print-page-break {
            margin-top: 28px;
            padding-top: 20px;
            border-top: 1px dashed #bbb;
          }
        }
        .js-order-inline-shell {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin-bottom: 8px;
        }
        .js-order-inline-shell td {
          vertical-align: top;
          border: none;
          padding: 0;
          width: 50%;
          box-sizing: border-box;
        }
        .js-order-inline-shell td.js-order-inline-left { padding-right: 4px; }
        .js-order-inline-shell td.js-order-inline-right { padding-left: 4px; }
        .js-order-inline-shell .js-grid { width: 100%; margin-bottom: 0; }
        .js-print-printing-form {
          border: 1px solid #000;
          padding: 10px 12px 12px;
        }
        .js-print-printing-form-title {
          margin: -10px -12px 10px -12px;
          padding: 8px 12px;
          background: #d9d9d9;
          font-weight: 800;
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .js-print-form-field { margin-bottom: 10px; }
        .js-print-form-field:last-child { margin-bottom: 0; }
        .js-print-form-k {
          display: block;
          font-weight: 600;
          font-size: 10px;
          color: #333;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .js-print-form-v {
          font-weight: 700;
          font-size: 12px;
          word-break: break-word;
          min-height: 1.25em;
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
      `}</style>

      <div className="js-print-root">
        <div className="js-actions no-print">
          <Button variant="text" color="primary" component={Link} to={editHref}>
            Edit job sheet
          </Button>
          <Button type="button" variant="contained" color="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <JobSheetPrintOrderHeader
          titleLine={model.titleLine}
          perforated={model.perforated}
          header={model.header}
          product={model.product}
        />

        <table className="js-grid js-extrusion-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Extrusion specifications</td></tr>
            <tr>
              <td colSpan={6}>
                <table className="js-headline-split" role="presentation">
                  <tbody>
                    <tr>
                      <td className="js-headline-label">Product Type & Finish</td>
                      <td className="js-headline-label">Geometry</td>
                    </tr>
                    <tr>
                      <td className="js-headline-value">{e.productFinishHeadline}</td>
                      <td>{e.geometryHeadline}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td colSpan={6} className="js-dim-wrap js-extrusion-dim-run-cell">
                <table className="js-dim-grid" role="presentation">
                  <thead>
                    <tr>
                      <th className="js-dim-h">Width</th>
                      <th className="js-dim-h">Length</th>
                      <th className="js-dim-h">Gauge</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary"><span>{e.widthPrimarySingle ?? '-'}</span><span className={`js-dim-primary-unit`}>mm</span></div>
                          <div className={`js-dim-secondary${e.widthToleranceHighlight ? ' js-dim-secondary-hl' : ''}`}>
                            {e.widthToleranceDisplay}
                          </div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className={`js-dim-primary${e.lengthUnits === 'M' ? ' js-dim-primary-hl' : ''}`}><span>{e.lengthLine || '-'}</span><span className={`js-dim-primary-unit ${e.lengthUnits === 'M' ? 'js-dim-primary-unit-m' : ''}`}>{e.lengthUnits}</span></div>
                          <div className={`js-dim-secondary${e.lengthToleranceHighlight ? ' js-dim-secondary-hl' : ''}`}>
                            {e.lengthToleranceDisplay}
                          </div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary"><span>{e.gaugeLine || '-'}</span><span className="js-dim-primary-unit">µm</span></div>
                          <div className={`js-dim-secondary${e.gaugeTrimExplicit ? ' js-dim-secondary-hl' : ''}`}>
                            {e.gaugeTrimDisplay || '-'}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table className="js-print-flag-grid" role="presentation" aria-label="Extrusion run flags">
                  <tbody>
                    <tr>
                      <td>
                        Run up: <b>{valueOrDash(e.runUpLine)}</b>
                      </td>
                      <td>
                        Slit: <b>{e.slit || 'None'}</b>
                      </td>
                      <td
                        className={
                          e.treatHighlight === 'outside'
                            ? 'js-print-flag--treat-outside'
                            : e.treatHighlight === 'inside'
                              ? 'js-print-flag--treat-inside'
                              : undefined
                        }
                      >
                        Treat: <b>{e.treat || 'None'}</b>
                      </td>
                      <td className={e.shrink ? 'js-print-flag-val--yes' : undefined}>
                        Shrink:{' '}
                        <b >{e.shrink ? 'Yes' : '-'}</b>
                      </td>
                    </tr>
                    <tr>
                      <td className={e.inlineSeal ? 'js-print-flag-val--yes js-perf-bg' : undefined}>
                        Inline Seal:{' '}
                        <b >{e.inlineSeal ? 'Yes' : '-'}</b>
                      </td>
                      <td className={e.inlinePerforated ? 'js-print-flag-val--yes js-perf-bg' : undefined}>
                        Inline perf:{' '}
                        <b >
                          {e.inlinePerforated ? 'Yes' : '-'}
                        </b>
                      </td>
                      <td className={e.inlinePunched ? 'js-print-flag-val--yes' : undefined}>
                        Inline punch:{' '}
                        <b>
                          {e.inlinePunched ? 'Yes' : '-'}
                        </b>
                      </td>
                      <td className={e.coresLine ? 'js-print-flag-val--yes' : undefined}>
                        Cores:{' '}
                        
                        <b >
                          {valueOrDash(e.coresLine)}
                        </b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            {e.resinMixRows.map((r, idx) => {
              const specCell = `js-resin-spec-cell${idx === 0 ? ' js-resin-spec-first' : ''}${idx === e.resinMixRows.length - 1 ? ' js-resin-spec-last' : ''}`
              if (r.kind === 'blend') {
                return (
                  <tr key={idx}>
                    <td
                      colSpan={6}
                      className={`js-resin-mix-blend-wrap js-resin-mix-blend--${r.variant} ${specCell}`}
                    >
                      <div className="js-resin-mix-blend-caption">{r.caption}</div>
                      <table className="js-resin-mix-blend-bar" role="presentation">
                        <tbody>
                          {r.segments.map((seg, j) => (
                            <tr key={j}>
                              <td className="js-resin-mix-blend-resin">{seg.label}</td>
                              <td className="js-resin-mix-blend-pct">{seg.pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )
              }
              if (r.kind === 'label_pct') {
                return (
                  <tr key={idx}>
                    <td
                      colSpan={6}
                      className={`js-resin-mix-blend-wrap ${r.highlight ? 'js-resin-mix-hl ' : ''}${specCell}`}
                      style={
                        r.bgHex
                          ? {
                              backgroundColor: r.bgHex,
                              color: r.textColor || undefined,
                            }
                          : undefined
                      }
                    >
                      <table className="js-resin-mix-blend-bar" role="presentation">
                        <tbody>
                          <tr>
                            <td className="js-resin-mix-blend-resin">{r.label}</td>
                            <td className="js-resin-mix-blend-pct">{r.pct}%</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={idx}>
                  <td
                    colSpan={6}
                    className={`${r.highlight ? 'js-resin-mix-hl ' : ''}${specCell}`}
                    style={
                      r.bgHex
                        ? {
                            backgroundColor: r.bgHex,
                            color: r.textColor || undefined,
                          }
                        : undefined
                    }
                  >
                    {r.text}
                  </td>
                </tr>
              )
            })}
            <tr>
              <th>Extruder</th>
              <td colSpan={5}>
                {extrusionSetup.extruderLabel || extrusionSetup.dieSizeMm != null ? (
                  <>
                    {extrusionSetup.extruderLabel ? (
                      <>
                        <b>{formatExtruderCodeForPrint(extrusionSetup.extruderLabel)}</b>
                        {' - '}
                      </>
                    ) : null}
                    Die Size: {extrusionSetup.dieSizeMm != null ? `${String(extrusionSetup.dieSizeMm)}mm` : '-'}
                  </>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {isInlinePrinted ? (
          <table className="js-order-inline-shell" role="presentation">
            <tbody>
              <tr>
                <td className="js-order-inline-left">
                  <table className="js-grid js-order-qty-grid">
                    <tbody>{orderQuantitiesRows}</tbody>
                  </table>
                </td>
                <td className="js-order-inline-right">
                  <JobSheetPrintInlinePrintingBlock p={p} />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="js-grid js-order-qty-grid">
            <tbody>{orderQuantitiesRows}</tbody>
          </table>
        )}

        <div className="js-print-page-break">
          <JobSheetPrintExtrusionQcPage
            perforated={model.perforated}
            header={model.header}
            product={model.product}
            q={q}
          />
        </div>

        {isUtecoPrinted ? (
          <div className="js-print-page-break">
             <JobSheetPrintOrderHeader
              titleLine="PRINTING DETAILS"
              perforated={model.perforated}
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
              meta={{
                orderNumber: model.header.jobCode,
                formDate: model.header.orderDate,
                customer: model.header.customer,
                productDescription: model.product.productDescription,
                width: e.widthPrimarySingle ?? '',
                length: e.lengthLine,
                gauge: e.gaugeLine,
              }}
            />
          </div>
        ) : null}

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={2}>Shipping details</td></tr>
            <tr>
              <th style={{ width: '32%' }}>Pallet type</th>
              <td>{ship.palletType}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

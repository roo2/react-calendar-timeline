import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchProductSpecBundle, fetchProductSpecInks, fetchProductSpecPlates } from '../store/slices/productSpecSlice'
import { DefaultSelectField } from './DefaultSelectField'
import { defaultRowSx, isDefaultRow } from './DefaultRowTable'
import {
  ensureMinRows,
  MaterialsColoursAndAdditives,
  type ColourRow as MaterialsColourRow,
  type AdditiveRow as MaterialsAdditiveRow,
} from './MaterialsColoursAndAdditives'
import { ResinSelect, type ResinOption } from './ResinSelect'
import type { ColourOption } from './ColourSelect'
import type { AdditiveOption } from './AdditiveSelect'
import { InkSelect, type InkOption } from './InkSelect'
import { PlateSelect, type PlateOption } from './PlateSelect'
import { PrintingArtworkUploadSection, type PrintingArtworkFileRow, type PrintingArtworkScope } from './PrintingArtworkUploadSection'
import { computeProductCodeFromSpec } from '../utils/productDescription'

type DerivedDimensions = {
  layflat_mm: number
}

export type SpecPayload = any

const PRODUCT_TYPE = {
  Bag: 'Bag',
  Tube: 'Tube',
  Sleeve: 'Sleeve',
  Sheet: 'Sheet',
  Centerfold: 'Centerfold',
  UFilm: 'U-Film',
} as const

type ProductType = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE]

const PRODUCT_TYPES: ProductType[] = [
  PRODUCT_TYPE.Bag,
  PRODUCT_TYPE.Tube,
  PRODUCT_TYPE.Sleeve,
  PRODUCT_TYPE.Sheet,
  PRODUCT_TYPE.Centerfold,
  PRODUCT_TYPE.UFilm,
]

function clone<T>(v: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any).structuredClone as undefined | ((x: any) => any)
  if (typeof sc === 'function') return sc(v)
  return JSON.parse(JSON.stringify(v)) as T
}

/** Read-only header context for the job sheet printing dialog (supplied by `JobSheetEditor`). */
export type JobSheetPrintingContext = {
  customerLabel: string
  productDescription: string
  orderNumber: string
  orderDateLabel: string
  dueDateLabel: string
  totalMetersLabel: string
}

function intOrDash(n: unknown): string {
  if (n == null || n === '') return '—'
  const x = typeof n === 'number' ? n : Number(String(n).trim())
  return Number.isFinite(x) && x > 0 ? String(Math.round(x)) : '—'
}

/** Film supplied line from dimensions (e.g. "400mm 75µm L/F"). */
function formatJobSheetFilmSupplied(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const um = dims.thickness_um
  if (w == null || um == null) return '—'
  const geom = String(dims.geometry || '')
  const gusset = Number(dims.gusset_mm || 0) > 0
  const geoTag =
    geom === 'Gusset' || geom === 'BottomGusset' || gusset ? 'G' : geom === 'CentreFold' ? 'C/F' : 'L/F'
  return `${intOrDash(w)}mm ${intOrDash(um)}µm ${geoTag}`
}

/** Finished bag size from dimensions (width × length × gauge when present). */
function formatJobSheetFinishedBagSize(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const l = dims.base_length_mm
  const um = dims.thickness_um
  if (w == null) return '—'
  const parts = [`${intOrDash(w)}mm`]
  if (l != null) parts.push(`${intOrDash(l)}mm`)
  if (um != null) parts.push(`${intOrDash(um)}µm`)
  return parts.join(' × ')
}

function clampPlateLayoutInt(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(3, Math.max(1, n))
}

export function makeDefaultSpec(): SpecPayload {
  return {
    identity: {
      product_type: PRODUCT_TYPE.Bag,
      finish_mode: 'Rolls',
      trim_pct: null,
      roll_weight_billing: 'core_off',
      industry_flags: [],
      notes: null,
      customer_code: null,
    },
    dimensions: {
      base_width_mm: null,
      width_tolerance_mm: null,
      base_length_mm: null,
      thickness_um: null,
      geometry: 'Flat',
      gusset_mm: null,
      ufilm_left_width_mm: null,
      ufilm_right_width_mm: null,
      length_units: 'mm',
    },
    formulation: {
      blend_type: 'LD',
      blend: [{ resin_code: 'LDPE', pct: 100 }],
      colour: null,
      colour_components: [],
      additives: [],
    },
    printing: {
      method: 'None',
      num_colours: null,
      print_description: null,
      ink_codes: [],
      plate_codes: [],
      side: 'front',
      artwork_refs: [],
      artwork_files: [],
      front_ink_plate: [],
      back_ink_plate: [],
      cylinder_size_mm: null,
      barcode: null,
      print_position_notes: null,
      plates_around: null,
      plates_across: null,
      seal_type: null,
      eye_spot: null,
    },
    quality_expectations: {
      flags: [],
      known_issues: null,
    },
    run_requirements: {
      preferred_extruders: [],
      preferred_printer: null,
      preferred_converter: null,
      run_up: 'none',
      slit: 'none',
      treat_inside_outside: 'none',
      inline_perforation: false,
      hole_punched: false,
      inline_seal: false,
      notes: null,
    },
    packaging: {
      pack_mode: 'Rolls',
      core_type: '13mm',
      core_policy: 'Include',
      bags_per_carton: null,
      pallet_type: 'Chep',
      notes: null,
    },
    tool_requirements: [],
  }
}

export type SpecPayloadFormPrintingSurface = 'full' | 'job_sheet_summary'

export function SpecPayloadForm(props: {
  value: SpecPayload
  onChange: (next: SpecPayload) => void
  fieldErrors?: Record<string, string>
  customerId?: string
  /** Job sheet flows: show only printing method + colours on the page; ink/plates open in a dialog (works nested under another modal). */
  printingSurface?: SpecPayloadFormPrintingSurface
  /** Inserted after Dimensions & Geometry and before Materials (e.g. job sheet quantity block). */
  afterDimensionsSlot?: ReactNode
  /** Read-only job sheet header fields shown inside the printing details dialog. */
  jobSheetPrintingContext?: JobSheetPrintingContext
  /** When set, enables PDF artwork upload against a saved job sheet or product version. */
  printingArtworkScope?: PrintingArtworkScope | null
}) {
  const dispatch = useAppDispatch()
  const bundle = useAppSelector((s) => s.productSpec.bundle)
  const inksState = useAppSelector((s) => s.productSpec.inks)
  const platesState = useAppSelector((s) => s.productSpec.plates)

  const {
    value,
    onChange,
    fieldErrors,
    customerId,
    printingSurface = 'full',
    afterDimensionsSlot,
    jobSheetPrintingContext,
    printingArtworkScope = null,
  } = props
  const [printingDetailsOpen, setPrintingDetailsOpen] = useState(false)

  const spec = useMemo(() => value || makeDefaultSpec(), [value])

  function normalizeSpec(d: SpecPayload) {
    const flags = Array.isArray(d?.identity?.industry_flags) ? d.identity.industry_flags : []
    // "non_food" is redundant (inverse of food_contact) and should not be persisted.
    d.identity.industry_flags = Array.from(new Set(flags)).filter((x) => x !== 'non_food')
  }

  function update(mut: (draft: SpecPayload) => void) {
    const next = clone(spec)
    mut(next)
    normalizeSpec(next)
    onChange(next)
  }

  const identity = spec.identity || {}
  const dimensions = spec.dimensions || {}
  const formulation = spec.formulation || {}
  const printing = spec.printing || {}
  const printingArtworkFiles = Array.isArray(printing.artwork_files) ? printing.artwork_files : []
  const quality = spec.quality_expectations || {}
  const run = spec.run_requirements || {}
  const packaging = spec.packaging || {}

  const filmSuppliedReadonly = useMemo(() => formatJobSheetFilmSupplied(spec), [spec])
  const finishedBagSizeReadonly = useMemo(() => formatJobSheetFinishedBagSize(spec), [spec])
  const generatedProductCodePlaceholder = useMemo(() => {
    try {
      const c = computeProductCodeFromSpec(spec).trim()
      return c || '—'
    } catch {
      return '—'
    }
  }, [spec])

  const industryFlags = new Set<string>(Array.isArray(identity.industry_flags) ? identity.industry_flags : [])
  const qualityFlags = new Set<string>(Array.isArray(quality.flags) ? quality.flags : [])

  const blend = Array.isArray(formulation.blend) ? formulation.blend : []
  const additives = Array.isArray(formulation.additives) ? formulation.additives : []
  const legacyColourRow =
    formulation.colour?.colour_code || formulation.colour?.strength_pct != null
      ? [{ colour_code: formulation.colour?.colour_code || '', strength_pct: formulation.colour?.strength_pct ?? null }]
      : []
  const colourComponents =
    Array.isArray(formulation.colour_components) && formulation.colour_components.length > 0 ? formulation.colour_components : legacyColourRow

  const printingEnabled = printing.method && printing.method !== 'None'
  const finishMode = identity.finish_mode || 'Rolls'
  const inkPrinterType = printing.method === 'Inline' ? 'inline' : printing.method === 'Uteco' ? 'uteco' : null

  const productType: ProductType = (identity.product_type as ProductType) || PRODUCT_TYPE.Bag
  const canHaveGusset = productType === PRODUCT_TYPE.Bag || productType === PRODUCT_TYPE.Tube
  const isUFilm = productType === PRODUCT_TYPE.UFilm
  const gussetEnabled =
    !isUFilm &&
    canHaveGusset &&
    (((dimensions.geometry as string) || 'Flat') === 'Gusset' || Number(dimensions.gusset_mm || 0) > 0)

  const resinBlends = bundle.resinBlends
  const resins = bundle.resins as ResinOption[]
  const colours = bundle.colours as ColourOption[]
  const additiveOptions = bundle.additives as AdditiveOption[]
  const inks = inksState.items as InkOption[]
  const plates = platesState.items as PlateOption[]

  const bundleErr = bundle.status === 'failed' ? bundle.error : null
  const resinsErr = bundleErr
  const resinBlendsErr = bundleErr
  const coloursErr = bundleErr
  const additivesErr = bundleErr
  const inksErr = inksState.status === 'failed' ? inksState.error : null
  const platesErr = platesState.status === 'failed' ? platesState.error : null

  const [layflatInput, setLayflatInput] = useState<string | null>(null)

  useEffect(() => {
    if (bundle.status === 'idle') void dispatch(fetchProductSpecBundle())
  }, [bundle.status, dispatch])

  useEffect(() => {
    void dispatch(fetchProductSpecInks(inkPrinterType))
  }, [dispatch, inkPrinterType])

  useEffect(() => {
    void dispatch(fetchProductSpecPlates(customerId || ''))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!Array.isArray(resinBlends) || resinBlends.length === 0) return
    const preset = resinBlends.find((b) => b.blend_code === 'LD')
    if (!preset) return
    const curType = formulation.blend_type || 'Custom'
    if (curType !== 'LD') return
    const curBlend = Array.isArray(formulation.blend) ? formulation.blend : []
    const looksPlaceholder =
      curBlend.length === 0 ||
      (curBlend.length === 1 && curBlend[0]?.resin_code === 'LDPE' && Math.abs(Number(curBlend[0]?.pct || 0) - 100) < 0.0001)
    if (!looksPlaceholder) return

    update((d) => {
      d.formulation.blend_type = 'LD'
      d.formulation.blend = preset.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resinBlends])

  function emptyInkPlateRow(_method: string | undefined): { ink_code: string; plate_code: string; ink_text: string } {
    return { ink_code: '', plate_code: '', ink_text: '' }
  }

  function ensureFixedInkPlateRows(d: SpecPayload) {
    const p = d.printing || {}
    const m = p.method
    if (m !== 'Inline' && m !== 'Uteco') return
    for (const key of ['front_ink_plate', 'back_ink_plate'] as const) {
      const cur = Array.isArray(p[key]) ? p[key].slice(0, 4) : []
      while (cur.length < 5) cur.push(emptyInkPlateRow(m))
      p[key] = cur.map((row: any) => ({
        ink_code: row?.ink_code ?? '',
        plate_code: m === 'Uteco' ? '' : row?.plate_code ?? '',
        ink_text: row?.ink_text ?? '',
      }))
    }
    const pr = d.printing as Record<string, unknown>
    if (pr && 'anilox_code' in pr) delete pr.anilox_code
  }

  function syncLegacyInkPlateFromPairs(d: SpecPayload) {
    const p = d.printing || {}
    if (p.method !== 'Inline' && p.method !== 'Uteco') return
    const front = Array.isArray(p.front_ink_plate) ? p.front_ink_plate : []
    const back = Array.isArray(p.back_ink_plate) ? p.back_ink_plate : []
    const all = [...front, ...back]
    p.ink_codes = all.map((r: any) => (r?.ink_code || '').trim()).filter(Boolean)
    p.plate_codes = all.map((r: any) => (r?.plate_code || '').trim()).filter(Boolean)
  }

  function applyPrintingMethodChange(next: string) {
    update((d) => {
      d.printing.method = next
      if ((next === 'Inline' || next === 'Uteco') && !d.printing.side) d.printing.side = 'front'
      if (next === 'None') {
        d.printing.cylinder_size_mm = null
      }
      delete (d.printing as Record<string, unknown>).anilox_code
      for (const key of ['front_ink_plate', 'back_ink_plate'] as const) {
        const arr = Array.isArray(d.printing[key]) ? d.printing[key] : []
        d.printing[key] = arr.map((row: any) => ({
          ink_code: row?.ink_code ?? '',
          plate_code: next === 'Uteco' ? '' : row?.plate_code ?? '',
          ink_text: row?.ink_text ?? '',
        }))
      }
    })
  }

  useEffect(() => {
    if (!printingEnabled) return
    const fl = Array.isArray(printing.front_ink_plate) ? printing.front_ink_plate.length : 0
    const bl = Array.isArray(printing.back_ink_plate) ? printing.back_ink_plate.length : 0
    if (fl >= 5 && bl >= 5) return
    update((d) => {
      ensureFixedInkPlateRows(d)
      syncLegacyInkPlateFromPairs(d)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing.method])

  function syncLegacyColourFromComponents(d: SpecPayload) {
    const comps = Array.isArray(d?.formulation?.colour_components) ? d.formulation.colour_components : []
    const first = comps[0]
    const cc = (first?.colour_code || '').trim()
    const sp = first?.strength_pct
    if (!cc && (sp == null || sp === '')) {
      d.formulation.colour = null
      return
    }
    d.formulation.colour = d.formulation.colour || { opaque: false }
    d.formulation.colour.colour_code = cc || null
    d.formulation.colour.strength_pct = typeof sp === 'number' ? sp : sp ? parseFloat(String(sp)) : null
    // Keep existing opaque fields if they were set previously; otherwise default.
    if (d.formulation.colour.opaque == null) d.formulation.colour.opaque = false
  }

  const colourRowsForMaterials: MaterialsColourRow[] = useMemo(() => {
    const rows = colourComponents.map((c: { colour_code?: string; strength_pct?: number | null }) => ({
      colour_code: c.colour_code || '',
      strength_pct: c.strength_pct != null ? String(c.strength_pct) : '',
    }))
    while (rows.length < 2) rows.push({ colour_code: '', strength_pct: '' })
    return rows
  }, [colourComponents])

  const additiveRowsForMaterials: MaterialsAdditiveRow[] = useMemo(() => {
    const rows = additives.map((a: { additive_code?: string; pct?: number | null }) => ({
      additive_code: a.additive_code || '',
      pct: a.pct != null ? String(a.pct) : '',
    }))
    while (rows.length < 2) rows.push({ additive_code: '', pct: '' })
    return rows
  }, [additives])

  function parseOptionalPercent(raw: string): number | null {
    if (raw === '' || raw == null) return null
    const n = parseFloat(String(raw).trim())
    return Number.isFinite(n) ? n : null
  }

  function handleMaterialsColourRowsChange(rows: MaterialsColourRow[]) {
    update((d) => {
      if (!Array.isArray(d.formulation.colour_components)) d.formulation.colour_components = []
      d.formulation.colour_components = rows.map((r) => ({
        colour_code: r.colour_code,
        strength_pct: parseOptionalPercent(r.strength_pct),
      }))
      syncLegacyColourFromComponents(d)
    })
  }

  function handleMaterialsAdditiveRowsChange(rows: MaterialsAdditiveRow[]) {
    update((d) => {
      if (!Array.isArray(d.formulation.additives)) d.formulation.additives = []
      d.formulation.additives = rows.map((r) => ({
        additive_code: r.additive_code,
        pct: parseOptionalPercent(r.pct),
      }))
    })
  }

  const showRunUp = productType === PRODUCT_TYPE.Centerfold || productType === PRODUCT_TYPE.Sheet
  const runUpOptions: number[] =
    productType === PRODUCT_TYPE.Centerfold ? [1, 2] : productType === PRODUCT_TYPE.Sheet ? [2, 4, 6] : []
  const runUpSlug = (run.run_up as string) || 'none'
  const runUpNum =
    runUpSlug === '1up'
      ? 1
      : runUpSlug === '2up'
        ? 2
        : runUpSlug === '4up'
          ? 4
          : runUpSlug === '6up'
            ? 6
            : productType === PRODUCT_TYPE.Centerfold
              ? 1
              : productType === PRODUCT_TYPE.Sheet
                ? 2
                : 1

  const derived: DerivedDimensions = useMemo(() => {
    const width = typeof dimensions.base_width_mm === 'number' ? dimensions.base_width_mm : 0
    const gussetReturnOrSide = typeof dimensions.gusset_mm === 'number' ? dimensions.gusset_mm : 0
    const ru = runUpNum

    let layflat = width
    if (productType === PRODUCT_TYPE.UFilm) {
      const l = typeof dimensions.ufilm_left_width_mm === 'number' ? dimensions.ufilm_left_width_mm : 0
      const r = typeof dimensions.ufilm_right_width_mm === 'number' ? dimensions.ufilm_right_width_mm : 0
      layflat = width + l + r
    } else if ((productType === PRODUCT_TYPE.Centerfold || dimensions.geometry === 'CentreFold') && ru > 0) {
      layflat = width * (ru / 2)
    } else if (productType === PRODUCT_TYPE.Centerfold || dimensions.geometry === 'CentreFold') {
      layflat = 0.5 * width
    } else if (productType === PRODUCT_TYPE.Sheet && ru > 0) {
      layflat = width * (ru / 2)
    } else if (gussetEnabled && gussetReturnOrSide > 0) {
      layflat = width + gussetReturnOrSide
    }

    return {
      layflat_mm: layflat,
    }
  }, [dimensions.base_width_mm, dimensions.geometry, dimensions.gusset_mm, dimensions.ufilm_left_width_mm, dimensions.ufilm_right_width_mm, gussetEnabled, productType, runUpNum])

  const lengthUnits = (dimensions.length_units as 'mm' | 'M' | 'Continuous' | undefined) || 'mm'
  const lengthDisplay = useMemo(() => {
    if (lengthUnits === 'Continuous') return ''
    const mm = typeof dimensions.base_length_mm === 'number' ? dimensions.base_length_mm : null
    if (mm == null) return ''
    if (lengthUnits === 'M') return String(Math.round((mm / 1000) * 1000) / 1000)
    return String(mm)
  }, [dimensions.base_length_mm, lengthUnits])

  function onProductTypeChange(nextTypeRaw: string) {
    const nextType = nextTypeRaw as ProductType
    update((d) => {
      d.identity.product_type = nextType

      // Run-up only supported for Centerfold (2up) and Sheet (2up/4up/6up).
      const nextRunUp = d.run_requirements?.run_up || 'none'
      const allowed =
        nextType === PRODUCT_TYPE.Centerfold
          ? new Set(['none', '1up', '2up'])
          : nextType === PRODUCT_TYPE.Sheet
            ? new Set(['none', '2up', '4up', '6up'])
            : new Set(['none'])
      if (!allowed.has(String(nextRunUp))) d.run_requirements.run_up = 'none'

      // Centerfold implies CentreFold geometry and no gusset.
      if (nextType === PRODUCT_TYPE.Centerfold) {
        d.dimensions.geometry = 'CentreFold'
        d.dimensions.gusset_mm = null
        return
      }

      // If leaving Centerfold, fall back to Flat.
      if (d.dimensions.geometry === 'CentreFold') d.dimensions.geometry = 'Flat'

      // Gusset only allowed for Bag/Tube.
      const allowGusset = nextType === PRODUCT_TYPE.Bag || nextType === PRODUCT_TYPE.Tube
      if (!allowGusset) {
        d.dimensions.geometry = 'Flat'
        d.dimensions.gusset_mm = null
      }

      // Tubes are always rolls in our simplified UI (continuous length; no discrete length).
      if (nextType === PRODUCT_TYPE.Tube) {
        d.identity.finish_mode = 'Rolls'
        d.packaging.pack_mode = 'Rolls'
        d.dimensions.base_length_mm = null
        d.dimensions.length_units = 'Continuous'
      }

      // Continuous length is not available for Bag or Sleeve.
      if (nextType === PRODUCT_TYPE.Bag || nextType === PRODUCT_TYPE.Sleeve) {
        if (d.dimensions.length_units === 'Continuous') d.dimensions.length_units = 'mm'
      }
    })
  }

  function errorFor(key: string): string | undefined {
    return fieldErrors?.[key]
  }

  function firstErrorForPrefix(prefix: string): string | undefined {
    if (!fieldErrors) return undefined
    for (const [k, v] of Object.entries(fieldErrors)) {
      if (k === prefix || k.startsWith(prefix + '.') || k.startsWith(prefix + '[')) return v
    }
    return undefined
  }

  useEffect(() => {
    if (printingSurface !== 'job_sheet_summary') return
    if (!printingEnabled) setPrintingDetailsOpen(false)
  }, [printingSurface, printingEnabled])

  const printingNumColoursField = (
    <TextField
      label="Number of Colours"
      type="number"
      inputProps={{ min: 0, step: 1 }}
      value={printing.num_colours ?? ''}
      onChange={(e) =>
        update((d) => {
          const v = e.target.value
          if (v === '') {
            d.printing.num_colours = null
            return
          }
          const n = parseInt(v, 10)
          d.printing.num_colours = Number.isFinite(n) ? n : null
        })
      }
      error={!!errorFor('spec.printing.num_colours')}
      helperText={errorFor('spec.printing.num_colours') || ''}
    />
  )

  const printingPrintSideField = (
    <DefaultSelectField
      defaultValue="front"
      label="Print Side"
      value={printing.side || 'front'}
      onChange={(e) => update((d) => (d.printing.side = (e.target.value || 'front') as any))}
    >
      <MenuItem value="front">Front</MenuItem>
      <MenuItem value="back">Back</MenuItem>
      <MenuItem value="both">Both</MenuItem>
    </DefaultSelectField>
  )

  /** Same binding as Run Requirements — duplicated in the job-sheet printing dialog for convenience. */
  const printingTreatField = (
    <TextField
      select
      label="Treat Inside/Outside"
      value={run.treat_inside_outside || 'none'}
      onChange={(e) => update((d) => (d.run_requirements.treat_inside_outside = e.target.value))}
      error={!!errorFor('spec.run_requirements.treat_inside_outside')}
      helperText={errorFor('spec.run_requirements.treat_inside_outside') || ''}
    >
      <MenuItem value="none">none</MenuItem>
      <MenuItem value="inside">inside</MenuItem>
      <MenuItem value="outside">outside</MenuItem>
    </TextField>
  )

  const showPlateColumn = printing.method === 'Inline'

  const printingTablesInner = printingEnabled ? (
    <>
      {((printing.side || 'front') === 'front' || printing.side === 'both') && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Typography variant="subtitle1">Front print</Typography>
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  const empty = emptyInkPlateRow(d.printing.method)
                  d.printing.front_ink_plate = Array.from({ length: 5 }, () => ({ ...empty }))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Clear
            </Button>
          </Box>
          {(inksErr || platesErr) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {inksErr || platesErr}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ink</TableCell>
                {showPlateColumn ? <TableCell>Plate</TableCell> : null}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {ensureMinRows(
                Array.isArray(printing.front_ink_plate) ? printing.front_ink_plate : [],
                { ink_code: '', plate_code: '', ink_text: '' },
                5,
              ).map((row: { ink_code?: string; plate_code?: string; ink_text?: string }, idx: number) => {
                const r = { ink_code: row?.ink_code || '', plate_code: row?.plate_code || '', ink_text: row?.ink_text || '' }
                const defaults = { ink_code: '', plate_code: '', ink_text: '' }
                const isDefault = isDefaultRow(r as Record<string, unknown>, defaults as Record<string, unknown>)
                return (
                  <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                    <TableCell sx={{ width: showPlateColumn ? '55%' : '85%' }}>
                      <InkSelect
                        options={inks}
                        valueCode={r.ink_code}
                        label={`Ink ${idx + 1}`}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), ink_code: nextCode }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    {showPlateColumn ? (
                      <TableCell sx={{ width: '35%' }}>
                        <PlateSelect
                          options={plates}
                          valueCode={r.plate_code}
                          label={`Plate ${idx + 1}`}
                          onChangeCode={(nextCode) =>
                            update((d) => {
                              ensureFixedInkPlateRows(d)
                              d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), plate_code: nextCode }
                              syncLegacyInkPlateFromPairs(d)
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell sx={{ width: '10%' }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            const cur = d.printing.front_ink_plate
                            if (cur.length > 5) {
                              cur.splice(idx, 1)
                            } else {
                              cur[idx] = emptyInkPlateRow(d.printing.method)
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  d.printing.front_ink_plate.push(emptyInkPlateRow(d.printing.method))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Add row
            </Button>
          </Box>
        </Box>
      )}

      {(printing.side === 'back' || printing.side === 'both') && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Typography variant="subtitle1">Back print</Typography>
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  const empty = emptyInkPlateRow(d.printing.method)
                  d.printing.back_ink_plate = Array.from({ length: 5 }, () => ({ ...empty }))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Clear
            </Button>
          </Box>
          {(inksErr || platesErr) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {inksErr || platesErr}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ink</TableCell>
                {showPlateColumn ? <TableCell>Plate</TableCell> : null}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {ensureMinRows(
                Array.isArray(printing.back_ink_plate) ? printing.back_ink_plate : [],
                { ink_code: '', plate_code: '', ink_text: '' },
                5,
              ).map((row: { ink_code?: string; plate_code?: string; ink_text?: string }, idx: number) => {
                const r = { ink_code: row?.ink_code || '', plate_code: row?.plate_code || '', ink_text: row?.ink_text || '' }
                const defaults = { ink_code: '', plate_code: '', ink_text: '' }
                const isDefault = isDefaultRow(r as Record<string, unknown>, defaults as Record<string, unknown>)
                return (
                  <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                    <TableCell sx={{ width: showPlateColumn ? '55%' : '85%' }}>
                      <InkSelect
                        options={inks}
                        valueCode={r.ink_code}
                        label={`Ink ${idx + 1}`}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), ink_code: nextCode }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    {showPlateColumn ? (
                      <TableCell sx={{ width: '35%' }}>
                        <PlateSelect
                          options={plates}
                          valueCode={r.plate_code}
                          label={`Plate ${idx + 1}`}
                          onChangeCode={(nextCode) =>
                            update((d) => {
                              ensureFixedInkPlateRows(d)
                              d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), plate_code: nextCode }
                              syncLegacyInkPlateFromPairs(d)
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell sx={{ width: '10%' }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            const cur = d.printing.back_ink_plate
                            if (cur.length > 5) {
                              cur.splice(idx, 1)
                            } else {
                              cur[idx] = emptyInkPlateRow(d.printing.method)
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  d.printing.back_ink_plate.push(emptyInkPlateRow(d.printing.method))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Add row
            </Button>
          </Box>
        </Box>
      )}

      {printing.method === 'Uteco' && (
        <Box sx={{ mt: 2, maxWidth: { xs: '100%', md: 400 } }}>
          <TextField
            label="Cylinder size (mm)"
            type="number"
            value={printing.cylinder_size_mm ?? ''}
            onChange={(e) => {
              const v = e.target.value
              update((d) => {
                d.printing.cylinder_size_mm = v === '' ? null : Number(v)
              })
            }}
            fullWidth
            inputProps={{ min: 0, step: 'any' }}
            helperText="Cylinder width in millimetres"
          />
        </Box>
      )}
    </>
  ) : null

  /** Job sheet printing dialog: free-text colour + optional catalog ink; plate column only for Inline. */
  const jobSheetPrintingInkTables = printingEnabled ? (
    <>
      {((printing.side || 'front') === 'front' || printing.side === 'both') && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Typography variant="subtitle1">Ink colours</Typography>
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  const empty = emptyInkPlateRow(d.printing.method)
                  d.printing.front_ink_plate = Array.from({ length: 5 }, () => ({ ...empty }))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Clear
            </Button>
          </Box>
          {(inksErr || platesErr) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {inksErr || platesErr}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Colour (free text)</TableCell>
                <TableCell>Ink code</TableCell>
                {showPlateColumn ? <TableCell>Plate</TableCell> : null}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {ensureMinRows(
                Array.isArray(printing.front_ink_plate) ? printing.front_ink_plate : [],
                { ink_code: '', plate_code: '', ink_text: '' },
                5,
              ).map((row: { ink_code?: string; plate_code?: string; ink_text?: string }, idx: number) => {
                const r = { ink_code: row?.ink_code || '', plate_code: row?.plate_code || '', ink_text: row?.ink_text || '' }
                const defaults = { ink_code: '', plate_code: '', ink_text: '' }
                const isDefault = isDefaultRow(r as Record<string, unknown>, defaults as Record<string, unknown>)
                return (
                  <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                    <TableCell sx={{ minWidth: 160 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label={`Colour ${idx + 1}`}
                        value={r.ink_text}
                        onChange={(e) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.front_ink_plate[idx] = {
                              ...(d.printing.front_ink_plate[idx] || {}),
                              ink_text: e.target.value,
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <InkSelect
                        options={inks}
                        valueCode={r.ink_code}
                        label={`Ink ${idx + 1}`}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), ink_code: nextCode }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    {showPlateColumn ? (
                      <TableCell sx={{ minWidth: 160 }}>
                        <PlateSelect
                          options={plates}
                          valueCode={r.plate_code}
                          label={`Plate ${idx + 1}`}
                          onChangeCode={(nextCode) =>
                            update((d) => {
                              ensureFixedInkPlateRows(d)
                              d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), plate_code: nextCode }
                              syncLegacyInkPlateFromPairs(d)
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell sx={{ width: 96 }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            const cur = d.printing.front_ink_plate
                            if (cur.length > 5) {
                              cur.splice(idx, 1)
                            } else {
                              cur[idx] = emptyInkPlateRow(d.printing.method)
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  d.printing.front_ink_plate.push(emptyInkPlateRow(d.printing.method))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Add row
            </Button>
          </Box>
        </Box>
      )}

      {(printing.side === 'back' || printing.side === 'both') && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Typography variant="subtitle1">Back print</Typography>
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  const empty = emptyInkPlateRow(d.printing.method)
                  d.printing.back_ink_plate = Array.from({ length: 5 }, () => ({ ...empty }))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Clear
            </Button>
          </Box>
          {(inksErr || platesErr) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {inksErr || platesErr}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Colour (free text)</TableCell>
                <TableCell>Ink code</TableCell>
                {showPlateColumn ? <TableCell>Plate</TableCell> : null}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {ensureMinRows(
                Array.isArray(printing.back_ink_plate) ? printing.back_ink_plate : [],
                { ink_code: '', plate_code: '', ink_text: '' },
                5,
              ).map((row: { ink_code?: string; plate_code?: string; ink_text?: string }, idx: number) => {
                const r = { ink_code: row?.ink_code || '', plate_code: row?.plate_code || '', ink_text: row?.ink_text || '' }
                const defaults = { ink_code: '', plate_code: '', ink_text: '' }
                const isDefault = isDefaultRow(r as Record<string, unknown>, defaults as Record<string, unknown>)
                return (
                  <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                    <TableCell sx={{ minWidth: 160 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label={`Colour ${idx + 1}`}
                        value={r.ink_text}
                        onChange={(e) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.back_ink_plate[idx] = {
                              ...(d.printing.back_ink_plate[idx] || {}),
                              ink_text: e.target.value,
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <InkSelect
                        options={inks}
                        valueCode={r.ink_code}
                        label={`Ink ${idx + 1}`}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), ink_code: nextCode }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      />
                    </TableCell>
                    {showPlateColumn ? (
                      <TableCell sx={{ minWidth: 160 }}>
                        <PlateSelect
                          options={plates}
                          valueCode={r.plate_code}
                          label={`Plate ${idx + 1}`}
                          onChangeCode={(nextCode) =>
                            update((d) => {
                              ensureFixedInkPlateRows(d)
                              d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), plate_code: nextCode }
                              syncLegacyInkPlateFromPairs(d)
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell sx={{ width: 96 }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          update((d) => {
                            ensureFixedInkPlateRows(d)
                            const cur = d.printing.back_ink_plate
                            if (cur.length > 5) {
                              cur.splice(idx, 1)
                            } else {
                              cur[idx] = emptyInkPlateRow(d.printing.method)
                            }
                            syncLegacyInkPlateFromPairs(d)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                update((d) => {
                  ensureFixedInkPlateRows(d)
                  d.printing.back_ink_plate.push(emptyInkPlateRow(d.printing.method))
                  syncLegacyInkPlateFromPairs(d)
                })
              }
            >
              Add row
            </Button>
          </Box>
        </Box>
      )}
    </>
  ) : null

  const printingDescriptionField = printingEnabled ? (
    <TextField
      label="Print Description"
      value={printing.print_description || ''}
      onChange={(e) => update((d) => (d.printing.print_description = e.target.value || null))}
      multiline
      minRows={2}
      fullWidth
      sx={printingSurface === 'job_sheet_summary' ? undefined : { mt: 2 }}
    />
  ) : null

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Product Type
        </Typography>

        <Box sx={{ mb: 2, maxWidth: { xs: '100%', sm: '50%' } }}>
          <TextField
            label="Customer-facing product code"
            placeholder={generatedProductCodePlaceholder}
            value={identity.customer_code ?? ''}
            onChange={(e) =>
              update((d) => {
                const raw = e.target.value
                d.identity.customer_code = raw.trim() === '' ? null : raw
              })
            }
            fullWidth
            inputProps={{ maxLength: 64 }}
            error={!!errorFor('spec.identity.customer_code')}
            helperText={
              errorFor('spec.identity.customer_code') ||
              (!(identity.customer_code ?? '').trim()
                ? 'Optional. Uses the generated code when empty.'
                : 'Shown to customers instead of the generated code.')
            }
          />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <DefaultSelectField
            label="Product Type"
            defaultValue={PRODUCT_TYPE.Bag}
            value={identity.product_type || PRODUCT_TYPE.Bag}
            onChange={(e) => onProductTypeChange(e.target.value)}
          >
            {PRODUCT_TYPES.map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </DefaultSelectField>

          <DefaultSelectField
            label="Finish Mode"
            defaultValue="Rolls"
            value={identity.finish_mode || 'Rolls'}
            onChange={(e) => {
              const v = e.target.value
              update((d) => {
                d.identity.finish_mode = v
                d.packaging.pack_mode = v
              })
            }}
          >
            <MenuItem value="Rolls">Rolls</MenuItem>
            <MenuItem value="Cartons">Cartons</MenuItem>
          </DefaultSelectField>
        </Box>

      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Dimensions &amp; Geometry
        </Typography>

        <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={gussetEnabled}
                disabled={!canHaveGusset || isUFilm}
                onChange={(e) =>
                  update((d) => {
                    if (!canHaveGusset || isUFilm) return
                    if (e.target.checked) {
                      d.dimensions.geometry = 'Gusset'
                      d.dimensions.gusset_mm =
                        d.dimensions.gusset_mm && d.dimensions.gusset_mm > 0 ? d.dimensions.gusset_mm : 50
                    } else {
                      d.dimensions.geometry = 'Flat'
                      d.dimensions.gusset_mm = null
                    }
                  })
                }
              />
            }
            label="Gusset"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={!!printingEnabled}
                onChange={(e) =>
                  update((d) => {
                    if (e.target.checked) {
                      if (!d.printing.method || d.printing.method === 'None') d.printing.method = 'Inline'
                      if (!d.printing.side) d.printing.side = 'front'
                    } else {
                      d.printing.method = 'None'
                      d.printing.side = null
                      d.printing.print_description = null
                      d.printing.num_colours = null
                      d.printing.ink_codes = []
                      d.printing.plate_codes = []
                      d.printing.artwork_refs = []
                      d.printing.artwork_files = []
                      d.printing.front_ink_plate = []
                      d.printing.back_ink_plate = []
                      d.printing.cylinder_size_mm = null
                      delete (d.printing as Record<string, unknown>).anilox_code
                    }
                  })
                }
              />
            }
            label="Printed"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={!!run.inline_perforation}
                onChange={(e) => update((d) => (d.run_requirements.inline_perforation = e.target.checked))}
              />
            }
            label="Perforated"
          />
          <FormControlLabel
            control={
              <Checkbox checked={!!run.inline_seal} onChange={(e) => update((d) => (d.run_requirements.inline_seal = e.target.checked))} />
            }
            label="Sealed"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={!!run.hole_punched}
                onChange={(e) => update((d) => (d.run_requirements.hole_punched = e.target.checked))}
              />
            }
            label="Punched"
          />
        </FormGroup>

        <Stack spacing={2}>
          {isUFilm ? (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2 }}>
                <TextField
                  label="Left Width (mm)"
                  type="number"
                  inputProps={{ min: 1, step: 1 }}
                  value={dimensions.ufilm_left_width_mm ?? ''}
                  onChange={(e) =>
                    update((d) => (d.dimensions.ufilm_left_width_mm = e.target.value ? parseInt(e.target.value) : null))
                  }
                  error={!!errorFor('spec.dimensions.ufilm_left_width_mm')}
                  helperText={errorFor('spec.dimensions.ufilm_left_width_mm') || ''}
                />
                <TextField
                  label="Middle Width (mm)"
                  type="number"
                  inputProps={{ min: 1, step: 1 }}
                  value={dimensions.base_width_mm == null || dimensions.base_width_mm === 0 ? '' : dimensions.base_width_mm}
                  onChange={(e) => update((d) => (d.dimensions.base_width_mm = e.target.value === '' ? null : parseInt(e.target.value, 10)))}
                  required
                  error={!!errorFor('spec.dimensions.base_width_mm')}
                  helperText={errorFor('spec.dimensions.base_width_mm') || ''}
                />
                <TextField
                  label="Right Width (mm)"
                  type="number"
                  inputProps={{ min: 1, step: 1 }}
                  value={dimensions.ufilm_right_width_mm ?? ''}
                  onChange={(e) =>
                    update((d) => (d.dimensions.ufilm_right_width_mm = e.target.value ? parseInt(e.target.value) : null))
                  }
                  error={!!errorFor('spec.dimensions.ufilm_right_width_mm')}
                  helperText={errorFor('spec.dimensions.ufilm_right_width_mm') || ''}
                />
              </Box>
            </>
          ) : (
            <Stack spacing={2}>
              {showRunUp ? (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2 }}>
                    <TextField
                      label="Layflat Width (mm)"
                      type="number"
                      value={
                        layflatInput != null
                          ? layflatInput
                          : derived.layflat_mm > 0
                            ? String(Math.round(derived.layflat_mm))
                            : ''
                      }
                      onFocus={() =>
                        setLayflatInput(derived.layflat_mm > 0 ? String(Math.round(derived.layflat_mm)) : '')
                      }
                      onChange={(e) => {
                        const raw = e.target.value
                        setLayflatInput(raw)
                        if (raw === '') {
                          update((d) => (d.dimensions.base_width_mm = null))
                        } else {
                          const v = Number(raw)
                          if (Number.isFinite(v) && runUpNum > 0) {
                            update((d) => (d.dimensions.base_width_mm = Math.round((v * 2) / runUpNum)))
                          }
                        }
                      }}
                      onBlur={() => setLayflatInput(null)}
                    />
                    <DefaultSelectField
                      label="Run Up"
                      defaultValue={productType === PRODUCT_TYPE.Centerfold ? '1up' : '2up'}
                      value={
                        runUpSlug === 'none'
                          ? productType === PRODUCT_TYPE.Centerfold
                            ? '1up'
                            : '2up'
                          : runUpSlug
                      }
                      onChange={(e) =>
                        update((d) => (d.run_requirements.run_up = String(e.target.value || 'none')))
                      }
                    >
                      {runUpOptions.map((n) => (
                        <MenuItem key={n} value={n === 1 ? '1up' : `${n}up`}>
                          {n} up
                        </MenuItem>
                      ))}
                    </DefaultSelectField>
                    <TextField
                      label={`${productType} Width (mm)`}
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={dimensions.base_width_mm == null || dimensions.base_width_mm === 0 ? '' : dimensions.base_width_mm}
                      onChange={(e) =>
                        update((d) => (d.dimensions.base_width_mm = e.target.value === '' ? null : parseInt(e.target.value, 10)))
                      }
                      required
                      error={!!errorFor('spec.dimensions.base_width_mm')}
                      helperText={errorFor('spec.dimensions.base_width_mm') || ''}
                    />
                  </Box>
                </>
              ) : canHaveGusset && gussetEnabled ? (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <TextField
                      label={`${productType} Width (mm)`}
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={dimensions.base_width_mm == null || dimensions.base_width_mm === 0 ? '' : dimensions.base_width_mm}
                      onChange={(e) =>
                        update((d) => (d.dimensions.base_width_mm = e.target.value === '' ? null : parseInt(e.target.value, 10)))
                      }
                      required
                      error={!!errorFor('spec.dimensions.base_width_mm')}
                      sx={{ width: 200 }}
                    />
                    <Typography sx={{ fontSize: '1.75rem', lineHeight: 1, color: 'text.secondary', px: 0.5 }}>+</Typography>
                    <TextField
                      label="Gusset Return (mm)"
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={dimensions.gusset_mm ?? ''}
                      onChange={(e) =>
                        update((d) => (d.dimensions.gusset_mm = e.target.value ? parseInt(e.target.value) : null))
                      }
                      error={!!errorFor('spec.dimensions.gusset_mm')}
                      sx={{ width: 200 }}
                    />
                    <Typography sx={{ fontSize: '1.75rem', lineHeight: 1, color: 'text.secondary', px: 0.5 }}>=</Typography>
                    <TextField
                      label="Layflat Width (mm)"
                      value={Number.isFinite(derived.layflat_mm) ? String(Math.round(derived.layflat_mm)) : ''}
                      InputProps={{ readOnly: true }}
                      disabled
                      sx={{ width: 180 }}
                    />
                  </Box>
                </>
              ) : (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr)', gap: 2 }}>
                    <TextField
                      label={`${productType} Width (mm)`}
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={dimensions.base_width_mm == null || dimensions.base_width_mm === 0 ? '' : dimensions.base_width_mm}
                      onChange={(e) =>
                        update((d) => (d.dimensions.base_width_mm = e.target.value === '' ? null : parseInt(e.target.value, 10)))
                      }
                      required
                      error={!!errorFor('spec.dimensions.base_width_mm')}
                      helperText={errorFor('spec.dimensions.base_width_mm') || ''}
                    />
                  </Box>
                </>
              )}
            </Stack>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            <DefaultSelectField
              label="Length Units"
              defaultValue="mm"
              value={lengthUnits}
              onChange={(e) =>
                update((d) => {
                  const v = e.target.value as 'mm' | 'M' | 'Continuous'
                  d.dimensions.length_units = v
                  if (v === 'Continuous') d.dimensions.base_length_mm = null
                })
              }
              disabled={productType === PRODUCT_TYPE.Tube}
            >
              <MenuItem value="mm">mm</MenuItem>
              <MenuItem value="M">M</MenuItem>
              {productType !== PRODUCT_TYPE.Bag && productType !== PRODUCT_TYPE.Sleeve ? (
                <MenuItem value="Continuous">Continuous</MenuItem>
              ) : null}
            </DefaultSelectField>
            <TextField
              label={
                lengthUnits === 'Continuous'
                  ? 'Length'
                  : lengthUnits === 'M'
                    ? 'Length (M)'
                    : 'Length (mm)'
              }
              type="number"
              inputProps={
                lengthUnits === 'M'
                  ? { min: 0.001, step: 'any' }
                  : { min: 1, step: 1 }
              }
              value={lengthDisplay}
              onChange={(e) =>
                update((d) => {
                  const raw = e.target.value
                  if (!raw) {
                    d.dimensions.base_length_mm = null
                    return
                  }
                  const n = Number(raw)
                  if (!Number.isFinite(n)) return
                  if (lengthUnits === 'M') {
                    const mm = n * 1000
                    d.dimensions.base_length_mm = Math.round(mm)
                  } else {
                    d.dimensions.base_length_mm = Math.round(n)
                  }
                })
              }
              disabled={productType === PRODUCT_TYPE.Tube || lengthUnits === 'Continuous'}
              helperText={
                productType === PRODUCT_TYPE.Tube
                  ? 'Tubes use continuous length'
                  : lengthUnits === 'Continuous'
                    ? 'Continuous length (no fixed product length)'
                    : ''
              }
              error={!!errorFor('spec.dimensions.base_length_mm')}
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr)', gap: 2 }}>
            <TextField
              label="Thickness/Gauge (µm)"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={dimensions.thickness_um == null || dimensions.thickness_um === 0 ? '' : dimensions.thickness_um}
              onChange={(e) => update((d) => (d.dimensions.thickness_um = e.target.value === '' ? null : parseInt(e.target.value, 10)))}
              required
              error={!!errorFor('spec.dimensions.thickness_um')}
              helperText={errorFor('spec.dimensions.thickness_um') || ''}
            />
          </Box>
        </Stack>
      </Paper>

      {afterDimensionsSlot}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Materials
        </Typography>

        {resinsErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Resins unavailable: {resinsErr}
          </Alert>
        )}

        {resinBlendsErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Resin blends unavailable: {resinBlendsErr}
          </Alert>
        )}

        {coloursErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Colours unavailable: {coloursErr}
          </Alert>
        )}

        {additivesErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Additives unavailable: {additivesErr}
          </Alert>
        )}

        {firstErrorForPrefix('spec.formulation.blend') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.formulation.blend')}
          </Alert>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Resin Blend
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2, mb: 2 }}>
            <DefaultSelectField
              label="Resin Blend"
              defaultValue="LD"
              value={formulation.blend_type || 'LD'}
              onChange={(e) => {
                const v = e.target.value
                update((d) => {
                  d.formulation.blend_type = v
                  if (v === 'Custom') return
                  const preset = resinBlends.find((b) => b.blend_code === v)
                  if (!preset) return
                  d.formulation.blend = preset.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))
                })
              }}
            >
              <MenuItem value="LD">House Blend (LD)</MenuItem>
              {resinBlends
                .filter((b) => b.blend_code !== 'LD')
                .map((b) => (
                  <MenuItem key={b.blend_code} value={b.blend_code}>
                    {b.name}
                  </MenuItem>
                ))}
              <MenuItem value="Custom">Custom</MenuItem>
            </DefaultSelectField>
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Percentage (%)</TableCell>
                <TableCell>Resin</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {blend.map((row: any, idx: number) => {
                const selectedPreset =
                  formulation.blend_type && formulation.blend_type !== 'Custom'
                    ? resinBlends.find((b) => b.blend_code === formulation.blend_type)
                    : null
                const presetComponent = selectedPreset?.components?.[idx]
                const isDefault =
                  !!presetComponent &&
                  (row.resin_code || '').trim() === (presetComponent.resin_code || '').trim() &&
                  Number(row.pct) === Number(presetComponent.pct)
                return (
                  <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                    <TableCell sx={{ width: '35%' }}>
                      <TextField
                        size="small"
                        label="%"
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        value={row.pct ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend[idx].pct = e.target.value ? parseFloat(e.target.value) : null
                          })
                        }
                        error={
                          !!errorFor(`spec.formulation.blend[${idx}].pct`) ||
                          !!firstErrorForPrefix('spec.formulation.blend')
                        }
                        helperText={errorFor(`spec.formulation.blend[${idx}].pct`) || ''}
                        fullWidth
                      />
                    </TableCell>
                    <TableCell sx={{ width: '55%' }}>
                      <ResinSelect
                        options={resins}
                        valueCode={row.resin_code || ''}
                        error={
                          !!errorFor(`spec.formulation.blend[${idx}].resin_code`) ||
                          !!firstErrorForPrefix('spec.formulation.blend')
                        }
                        helperText={
                          errorFor(`spec.formulation.blend[${idx}].resin_code`) ||
                          (idx === 0 ? firstErrorForPrefix('spec.formulation.blend') || '' : '')
                        }
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend[idx].resin_code = nextCode
                          })
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ width: '10%' }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend.splice(idx, 1)
                            if (d.formulation.blend.length === 0) d.formulation.blend.push({ resin_code: '', pct: 100 })
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                update((d) => {
                  d.formulation.blend_type = 'Custom'
                  d.formulation.blend.push({ resin_code: '', pct: null })
                })
              }
            >
              Add component
            </Button>
          </Box>

          {(() => {
            const total = (blend || []).reduce((acc: number, r: any) => acc + Number(r?.pct || 0), 0)
            const ok = Math.abs(total - 100) < 0.01
            return (
              <Typography variant="caption" color={ok ? 'text.secondary' : 'error'} sx={{ display: 'block', mt: 1 }}>
                Total: {total.toFixed(2)}% {ok ? '(OK)' : '(must sum to 100%)'}
              </Typography>
            )
          })()}
        </Box>

        <MaterialsColoursAndAdditives
          colourOptions={colours}
          additiveOptions={additiveOptions}
          colourRows={colourRowsForMaterials}
          onColourRowsChange={handleMaterialsColourRowsChange}
          additiveRows={additiveRowsForMaterials}
          onAdditiveRowsChange={handleMaterialsAdditiveRowsChange}
        />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Printing &amp; Artwork
        </Typography>

        {firstErrorForPrefix('spec.printing') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.printing')}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: printingEnabled ? 'repeat(3, minmax(0, 1fr))' : 'minmax(0, 1fr)',
            },
            gap: 2,
          }}
        >
          <TextField
            select
            label="Printing Method"
            value={printing.method || 'None'}
            onChange={(e) => applyPrintingMethodChange(e.target.value)}
            error={!!errorFor('spec.printing.method') || !!firstErrorForPrefix('spec.printing')}
            helperText={errorFor('spec.printing.method') || ''}
          >
            <MenuItem value="None">None</MenuItem>
            <MenuItem value="Inline">Inline</MenuItem>
            <MenuItem value="Uteco">Uteco</MenuItem>
          </TextField>

          {printingEnabled ? printingNumColoursField : null}

          {printingEnabled ? printingPrintSideField : null}
        </Box>

        {printingSurface === 'job_sheet_summary' && printingEnabled ? (
          <Box sx={{ mt: 1.5 }}>
            <Button variant="outlined" type="button" onClick={() => setPrintingDetailsOpen(true)}>
              Edit printing specification
            </Button>
          </Box>
        ) : null}

        {printingSurface === 'full' && printingEnabled ? (
          <>
            <Box sx={{ mt: 2 }}>{printingTablesInner}</Box>
            {printingDescriptionField}
          </>
        ) : null}

        {printingSurface === 'job_sheet_summary' ? (
          <Dialog
            open={printingDetailsOpen}
            onClose={() => setPrintingDetailsOpen(false)}
            maxWidth="md"
            fullWidth
            scroll="paper"
            disableScrollLock
          >
            <DialogTitle>Printing details</DialogTitle>
            <DialogContent dividers>
              {firstErrorForPrefix('spec.printing') && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {firstErrorForPrefix('spec.printing')}
                </Alert>
              )}
              <Stack spacing={2} sx={{ pt: 0.5 }}>
                {(() => {
                  const hdr = jobSheetPrintingContext || {
                    customerLabel: '—',
                    productDescription: '—',
                    orderNumber: '—',
                    orderDateLabel: '—',
                    dueDateLabel: '—',
                    totalMetersLabel: '—',
                  }
                  return (
                    <Box
                      sx={{
                        pb: 1,
                        borderBottom: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                          gap: 1.5,
                          mb: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Customer
                          </Typography>
                          <Typography variant="body2">{hdr.customerLabel}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Product description
                          </Typography>
                          <Typography variant="body2">{hdr.productDescription}</Typography>
                        </Box>
                      </Box>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                          gap: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Order number
                          </Typography>
                          <Typography variant="body2">{hdr.orderNumber}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Dates
                          </Typography>
                          <Typography variant="body2">
                            Order: {hdr.orderDateLabel} · Due: {hdr.dueDateLabel}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Total metres
                          </Typography>
                          <Typography variant="body2">{hdr.totalMetersLabel}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            From job sheet quantity and product dimensions.
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  )
                })()}

                {printingEnabled ? (
                  <>
                    <TextField
                      label="Print description"
                      value={printing.print_description || ''}
                      onChange={(e) => update((d) => (d.printing.print_description = e.target.value || null))}
                      multiline
                      minRows={2}
                      fullWidth
                    />

                    <TextField
                      label="Bar code"
                      value={printing.barcode || ''}
                      onChange={(e) => update((d) => (d.printing.barcode = e.target.value || null))}
                      fullWidth
                      helperText="Optional: barcode value when the print includes a barcode."
                    />

                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                        Printer
                      </Typography>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={printing.method === 'Uteco' ? 'Uteco' : 'Inline'}
                        onChange={(_, v) => {
                          if (!v) return
                          applyPrintingMethodChange(v)
                        }}
                      >
                        <ToggleButton value="Inline">In-line</ToggleButton>
                        <ToggleButton value="Uteco">Out of line (Uteco)</ToggleButton>
                      </ToggleButtonGroup>
                    </Box>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
                      {printingNumColoursField}
                      {printingPrintSideField}
                      {printingTreatField}
                    </Box>

                    <TextField
                      label="Print position details"
                      value={printing.print_position_notes || ''}
                      onChange={(e) => update((d) => (d.printing.print_position_notes = e.target.value || null))}
                      fullWidth
                      multiline
                      minRows={2}
                      placeholder='e.g. 35 mm from bottom of bag'
                    />

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Film type supplied
                        </Typography>
                        <Typography variant="body2">{filmSuppliedReadonly}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Finished bag size
                        </Typography>
                        <Typography variant="body2">{finishedBagSizeReadonly}</Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                      <DefaultSelectField
                        label="Seal type"
                        defaultValue=""
                        value={printing.seal_type || ''}
                        onChange={(e) =>
                          update((d) => {
                            const v = e.target.value
                            d.printing.seal_type = v ? (v as any) : null
                          })
                        }
                      >
                        <MenuItem value="">
                          <em>Not set</em>
                        </MenuItem>
                        <MenuItem value="side">Side</MenuItem>
                        <MenuItem value="end">End</MenuItem>
                      </DefaultSelectField>
                      <DefaultSelectField
                        label="Eye spot"
                        defaultValue=""
                        value={printing.eye_spot || ''}
                        onChange={(e) =>
                          update((d) => {
                            const v = e.target.value
                            d.printing.eye_spot = v ? (v as any) : null
                          })
                        }
                      >
                        <MenuItem value="">
                          <em>Not set</em>
                        </MenuItem>
                        <MenuItem value="yes">Yes</MenuItem>
                        <MenuItem value="no">No</MenuItem>
                      </DefaultSelectField>
                    </Box>

                    <PrintingArtworkUploadSection
                      scope={printingArtworkScope}
                      disabled={!printingEnabled}
                      files={printingArtworkFiles as PrintingArtworkFileRow[]}
                      onChangeFiles={(next) =>
                        update((d) => {
                          d.printing.artwork_files = next as any
                        })
                      }
                    />

                    {jobSheetPrintingInkTables}

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
                      <TextField
                        label="Cylinder (mm)"
                        type="number"
                        value={printing.cylinder_size_mm ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          update((d) => {
                            d.printing.cylinder_size_mm = v === '' ? null : Number(v)
                          })
                        }}
                        inputProps={{ min: 0, step: 'any' }}
                        helperText="Cylinder dimension (e.g. repeat length)."
                      />
                      <TextField
                        label="Around"
                        type="number"
                        value={printing.plates_around ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            d.printing.plates_around = clampPlateLayoutInt(e.target.value)
                          })
                        }
                        inputProps={{ min: 1, max: 3, step: 1 }}
                        helperText="Copies of the plate around the cylinder (1–3)."
                      />
                      <TextField
                        label="Across"
                        type="number"
                        value={printing.plates_across ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            d.printing.plates_across = clampPlateLayoutInt(e.target.value)
                          })
                        }
                        inputProps={{ min: 1, max: 3, step: 1 }}
                        helperText="Copies side by side (1–3)."
                      />
                    </Box>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Select a printing method above to edit printing details.
                  </Typography>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={() => setPrintingDetailsOpen(false)}>
                Done
              </Button>
            </DialogActions>
          </Dialog>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Quality Expectations
        </Typography>

        <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {[
            { id: 'tight_gauge', label: 'Tight gauge tolerance' },
            { id: 'seal_integrity', label: 'Seal integrity critical' },
            { id: 'cosmetic', label: 'Printing Quality' },
            { id: 'colour', label: 'Colour critical' },
          ].map((f) => (
            <FormControlLabel
              key={f.id}
              control={
                <Checkbox
                  checked={qualityFlags.has(f.id)}
                  onChange={(e) =>
                    update((d) => {
                      const cur = new Set<string>(d.quality_expectations.flags || [])
                      if (e.target.checked) cur.add(f.id)
                      else cur.delete(f.id)
                      d.quality_expectations.flags = Array.from(cur)
                    })
                  }
                />
              }
              label={f.label}
            />
          ))}
        </FormGroup>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Industry / Compliance Intent
          </Typography>
          <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {[
              { id: 'food_contact', label: 'Food Contact' },
              { id: 'medical', label: 'Medical' },
              { id: 'chemical_industrial', label: 'Chemical / Industrial' },
            ].map((f) => (
              <FormControlLabel
                key={f.id}
                control={
                  <Checkbox
                    checked={industryFlags.has(f.id)}
                    onChange={(e) =>
                      update((d) => {
                        const cur = new Set<string>(d.identity.industry_flags || [])
                        if (e.target.checked) cur.add(f.id)
                        else cur.delete(f.id)
                        d.identity.industry_flags = Array.from(cur)
                      })
                    }
                  />
                }
                label={f.label}
              />
            ))}
          </FormGroup>
        </Box>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Known Issues"
            value={quality.known_issues || ''}
            onChange={(e) => update((d) => (d.quality_expectations.known_issues = e.target.value || null))}
            multiline
            minRows={3}
            fullWidth
            error={!!errorFor('spec.quality_expectations.known_issues')}
            helperText={errorFor('spec.quality_expectations.known_issues') || ''}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Run Requirements
        </Typography>

        {firstErrorForPrefix('spec.run_requirements') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.run_requirements')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <DefaultSelectField
            label="Core Type"
            defaultValue="13mm"
            value={packaging.core_type || '13mm'}
            onChange={(e) => update((d) => (d.packaging.core_type = e.target.value))}
          >
            {['7mm', '13mm', 'PVC', 'None'].map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </DefaultSelectField>
          {finishMode === 'Rolls' ? (
            <DefaultSelectField
              label="Roll weight billing"
              defaultValue="core_off"
              value={identity.roll_weight_billing || 'core_off'}
              onChange={(e) => update((d) => (d.identity.roll_weight_billing = e.target.value))}
            >
              <MenuItem value="core_included">Include core</MenuItem>
              <MenuItem value="core_off">Exclude core</MenuItem>
              <MenuItem value="core_half_off">Half core</MenuItem>
            </DefaultSelectField>
          ) : (
            <TextField
              label="Bags per Carton"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={packaging.bags_per_carton ?? ''}
              onChange={(e) =>
                update((d) => (d.packaging.bags_per_carton = e.target.value ? parseInt(e.target.value) : null))
              }
              required
              error={
                !!errorFor('spec.packaging.bags_per_carton') ||
                (!!errorFor('spec.packaging') && finishMode === 'Cartons')
              }
              helperText={
                errorFor('spec.packaging.bags_per_carton') ||
                (finishMode === 'Cartons' ? errorFor('spec.packaging') : '') ||
                ''
              }
            />
          )}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2, mt: 2 }}>
          <TextField
            label="Trim (%)"
            type="number"
            inputProps={{ min: 0, step: 0.1 }}
            value={identity.trim_pct ?? ''}
            onChange={(e) =>
              update((d) => {
                d.identity.trim_pct = e.target.value === '' ? null : parseFloat(e.target.value)
              })
            }
            error={!!errorFor('spec.identity.trim_pct')}
            helperText={errorFor('spec.identity.trim_pct') || ''}
          />
          <TextField
            label="Tolerance (mm)"
            type="number"
            inputProps={{ min: 0, step: 0.1 }}
            value={dimensions.width_tolerance_mm ?? ''}
            onChange={(e) =>
              update((d) => {
                const raw = e.target.value
                ;(d.dimensions as any).width_tolerance_mm = raw === '' ? null : parseFloat(raw)
              })
            }
            error={!!errorFor('spec.dimensions.width_tolerance_mm')}
          />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mt: 2 }}>
          <TextField
            select
            label="Slit"
            value={run.slit || 'none'}
            onChange={(e) => update((d) => (d.run_requirements.slit = e.target.value))}
            error={!!errorFor('spec.run_requirements.slit')}
            helperText={errorFor('spec.run_requirements.slit') || ''}
          >
            <MenuItem value="none">none</MenuItem>
            <MenuItem value="one_side">Slit one side</MenuItem>
            <MenuItem value="both_sides">Slit both sides</MenuItem>
            <MenuItem value="middle">slit up middle</MenuItem>
          </TextField>
          <TextField
            select
            label="Treat Inside/Outside"
            value={run.treat_inside_outside || 'none'}
            onChange={(e) => update((d) => (d.run_requirements.treat_inside_outside = e.target.value))}
            error={!!errorFor('spec.run_requirements.treat_inside_outside')}
            helperText={errorFor('spec.run_requirements.treat_inside_outside') || ''}
          >
            <MenuItem value="none">none</MenuItem>
            <MenuItem value="inside">inside</MenuItem>
            <MenuItem value="outside">outside</MenuItem>
          </TextField>
        </Box>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Notes"
            value={run.notes || ''}
            onChange={(e) => update((d) => (d.run_requirements.notes = e.target.value || null))}
            multiline
            minRows={3}
            fullWidth
            error={!!errorFor('spec.run_requirements.notes')}
            helperText={errorFor('spec.run_requirements.notes') || ''}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Packaging &amp; Logistics
        </Typography>

        {firstErrorForPrefix('spec.packaging') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.packaging')}
          </Alert>
        )}

        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <DefaultSelectField
              label="Pallet Type"
              defaultValue="Chep"
              value={packaging.pallet_type || 'Chep'}
              onChange={(e) => update((d) => (d.packaging.pallet_type = e.target.value))}
            >
              {['Chep', 'Plain', 'Resin', 'None'].map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </DefaultSelectField>
          </Box>
        </Stack>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Packing Notes"
            value={packaging.notes || ''}
            onChange={(e) => update((d) => (d.packaging.notes = e.target.value || null))}
            multiline
            minRows={2}
            fullWidth
            error={!!errorFor('spec.packaging.notes')}
            helperText={errorFor('spec.packaging.notes') || ''}
          />
        </Box>

      </Paper>

    </Stack>
  )
}


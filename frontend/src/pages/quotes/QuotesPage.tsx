import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { createOrder, fetchOrder } from '../../store/slices/ordersSlice'
import { createProduct } from '../../store/slices/productsSlice'
import {
  clearUpsertErrors,
  createSavedQuote,
  fetchQuoteRatebook,
  fetchQuoteResinBlends,
  fetchQuotesBootstrap,
  updateSavedQuote,
} from '../../store/slices/quotesSlice'
import { fetchCustomer, fetchCustomers, CUSTOMER_PICKER_PAGE_SIZE, type CustomerSummary } from '../../store/slices/customersSlice'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormGroup,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { ColourOption } from '../../components/ColourSelect'
import type { AdditiveOption } from '../../components/AdditiveSelect'
import { MaterialsColoursAndAdditives } from '../../components/MaterialsColoursAndAdditives'
import { DefaultSelectField } from '../../components/DefaultSelectField'
import { productTypeCanHaveGusset } from '../../utils/specCompat'
import type { DerivedDisplay, QtyType } from '../../utils/quantityRollFields'
import { computeWeightPerRollDisplay, qtyTypeFromPersisted } from '../../utils/quantityRollFields'
import { getDisplayProductCodeFromSpec, computeProductDescriptionFromSpec } from '../../utils/productDescription'
import {
  computeAppliedExtrusionWasteFactors,
  computeDerivedGeometryAndTotals,
  computeLayflatWidthMm,
  computePrintingUnavailableReason,
  computeQuickQuotePreview,
  computeMaterialsMoqDenomKg,
  getRollWeightAvgKg,
  mapProductTypeToMaterialsRetailGroup,
  resolveMaterialsRetailBand,
  type AppliedExtrusionWasteFactor,
  type QuickQuoteInputs,
} from '../../utils/quoteCalculator'
import {
  buildSpecFromQuotePayload,
  getOrderQuantityFromQuotePayload,
  parsePositiveKgLoose,
  resolveWeightPerRollKgForOrderConvert,
  type QuotePayload,
} from '../../utils/quoteToSpec'
import {
  moqDiscreteProductCountCoveringMoq,
  resolveBandMoqKgFromQuoteForm,
  roundToDecimalPlaces,
  synthesizeMoqQuantity,
} from './moqQuoteQuantity'
import { QuotePreviewPanel } from './components/QuotePreviewPanel'
import { MobileFixedBottomAside, StickySideAside } from '../../components/StickySideAside'
import { fmtCount, fmtDollarsPreview, fmtHoursMinutes, fmtHoursMinutesPreview, fmtQtyNumber } from '../../utils/quoteFormat'
import { joinQuoteDescriptionWithPackagingTail, quotePackagingPerUnitTail } from '../../utils/quoteQuantityDescriptors'
import { formatDateDMYShort } from '../../utils/dateFormat'

function formatKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

/** Round a numeric string to 2 decimal places for storage/display (e.g. Price per KG). */
function roundTo2Decimals(s: string): string {
  if (s.trim() === '') return s
  const n = Number(s)
  return Number.isFinite(n) ? n.toFixed(2) : s
}

/** Same cents rule as `roundMoney` in `quoteCalculator.ts` (preview job total / $/kg reconciliation). */
function roundMoneyCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * $/kg such that `roundMoneyCents(rate × billedKg)` equals `roundMoneyCents(quotedTotal)` after save/reload,
 * so the Live Quote total matches the payload snapshot without a spurious Adjustments line.
 */
function pricePerKgFromQuotedTotal(quotedTotal: number, billedKg: number): number | null {
  if (!(billedKg > 0) || !Number.isFinite(quotedTotal) || quotedTotal <= 0) return null
  const target = roundMoneyCents(quotedTotal)
  let p = quotedTotal / billedKg
  if (roundMoneyCents(p * billedKg) === target) return p
  let lo = 0
  let hi = Math.max((target / billedKg) * 4, 1e-12)
  while (roundMoneyCents(hi * billedKg) < target && hi < 1e9) hi *= 2
  for (let i = 0; i < 90 && lo + 1e-15 < hi; i++) {
    const mid = (lo + hi) / 2
    if (roundMoneyCents(mid * billedKg) >= target) hi = mid
    else lo = mid
  }
  const out = hi
  return roundMoneyCents(out * billedKg) === target ? out : quotedTotal / billedKg
}

/** Trim trailing zeros for a stable high-precision string in the Price/kg field. */
function formatPricePerKgString(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return ''
  return p.toFixed(10).replace(/\.?0+$/, '')
}

function fmtSavedQuoteDate(raw: string | null | undefined): string {
  return formatDateDMYShort(raw, '—')
}

/**
 * RTK `unwrap()` rejects with the value passed to `rejectWithValue` (plain object), not always `Error`.
 * Use this for createProduct and similar thunks.
 */
function formatThunkRejection(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const msgs = o.messages
    if (Array.isArray(msgs) && msgs.length > 0) {
      const joined = msgs.map(String).filter(Boolean).join(' · ')
      if (joined) return joined
    }
    const fe = o.fieldErrors
    if (fe && typeof fe === 'object' && !Array.isArray(fe)) {
      const entries = Object.entries(fe as Record<string, string>).filter(
        ([, v]) => v != null && String(v).trim() !== '',
      )
      if (entries.length > 0) return entries.map(([k, v]) => `${k}: ${v}`).join(' · ')
    }
    const m = o.message
    if (typeof m === 'string' && m.trim() && m !== 'Rejected') return m.trim()
  }
  if (e instanceof Error) return e.message || fallback
  return fallback
}

/** Reusable alert for printing validation errors; show in both Printing section and at top of form. */
function PrintingUnavailableAlert({ message, prominent = false }: { message: string | null; prominent?: boolean }) {
  if (!message) return null
  return (
    <Alert
      severity="error"
      sx={
        prominent
          ? { py: 1.5, '& .MuiAlert-message': { fontSize: '1rem' } }
          : { mt: 2 }
      }
    >
      {message}
    </Alert>
  )
}

export type SavedQuoteInitialData = {
  customer_id: string
  customer_name?: string | null
  payload: Record<string, unknown>
  /** String from API preserves exact decimals on reload */
  cost_per_kg?: string | number | null
  price_per_kg?: string | number | null
  created_at?: string | null
  updated_at?: string | null
}

type QuotesPageProps = {
  quoteId?: string
  initialData?: SavedQuoteInitialData | null
}

export function QuotesPage({ quoteId, initialData }: QuotesPageProps = {}) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditMode = Boolean(quoteId && initialData)

  const dispatch = useAppDispatch()
  const bootstrapState = useAppSelector((s) => s.quotes.bootstrap)
  const upsertState = useAppSelector((s) => s.quotes.upsert)
  const quoteRatebookState = useAppSelector((s) => s.quotes.quoteRatebook)
  const quoteResinBlendsState = useAppSelector((s) => s.quotes.quoteResinBlends)
  const bootstrap = bootstrapState.data
  const ratebook = quoteRatebookState.data
  const ratebookErr = quoteRatebookState.status === 'failed' ? quoteRatebookState.error : null
  const resinBlends = quoteResinBlendsState.items
  const resinBlendsErr = quoteResinBlendsState.status === 'failed' ? quoteResinBlendsState.error : null
  const [err, setErr] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState<string>('')
  const saving = upsertState.status === 'loading'
  const displayErr = err || bootstrapState.error || upsertState.error || null
  const [hydratedFromQuote, setHydratedFromQuote] = useState(false)
  const initialPayloadSnapshotRef = useRef<string | null>(null)
  /** True after we've captured `initialPayloadSnapshotRef` post–rate book + resin blends (avoids false "user edited" on refresh). */
  const editPayloadBaselineCapturedRef = useRef(false)
  const preserveLoadedPricePerKgRef = useRef(false)
  const payloadForEditDetectionRef = useRef<Record<string, unknown>>({})
  /** After quote hydrate, avoid treating loaded Cartons as Rolls → Cartons (would overwrite weight with conversion default). */
  const prevFinishModeForCartonWprRef = useRef<'Rolls' | 'Cartons' | null>(null)
  /** Latest numeric values shown in quantity fields (state or read-only computed), for persisting across Qty Type changes. */
  const qtyTypeCarrySnapRef = useRef({
    totalKgFromUi: null as number | null,
    weightPerRollFromUi: null as number | null,
    rollsFromUi: null as number | null,
    unitsFromUi: null as number | null,
    cartonsFromUi: null as number | null,
    unitsPerRollFromUi: null as number | null,
    metersPerRollFromUi: null as number | null,
  })

  // Quantity (values shared across qty types; qtyType controls which fields are editable vs computed)
  const [qtyType, setQtyType] = useState<QtyType>('kg')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')
  const [numCartons, setNumCartons] = useState('')
  const [cartonQtyMode, setCartonQtyMode] = useState<'1000' | 'ctn'>('1000')
  /** When true, pricing uses materials MOQ for this width; primary quantity fields are mirrored from that MOQ. */
  const [quoteUsesMoqOnly, setQuoteUsesMoqOnly] = useState(true)
  /** Rolls × units-per-roll mode: e.g. bags per roll when qtyType is rolls_units. */
  const [unitsPerRoll, setUnitsPerRoll] = useState('')
  /** Continuous-roll mode: linear meters per roll (primarily Tube quotes). */
  const [metersPerRoll, setMetersPerRoll] = useState('')

  // Product identity
  const [productType, setProductType] = useState('Bag')
  const [finishMode, setFinishMode] = useState<'Rolls' | 'Cartons'>('Rolls')
  const [flagGusset, setFlagGusset] = useState(false)
  const [flagPrinted, setFlagPrinted] = useState(false)
  const [flagPerforated, setFlagPerforated] = useState(false)
  const [flagSealed, setFlagSealed] = useState(false)
  const [flagPunched, setFlagPunched] = useState(false)

  // Dimensions
  const [widthMm, setWidthMm] = useState('')
  const [ufilmLeftWidthMm, setUfilmLeftWidthMm] = useState('')
  const [ufilmRightWidthMm, setUfilmRightWidthMm] = useState('')
  const [gussetReturnMm, setGussetReturnMm] = useState('')
  const [lengthUnits, setLengthUnits] = useState<'mm' | 'm' | 'continuous'>('mm')
  const [length, setLength] = useState('')
  const [thicknessUm, setThicknessUm] = useState('')
  const [runUp, setRunUp] = useState<number>(1)
  const [layflatInput, setLayflatInput] = useState<string | null>(null)

  // Materials
  const [resinBlendCode, setResinBlendCode] = useState<string>('LD')
  const [colourRows, setColourRows] = useState<Array<{ colour_code: string; strength_pct: string }>>([
    { colour_code: '', strength_pct: '' },
    { colour_code: '', strength_pct: '' },
  ])
  const [additiveRows, setAdditiveRows] = useState<Array<{ additive_code: string; pct: string }>>([
    { additive_code: '', pct: '' },
    { additive_code: '', pct: '' },
  ])

  // Printing
  const [printMethod, setPrintMethod] = useState<'None' | 'Inline' | 'Uteco'>('None')
  const [numColours, setNumColours] = useState('')
  const [desiredNumColours, setDesiredNumColours] = useState('')

  // Packaging
  const [coreType, setCoreType] = useState('13mm')
  const [rollWeightBilling, setRollWeightBilling] = useState<'core_included' | 'core_off' | 'core_half_off'>('core_off')
  const [bagsPerCarton, setBagsPerCarton] = useState('')
  const [palletType, setPalletType] = useState<'Chep' | 'Plain' | 'Resin' | 'None'>('Chep')
  const [quoteNotes, setQuoteNotes] = useState('')
  /** Persisted in quote payload after a successful convert-to-order. */
  const [convertedOrderId, setConvertedOrderId] = useState<string | null>(null)

  /** Optional override: when set, job price = this × billed kg instead of summed retail components. */
  const [suggestedPricePerKg, setSuggestedPricePerKg] = useState('')
  const [quickPreview, setQuickPreview] = useState<any>(null)
  const [calcLoading, setCalcLoading] = useState(false)

  const showNumColours = printMethod && printMethod !== 'None'
  const canHaveGusset = productTypeCanHaveGusset(productType)
  const isUFilm = productType === 'U-Film'
  const derivedGeometry: 'Flat' | 'Gusset' = canHaveGusset && flagGusset ? 'Gusset' : 'Flat'

  useEffect(() => {
    void dispatch(fetchQuotesBootstrap())
  }, [dispatch])

  useEffect(() => {
    dispatch(clearUpsertErrors())
  }, [dispatch, quoteId])

  // Pre-fill customer from URL when creating a new quote (e.g. from customer show page)
  useEffect(() => {
    if (quoteId || hydratedFromQuote) return
    const fromUrl = searchParams.get('customerId') || searchParams.get('customer_id')
    if (fromUrl && fromUrl.trim()) setCustomerId(fromUrl.trim())
  }, [quoteId, hydratedFromQuote, searchParams])

  // Hydrate form from saved quote when editing
  useEffect(() => {
    if (!initialData?.payload || hydratedFromQuote) return
    initialPayloadSnapshotRef.current = null
    editPayloadBaselineCapturedRef.current = false
    const p = initialData.payload as any
    setCustomerId(initialData.customer_id || '')
    if (p.product_type != null) setProductType(String(p.product_type))
    if (p.geometry != null) setFlagGusset(p.geometry === 'Gusset')
    if (p.finish_mode != null) setFinishMode(p.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls')
    if (p.base_width_mm != null) setWidthMm(p.base_width_mm === 0 ? '' : String(p.base_width_mm))
    if (p.ufilm_left_width_mm != null) setUfilmLeftWidthMm(String(p.ufilm_left_width_mm))
    if (p.ufilm_right_width_mm != null) setUfilmRightWidthMm(String(p.ufilm_right_width_mm))
    if (p.gusset_mm != null) setGussetReturnMm(String(p.gusset_mm))
    if (p.length != null) setLength(String(p.length))
    else if (p.base_length_mm != null) setLength(String(p.base_length_mm))
    if (p.thickness_um != null) setThicknessUm(p.thickness_um === 0 ? '' : String(p.thickness_um))
    if (p.run_up != null) setRunUp(Number(p.run_up) || 1)
    if (p.resin_blend_code != null) setResinBlendCode(String(p.resin_blend_code))
    if (Array.isArray(p.colourRows)) {
      const rows = p.colourRows as Array<{ colour_code: string; strength_pct: string }>
      const pad = rows.length >= 2 ? [] : [...Array(2 - rows.length)].map(() => ({ colour_code: '', strength_pct: '' }))
      setColourRows(pad.length ? [...rows, ...pad] : rows)
    } else if (Array.isArray(p.colour_components) && p.colour_components.length > 0) {
      const rows = (p.colour_components as any[]).map((c: any) => ({
        colour_code: c.colour_code || '',
        strength_pct: c.strength_pct != null ? String(c.strength_pct) : '',
      }))
      const pad = rows.length >= 2 ? [] : [...Array(2 - rows.length)].map(() => ({ colour_code: '', strength_pct: '' }))
      setColourRows(pad.length ? [...rows, ...pad] : rows)
    }
    if (Array.isArray(p.additiveRows)) {
      const rows = p.additiveRows as Array<{ additive_code: string; pct: string }>
      const pad = rows.length >= 2 ? [] : [...Array(2 - rows.length)].map(() => ({ additive_code: '', pct: '' }))
      setAdditiveRows(pad.length ? [...rows, ...pad] : rows)
    } else if (Array.isArray(p.additives) && p.additives.length > 0) {
      const rows = (p.additives as any[]).map((a: any) => ({
        additive_code: a.additive_code || '',
        pct: a.pct != null ? String(a.pct) : '',
      }))
      const pad = rows.length >= 2 ? [] : [...Array(2 - rows.length)].map(() => ({ additive_code: '', pct: '' }))
      setAdditiveRows(pad.length ? [...rows, ...pad] : rows)
    }
    if (p.print_method != null) setPrintMethod(p.print_method === 'Uteco' ? 'Uteco' : p.print_method === 'Inline' ? 'Inline' : 'None')
    if (p.num_colours != null) setNumColours(p.num_colours === 0 ? '' : String(p.num_colours))
    if (p.num_colours != null) setDesiredNumColours(p.num_colours === 0 ? '' : String(p.num_colours))
    if (p.finish_mode === 'Cartons') {
      if (p.bags_per_carton != null) setBagsPerCarton(String(p.bags_per_carton))
    }
    if (p.core_type != null) setCoreType(p.core_type)
    if (p.roll_weight_billing != null) setRollWeightBilling(p.roll_weight_billing)
    if (p.pallet_type != null) setPalletType(p.pallet_type)
    const qtyRaw = p.qtyType ?? (p as { qty_type?: string }).qty_type
    const persistedQtyType: QtyType =
      qtyRaw != null && String(qtyRaw).trim() ? qtyTypeFromPersisted(String(qtyRaw)) : 'kg'
    if (qtyRaw != null && String(qtyRaw).trim()) {
      setQtyType(persistedQtyType)
    }
    if (p.length != null) setLength(p.length)
    const luRaw = p.lengthUnits ?? (p as { length_units?: string }).length_units
    const luStr = luRaw != null ? String(luRaw).toLowerCase() : ''
    if (p.continuous_roll === true || luStr === 'continuous' || String(p.product_type) === 'Tube') {
      setLengthUnits('continuous')
      setLength('')
    } else if (luStr === 'm' || luStr === 'M' || p.lengthUnits === 'm') {
      setLengthUnits('m')
    } else if (p.lengthUnits != null || (p as { length_units?: string }).length_units != null) {
      setLengthUnits('mm')
    }
    if (p.numUnits != null) setNumUnits(String(p.numUnits))
    if (p.numCartons != null) setNumCartons(String(p.numCartons))
    if (p.cartonQtyMode === 'ctn' || p.carton_qty_mode === 'ctn') setCartonQtyMode('ctn')
    else if (p.cartonQtyMode === '1000' || p.carton_qty_mode === '1000') setCartonQtyMode('1000')
    if (p.unitsPerRoll != null) setUnitsPerRoll(String(p.unitsPerRoll))
    if (p.metersPerRoll != null) setMetersPerRoll(String(p.metersPerRoll))
    const numRollsHydrated = p.numRolls ?? (p as { num_rolls?: string | number }).num_rolls
    if (numRollsHydrated != null) setNumRolls(String(numRollsHydrated))
    const quotedTkRaw = (p as { quoted_totals_kg?: unknown }).quoted_totals_kg
    const quotedTotalsKgNum =
      quotedTkRaw != null && quotedTkRaw !== '' && Number.isFinite(Number(quotedTkRaw)) && Number(quotedTkRaw) > 0
        ? Number(quotedTkRaw)
        : null
    /** Root-level total kg from payload (camelCase from save; API may expose snake_case). */
    const rootTotalKgRaw = (p as { totalKg?: unknown; total_kg?: unknown }).totalKg ?? (p as { total_kg?: unknown }).total_kg
    let totalKgHydrate: string | null = null
    if (persistedQtyType === 'kg') {
      if (rootTotalKgRaw != null && String(rootTotalKgRaw).trim() !== '') totalKgHydrate = String(rootTotalKgRaw)
      else if (p.quantity?.total_kg != null && Number(p.quantity.total_kg) > 0)
        totalKgHydrate = String(p.quantity.total_kg)
      else if (quotedTotalsKgNum != null) totalKgHydrate = String(quotedTotalsKgNum)
    } else {
      if (quotedTotalsKgNum != null) totalKgHydrate = String(quotedTotalsKgNum)
      else if (rootTotalKgRaw != null && String(rootTotalKgRaw).trim() !== '') totalKgHydrate = String(rootTotalKgRaw)
      else if (p.quantity?.total_kg != null && Number(p.quantity.total_kg) > 0)
        totalKgHydrate = String(p.quantity.total_kg)
    }
    if (totalKgHydrate != null) setTotalKg(totalKgHydrate)
    const wprHydrated =
      p.weightPerRoll ??
      (p as { weight_per_roll_kg?: string | number }).weight_per_roll_kg ??
      (p as { weight_per_roll?: string | number }).weight_per_roll
    if (wprHydrated != null) setWeightPerRoll(String(wprHydrated))
    if (p.quantity?.units != null) setNumUnits(String(p.quantity.units))
    if (p.quantity?.rolls != null) setNumRolls(String(p.quantity.rolls))
    if (p.flagPerforated != null) setFlagPerforated(!!p.flagPerforated)
    else if (p.inline_perforation != null) setFlagPerforated(!!p.inline_perforation)
    if (p.flagSealed != null) setFlagSealed(!!p.flagSealed)
    else if (p.inline_seal != null) setFlagSealed(!!p.inline_seal)
    if (p.flagPunched != null) setFlagPunched(!!p.flagPunched)
    else if (p.hole_punched != null) setFlagPunched(!!p.hole_punched)
    if (p.showNumColours != null) setFlagPrinted(!!p.showNumColours)
    setQuoteNotes(typeof p.notes === 'string' ? p.notes : '')
    const moqOnlyRaw = (p as { quote_uses_moq_only?: unknown; quoteUsesMoqOnly?: unknown }).quote_uses_moq_only ?? (p as { quoteUsesMoqOnly?: unknown }).quoteUsesMoqOnly
    const moqExplicitFalse =
      moqOnlyRaw === false || moqOnlyRaw === 'false' || moqOnlyRaw === 0 || moqOnlyRaw === '0'
    setQuoteUsesMoqOnly(!moqExplicitFalse)
    const coRaw = p.converted_order_id
    if (coRaw != null && String(coRaw).trim() !== '') setConvertedOrderId(String(coRaw).trim())
    else setConvertedOrderId(null)
    // Prefer $/kg implied by the saved job total ÷ billed kg (matches `quoted_total_price` / `quoted_totals_kg` on payload)
    // so reopening the quote reproduces the same rounded total without a phantom Adjustments line.
    const snap = initialData.payload as Record<string, unknown>
    const qtpRaw = snap.quoted_total_price
    const qtkRaw = snap.quoted_totals_kg
    const qtp = qtpRaw != null && String(qtpRaw).trim() !== '' ? Number(qtpRaw) : NaN
    const qtk = qtkRaw != null && String(qtkRaw).trim() !== '' ? Number(qtkRaw) : NaN
    const fromSnapshot =
      Number.isFinite(qtp) && qtp > 0 && Number.isFinite(qtk) && qtk > 0 ? pricePerKgFromQuotedTotal(qtp, qtk) : null
    if (fromSnapshot != null && Number.isFinite(fromSnapshot) && fromSnapshot > 0) {
      setSuggestedPricePerKg(formatPricePerKgString(fromSnapshot))
      preserveLoadedPricePerKgRef.current = true
    } else if (initialData.price_per_kg != null && initialData.price_per_kg !== '') {
      const raw = typeof initialData.price_per_kg === 'string' ? initialData.price_per_kg.trim() : String(initialData.price_per_kg)
      const pricePerKgNum = Number(raw)
      if (Number.isFinite(pricePerKgNum) && pricePerKgNum > 0) {
        setSuggestedPricePerKg(roundTo2Decimals(raw))
        preserveLoadedPricePerKgRef.current = true
      } else {
        preserveLoadedPricePerKgRef.current = false
        setSuggestedPricePerKg('')
      }
    } else {
      preserveLoadedPricePerKgRef.current = false
      setSuggestedPricePerKg('')
    }
    prevFinishModeForCartonWprRef.current = p.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
    setHydratedFromQuote(true)
  }, [initialData, hydratedFromQuote])

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  useEffect(() => {
    void dispatch(fetchQuoteResinBlends())
  }, [dispatch])

  useEffect(() => {
    if (!Array.isArray(resinBlends) || resinBlends.length === 0) return
    // Prefer LD as the default; if not present, fall back to first blend.
    const codes = new Set(resinBlends.map((b) => b.blend_code))
    if (codes.has(resinBlendCode)) return
    const ld = resinBlends.find((b) => b.blend_code === 'LD')?.blend_code
    setResinBlendCode(ld || resinBlends[0]?.blend_code || 'LD')
  }, [resinBlends, resinBlendCode])

  useEffect(() => {
    // Keep gusset flag compatible with SpecPayloadForm rules.
    if (!canHaveGusset && flagGusset) {
      setFlagGusset(false)
      setGussetReturnMm('')
    }
  }, [canHaveGusset, flagGusset])

  useEffect(() => {
    // Mirror SpecPayloadForm behavior: U-Film uses left/right widths and no gusset.
    if (!isUFilm) {
      setUfilmLeftWidthMm('')
      setUfilmRightWidthMm('')
    }
  }, [isUFilm])

  function setPrinted(next: boolean) {
    setFlagPrinted(next)
    if (!next) {
      setPrintMethod('None')
      setNumColours('')
      setDesiredNumColours('')
      return
    }
    if (printMethod === 'None') setPrintMethod('Inline')
    if (!numColours) setNumColours('1')
    if (!desiredNumColours) setDesiredNumColours('1')
  }

  function onChangePrintMethod(next: 'None' | 'Inline' | 'Uteco') {
    setPrintMethod(next)
    const enabled = next !== 'None'
    setFlagPrinted(enabled)
    if (!enabled) {
      setNumColours('')
      setDesiredNumColours('')
      return
    }
    if (!numColours) setNumColours('1')
    if (!desiredNumColours) setDesiredNumColours('1')
  }

  function toMm(v: string, units: 'mm' | 'm') {
    const n = Number(v || 0)
    if (!Number.isFinite(n)) return 0
    if (units === 'mm') return n
    return n * 1000
  }

  const resins = bootstrap?.resins || []
  const colours = bootstrap?.colours || []
  const additives = bootstrap?.additives || []
  const productTypes = bootstrap?.product_types || ['Bag']
  const printMethods = bootstrap?.print_methods || ['None']

  const defaultResinCode = resins.find((r: any) => r?.code === 'LDPE')?.code || resins?.[0]?.code || null

  const colourOptions: ColourOption[] = colours.map((c: any) => ({ colour_code: c.code, name: c.name }))
  const additiveOptions: AdditiveOption[] = additives.map((a: any) => ({ additive_code: a.code, name: a.name }))

  const lengthAllowsContinuous = productType !== 'Bag' && productType !== 'Sleeve'
  const isTubeProduct = productType === 'Tube'
  const effectiveLengthUnits: 'mm' | 'm' | 'continuous' = isTubeProduct ? 'continuous' : lengthUnits
  const isContinuousLength = effectiveLengthUnits === 'continuous'
  const baseLengthMm = isContinuousLength ? 0 : Math.round(toMm(length, effectiveLengthUnits === 'm' ? 'm' : 'mm'))
  const widthMmNum = Math.round(Number(widthMm || 0))
  const ufilmLeftWidthMmNum = Math.round(Number(ufilmLeftWidthMm || 0))
  const ufilmRightWidthMmNum = Math.round(Number(ufilmRightWidthMm || 0))
  const thicknessUmNum = Math.round(Number(thicknessUm || 0))
  const gussetReturnMmNum = Math.round(Number(gussetReturnMm || 0))
  const totalKgNum = Number(totalKg || 0)
  const numUnitsNum = Math.round(Number(numUnits || 0))
  const numCartonsNum = Math.round(Number(numCartons || 0))
  const numRollsNum = Math.round(Number(numRolls || 0))
  const unitsPerRollNum = Math.max(0, Math.round(Number(unitsPerRoll || 0)))
  const bagsPerCartonNum = bagsPerCarton.trim() !== '' ? Math.max(1, Math.round(Number(bagsPerCarton))) : 0
  const metersPerRollNum = Number(metersPerRoll || 0)
  const weightPerRollNum = parsePositiveKgLoose(weightPerRoll) ?? 0

  const showRunUp = !isUFilm && (productType === 'Sheet' || productType === 'Centerfold')
  const runUpOptions: number[] = productType === 'Centerfold' ? [1, 2] : productType === 'Sheet' ? [2, 4, 6] : [1]
  const qtyMode: 'units' | 'kg' | 'roll' | 'ctn' =
    qtyType === 'units'
      ? finishMode === 'Cartons' && cartonQtyMode === 'ctn'
        ? 'ctn'
        : 'units'
      : qtyType === 'kg'
        ? 'kg'
        : 'roll'

  useEffect(() => {
    if (!showRunUp) {
      if (runUp !== 1) setRunUp(1)
      return
    }
    if (!runUpOptions.includes(runUp)) setRunUp(runUpOptions[0] || 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType, showRunUp])

  useEffect(() => {
    if (isTubeProduct) {
      setLengthUnits('continuous')
      setLength('')
    }
  }, [isTubeProduct])

  useEffect(() => {
    if ((productType === 'Bag' || productType === 'Sleeve') && lengthUnits === 'continuous') {
      setLengthUnits('mm')
    }
  }, [productType, lengthUnits])

  useEffect(() => {
    if (finishMode !== 'Rolls' && (qtyType === 'total_rolls' || qtyType === 'rolls_units')) {
      setQtyType('kg')
      return
    }
    if (isContinuousLength && qtyType === 'rolls_units') setQtyType('total_rolls')
  }, [finishMode, qtyType, isContinuousLength])

  /** Continuous + Rolls: exactly one product per roll; keep state aligned for rolls_units and carry logic. */
  useEffect(() => {
    if (!isContinuousLength || finishMode !== 'Rolls') return
    if (!(qtyType === 'total_rolls' || qtyType === 'rolls_units')) return
    const t = String(unitsPerRoll ?? '').trim()
    if (t === '1') return
    const n = Number(t)
    if (t === '' || !Number.isFinite(n) || n !== 1) setUnitsPerRoll('1')
  }, [isContinuousLength, finishMode, qtyType, unitsPerRoll])

  // Cartons + CTN qty mode: keep total products in sync from cartons × bags/carton.
  useEffect(() => {
    if (!(finishMode === 'Cartons' && qtyType === 'units' && cartonQtyMode === 'ctn')) return
    if (!(numCartonsNum > 0) || !(bagsPerCartonNum > 0)) {
      setNumUnits('')
      return
    }
    setNumUnits(String(numCartonsNum * bagsPerCartonNum))
  }, [finishMode, qtyType, cartonQtyMode, numCartonsNum, bagsPerCartonNum])

  /** Carton finish: default weight/roll to conversion factor `roll_weight_avg` (Average Roll Weight in admin). */
  useEffect(() => {
    const prev = prevFinishModeForCartonWprRef.current
    if (finishMode === 'Cartons' && prev === 'Rolls') {
      const avg = getRollWeightAvgKg(ratebook)
      if (avg > 0) setWeightPerRoll(roundTo2Decimals(String(avg)))
    }
    prevFinishModeForCartonWprRef.current = finishMode
  }, [finishMode, ratebook])

  const calcPayload = useMemo(() => {
    const qty: any = {}
    if (qtyType === 'units') qty.units = numUnitsNum
    if (qtyType === 'kg') {
      qty.total_kg = totalKgNum
      if (finishMode === 'Rolls' && totalKgNum > 0 && weightPerRollNum > 0) {
        qty.rolls = Math.round(totalKgNum / weightPerRollNum)
      }
    }
    if (qtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) {
      const totalUnits = numRollsNum * unitsPerRollNum
      qty.units = totalUnits
      qty.rolls = numRollsNum
      if (baseLengthMm > 0) {
        qty.total_m = (totalUnits * baseLengthMm) / 1000
      }
    }
    // Discrete rolls: mass from kg/roll. Continuous (Tube): web length from rolls × m/roll — do **not** require weight first,
    // or Total KG never updates until weight/roll is filled (derived kg comes from total_m × kg/m).
    if (qtyType === 'total_rolls' && numRollsNum > 0) {
      if (isContinuousLength) {
        if (metersPerRollNum > 0) {
          qty.total_m = numRollsNum * metersPerRollNum
          qty.rolls = numRollsNum
        }
      } else if (weightPerRollNum > 0) {
        qty.total_kg = numRollsNum * weightPerRollNum
        qty.rolls = numRollsNum
      }
    } else if (
      finishMode === 'Rolls' &&
      qtyType !== 'kg' &&
      qtyType !== 'rolls_units' &&
      qtyType !== 'units' &&
      numRollsNum > 0
    ) {
      qty.rolls = numRollsNum
    }

    if ((qtyType === 'units') && numUnitsNum > 0 && baseLengthMm > 0) {
      // Provide total_m so printing/core costing can work for bag-style quotes.
      // Continuous Tube on rolls: web length is metres/roll × units (below); do not use fixed cut length here.
      if (!(isContinuousLength && finishMode === 'Rolls' && metersPerRollNum > 0)) {
        qty.total_m = (numUnitsNum * baseLengthMm) / 1000
      }
    }

    // Continuous length + "total units": one counted unit = one roll (Rolls) or one carton worth of web (Cartons).
    // Populate rolls + total_kg so the calculator's reference mass is not null (avoids the 1m stub for kg/product).
    if (isContinuousLength && (qtyType === 'units') && numUnitsNum > 0) {
      if (finishMode === 'Rolls') {
        qty.rolls = numUnitsNum
        if (metersPerRollNum > 0) {
          // Drive mass from web length (m/roll × rolls); calculator derives kg from total_m × kg/m.
          qty.total_m = numUnitsNum * metersPerRollNum
        } else {
          const perRollKg = weightPerRollNum > 0 ? weightPerRollNum : getRollWeightAvgKg(ratebook)
          if (perRollKg > 0) {
            qty.total_kg = numUnitsNum * perRollKg
          }
        }
      } else if (finishMode === 'Cartons') {
        const bpc = bagsPerCarton.trim() !== '' ? Math.max(1, Math.round(Number(bagsPerCarton))) : 0
        if (bpc > 0) {
          const cartons = Math.ceil(numUnitsNum / bpc)
          const perCartonKg = weightPerRollNum > 0 ? weightPerRollNum : getRollWeightAvgKg(ratebook)
          if (perCartonKg > 0) {
            qty.total_kg = cartons * perCartonKg
          }
        }
      }
    }

    const blendPreset = resinBlendCode ? resinBlends.find((b) => b.blend_code === resinBlendCode) : null
    const blend =
      blendPreset?.components?.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))?.filter((c) => c.resin_code && Number(c.pct) > 0) || []
    const fallbackResinCode = defaultResinCode

    const colourComponents = colourRows
      .map((r) => ({
        colour_code: (r.colour_code || '').trim(),
        strength_pct: r.strength_pct ? Number(r.strength_pct) : null,
      }))
      .filter((r) => r.colour_code && r.strength_pct != null && Number(r.strength_pct) > 0)

    const additivesList = additiveRows
      .map((r) => ({
        additive_code: (r.additive_code || '').trim(),
        pct: r.pct ? Number(r.pct) : null,
      }))
      .filter((r) => r.additive_code)

    if (quoteUsesMoqOnly && ratebook) {
      const denomInputs: QuickQuoteInputs = {
        override_price_per_kg: null,
        product_type: productType,
        geometry: derivedGeometry,
        base_width_mm: widthMmNum,
        run_up: showRunUp ? runUp : null,
        ufilm_left_width_mm: isUFilm ? ufilmLeftWidthMmNum : null,
        ufilm_right_width_mm: isUFilm ? ufilmRightWidthMmNum : null,
        thickness_um: thicknessUmNum,
        base_length_mm: baseLengthMm,
        continuous_roll: isContinuousLength,
        inline_perforation: flagPerforated,
        inline_seal: flagSealed,
        hole_punched: flagPunched,
        gusset_mm: canHaveGusset && flagGusset ? gussetReturnMmNum : null,
        trim_pct: null,
        resin_blend_code: resinBlendCode,
        print_method: printMethod,
        num_colours: showNumColours ? Number(numColours || 0) : 0,
        finish_mode: finishMode,
        bags_per_carton: finishMode === 'Cartons' ? (bagsPerCarton ? Number(bagsPerCarton) : null) : null,
        core_type: coreType,
        roll_weight_billing: finishMode === 'Rolls' ? rollWeightBilling : null,
        extruder_code: null,
        colour_components: colourComponents,
        additives: additivesList,
        blend,
        resin_code: blend.length === 0 ? fallbackResinCode : null,
        quantity: {},
        nominal_weight_per_roll_kg:
          finishMode === 'Rolls' && Number.isFinite(weightPerRollNum) && weightPerRollNum > 0 ? weightPerRollNum : null,
        qty_entry_type: qtyType,
      }
      const moqKg = resolveBandMoqKgFromQuoteForm({
        widthMmNum,
        ratebook,
        productType,
        flagPrinted,
        printMethod,
        numColours,
        desiredNumColours,
      })
      if (moqKg != null && moqKg > 0) {
        try {
          const denom = computeMaterialsMoqDenomKg(denomInputs, ratebook)
          const syn = synthesizeMoqQuantity({
            moqKg,
            denom,
            qtyType,
            finishMode,
            cartonQtyMode,
            bagsPerCartonNum,
            weightPerRollNum,
            metersPerRollNum,
            isContinuousLength,
            baseLengthMm,
            unitsPerRollNum,
            ratebook,
          })
          if (syn) {
            for (const k of Object.keys(qty)) delete (qty as Record<string, unknown>)[k]
            Object.assign(qty, syn)
          }
        } catch {
          // leave qty from user mode if MOQ synthesis fails
        }
      }
    }

    return {
      product_type: productType,
      geometry: derivedGeometry,
      base_width_mm: widthMmNum,
      run_up: showRunUp ? runUp : null,
      ufilm_left_width_mm: isUFilm ? ufilmLeftWidthMmNum : null,
      ufilm_right_width_mm: isUFilm ? ufilmRightWidthMmNum : null,
      thickness_um: thicknessUmNum,
      continuous_roll: isContinuousLength,
      base_length_mm: baseLengthMm,
      gusset_mm: canHaveGusset && flagGusset ? gussetReturnMmNum : null,
      length_units: effectiveLengthUnits,
      trim_pct: null,
      width_tolerance_mm: null,
      resin_blend_code: resinBlendCode,

      blend,
      // If resin blends aren't loaded (or code not found), fall back to a resin_code
      resin_code: blend.length === 0 ? fallbackResinCode : null,
      colour_components: colourComponents,
      additives: additivesList,

      inline_perforation: flagPerforated,
      inline_seal: flagSealed,
      hole_punched: flagPunched,

      print_method: printMethod,
      num_colours: showNumColours ? Number(numColours || 0) : 0,

      finish_mode: finishMode,
      core_type: coreType,
      roll_weight_billing: finishMode === 'Rolls' ? rollWeightBilling : null,
      bags_per_carton: finishMode === 'Cartons' ? (bagsPerCarton ? Number(bagsPerCarton) : null) : null,
      pallet_type: palletType,

      quantity: qty,
      /**
       * Continuous + total rolls with metres/roll: mass comes from `quantity.total_m` × kg/m — do not pin nominal
       * weight or changing metres will not rebill total kg / kg per roll.
       */
      nominal_weight_per_roll_kg:
        finishMode === 'Rolls' &&
        Number.isFinite(weightPerRollNum) &&
        weightPerRollNum > 0 &&
        !(isContinuousLength && qtyType === 'total_rolls' && numRollsNum > 0 && metersPerRollNum > 0)
          ? weightPerRollNum
          : null,
    }
  }, [
    additiveRows,
    baseLengthMm,
    bagsPerCarton,
    canHaveGusset,
    colourRows,
    coreType,
    defaultResinCode,
    derivedGeometry,
    finishMode,
    flagGusset,
    flagPerforated,
    flagPrinted,
    flagPunched,
    flagSealed,
    gussetReturnMmNum,
    isContinuousLength,
    isUFilm,
    lengthUnits,
    effectiveLengthUnits,
    numColours,
    palletType,
    printMethod,
    numRollsNum,
    numUnitsNum,
    ratebook,
    unitsPerRollNum,
    metersPerRollNum,
    qtyType,
    totalKgNum,
    weightPerRollNum,
    resinBlendCode,
    resinBlends,
    rollWeightBilling,
    showNumColours,
    showRunUp,
    thicknessUmNum,
    productType,
    runUp,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
    quoteUsesMoqOnly,
    cartonQtyMode,
    desiredNumColours,
  ])

  useEffect(() => {
    if (!quoteUsesMoqOnly) return
    const q = calcPayload.quantity as Record<string, number> | undefined
    if (!q || typeof q !== 'object' || Object.keys(q).length === 0) return

    if (qtyType === 'kg') {
      if (q.total_kg != null && Number.isFinite(Number(q.total_kg)) && Number(q.total_kg) > 0) {
        const nextTotalKg = formatKgDisplay(Number(q.total_kg))
        if (totalKg !== nextTotalKg) setTotalKg(nextTotalKg)
      }
      if (finishMode === 'Rolls' && q.rolls != null && Number.isFinite(Number(q.rolls)) && Number(q.rolls) > 0) {
        const nextRolls = String(Math.round(Number(q.rolls)))
        if (numRolls !== nextRolls) setNumRolls(nextRolls)
      }
      return
    }

    if (qtyType === 'units') {
      if (finishMode === 'Cartons' && cartonQtyMode === 'ctn') {
        const bpc = bagsPerCartonNum
        if (q.units != null && Number.isFinite(Number(q.units)) && Number(q.units) > 0 && bpc > 0) {
          const cartons = Math.max(1, Math.round(Number(q.units) / bpc))
          setNumCartons(String(cartons))
        }
        return
      }
      if (q.units != null && Number.isFinite(Number(q.units)) && Number(q.units) > 0) {
        setNumUnits(String(Math.round(Number(q.units))))
      }
      return
    }

    if (qtyType === 'total_rolls') {
      if (!isContinuousLength && q.rolls != null && Number.isFinite(Number(q.rolls)) && Number(q.rolls) > 0) {
        const nextRolls = String(Math.round(Number(q.rolls)))
        if (numRolls !== nextRolls) setNumRolls(nextRolls)
      }
      return
    }

    if (qtyType === 'rolls_units') {
      const rolls = q.rolls != null ? Number(q.rolls) : 0
      const units = q.units != null ? Number(q.units) : 0
      if (rolls > 0) {
        const nextRolls = String(Math.round(rolls))
        if (numRolls !== nextRolls) setNumRolls(nextRolls)
      }
      if (rolls > 0 && units > 0) {
        const nextUnitsPerRoll = String(Math.max(1, Math.round(units / rolls)))
        if (unitsPerRoll !== nextUnitsPerRoll) setUnitsPerRoll(nextUnitsPerRoll)
      }
    }
  }, [
    quoteUsesMoqOnly,
    qtyType,
    finishMode,
    cartonQtyMode,
    bagsPerCartonNum,
    isContinuousLength,
    calcPayload.quantity,
    totalKg,
    numRolls,
    metersPerRoll,
    unitsPerRoll,
  ])

  const liveQuoteProductDescription = useMemo(() => {
    try {
      const spec = buildSpecFromQuotePayload(calcPayload as unknown as QuotePayload)
      return computeProductDescriptionFromSpec(spec).trim()
    } catch {
      return ''
    }
  }, [calcPayload])

  const derivedForDisplay = useMemo(() => {
    if (!ratebook || !calcPayload) return null
    try {
      const inputs: QuickQuoteInputs = {
        ...calcPayload,
        override_price_per_kg:
          suggestedPricePerKg.trim() !== '' && Number.isFinite(Number(suggestedPricePerKg)) && Number(suggestedPricePerKg) > 0
            ? Number(suggestedPricePerKg)
            : null,
      }
      return computeDerivedGeometryAndTotals(inputs, ratebook)
    } catch {
      return null
    }
  }, [ratebook, calcPayload, suggestedPricePerKg])

  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`

  /**
   * Pricing panel “Current override” line: show the rate in the same basis as Qty Type ($/ROLL, $/CTN, …),
   * derived from live preview totals when an override is active.
   */
  const pricingOverrideDisplay = useMemo(() => {
    const raw = suggestedPricePerKg.trim()
    if (raw === '' || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return null
    const ppg = Number(raw)
    const p = quickPreview
    if (!p) return `${fmtDollarsPreview(ppg, 2)}/kg`
    if (qtyMode === 'kg') return `${fmtDollarsPreview(ppg, 2)}/kg`

    const final = Number(p.final_price)
    if (!Number.isFinite(final) || final <= 0) return `${fmtDollarsPreview(ppg, 2)}/kg`

    if (qtyMode === 'roll') {
      const rolls = Number(p.rolls || 0)
      if (rolls > 0) {
        const rate = roundToDecimalPlaces(final / rolls, 2)
        if (Number.isFinite(rate) && rate > 0) return `${fmtDollarsPreview(rate, 2)}/Roll`
      }
    } else if (qtyMode === 'ctn') {
      const cartons = Number(p.cartons || 0)
      if (cartons > 0) {
        const rate = roundToDecimalPlaces(final / cartons, 2)
        if (Number.isFinite(rate) && rate > 0) return `${fmtDollarsPreview(rate, 2)}/CTN`
      }
    } else if (qtyMode === 'units') {
      const totU = Number(p.totals_units || 0)
      if (totU > 0) {
        if (isContinuousLength) {
          const rate = roundToDecimalPlaces(final / totU, 2)
          if (Number.isFinite(rate) && rate > 0) return `${fmtDollarsPreview(rate, 2)}/ea`
        } else {
          const rate = roundToDecimalPlaces(final / (totU / 1000), 2)
          if (Number.isFinite(rate) && rate > 0) return `${fmtDollarsPreview(rate, 2)}/1000`
        }
      }
    }
    return `${fmtDollarsPreview(ppg, 2)}/kg`
  }, [suggestedPricePerKg, quickPreview, qtyMode, isContinuousLength])

  /** Hydrated / user-entered Total KG string (kg mode or quoted snapshot). Prefer over live geometry-derived kg when non–kg qty modes would otherwise overwrite saved totals after reload. */
  const storedTotalKgForDisplay =
    totalKg.trim() !== '' && Number.isFinite(Number(totalKg)) && Number(totalKg) > 0 ? Number(totalKg) : null

  const totalKgDisplay =
    qtyType === 'kg'
      ? totalKgNum
      : qtyType === 'units'
        ? (storedTotalKgForDisplay ?? derivedForDisplay?.derivedTotalKg ?? null)
      : qtyType === 'rolls_units'
        ? (() => {
            const d = derivedForDisplay?.derivedTotalKg
            if (d != null && Number.isFinite(Number(d)) && Number(d) > 0) return Number(d)
            return storedTotalKgForDisplay ?? null
          })()
        : qtyType === 'total_rolls'
          ? isContinuousLength
            ? (() => {
                const d = derivedForDisplay?.derivedTotalKg
                if (d != null && Number.isFinite(Number(d)) && Number(d) > 0) return Number(d)
                return storedTotalKgForDisplay ?? null
              })()
            : storedTotalKgForDisplay ??
              (numRollsNum > 0 && weightPerRollNum > 0 ? numRollsNum * weightPerRollNum : null)
          : null
  const unitsDisplay =
    qtyType === 'units'
      ? numUnitsNum
      : qtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0
        ? numRollsNum * unitsPerRollNum
        : (derivedForDisplay?.units != null ? derivedForDisplay.units : null)
  const rollsDisplay =
    finishMode === 'Rolls'
      ? isContinuousLength && (qtyType === 'units') && numUnitsNum > 0
        ? numUnitsNum
        : qtyType === 'kg' && totalKgNum > 0 && weightPerRollNum > 0
          ? Math.round(totalKgNum / weightPerRollNum)
          : (qtyType === 'units') && derivedForDisplay?.derivedTotalKg != null && weightPerRollNum > 0
            ? Math.round(derivedForDisplay.derivedTotalKg / weightPerRollNum)
            : numRollsNum
      : null

  /**
   * Roll count for syncing Total KG when weight or metres/roll change on continuous web (same idea as Roll qty:
   * explicit rolls, or KG from total÷weight, or total products = one roll per counted unit).
   */
  const continuousRollCountForTotalKgSync = useCallback((): number | null => {
    if (!(isContinuousLength && finishMode === 'Rolls')) return null
    if (qtyMode === 'roll') return numRollsNum > 0 ? numRollsNum : null
    if (qtyMode === 'kg') {
      if (totalKgNum > 0 && weightPerRollNum > 0) {
        const r = Math.round(totalKgNum / weightPerRollNum)
        if (r > 0) return r
      }
      const pr = quickPreview?.rolls != null ? Number(quickPreview.rolls) : NaN
      if (Number.isFinite(pr) && pr > 0) return Math.round(pr)
      if (numRollsNum > 0) return numRollsNum
      return null
    }
    if (qtyMode === 'units') {
      if (numUnitsNum > 0) return numUnitsNum
      if (rollsDisplay != null && Number(rollsDisplay) > 0) return Math.round(Number(rollsDisplay))
      return null
    }
    return null
  }, [
    isContinuousLength,
    finishMode,
    qtyMode,
    numRollsNum,
    totalKgNum,
    weightPerRollNum,
    numUnitsNum,
    quickPreview?.rolls,
    rollsDisplay,
  ])

  const derivedDisplayForQty: DerivedDisplay = derivedForDisplay
    ? {
        derivedTotalKg: derivedForDisplay.derivedTotalKg ?? null,
        units: derivedForDisplay.units ?? null,
        kgPerRoll: derivedForDisplay.kgPerRoll ?? null,
        billedKgPerRoll: derivedForDisplay.billedKgPerRoll ?? null,
      }
    : null
  const weightPerRollDisplay = computeWeightPerRollDisplay(
    qtyType,
    finishMode,
    numRollsNum,
    weightPerRollNum,
    derivedDisplayForQty,
    isContinuousLength && qtyType === 'total_rolls',
  )

  /** Roll count used to derive average products per roll when not in Rolls × per-roll mode. */
  const rollCountForProductsPerRoll =
    finishMode === 'Rolls'
      ? rollsDisplay != null && Number(rollsDisplay) > 0
        ? Number(rollsDisplay)
        : numRollsNum > 0
          ? numRollsNum
          : null
      : numRollsNum > 0
        ? numRollsNum
        : null
  const totalProductsCountForPerRoll =
    qtyType === 'units'
      ? numUnitsNum > 0
        ? numUnitsNum
        : null
      : unitsDisplay != null && Number(unitsDisplay) > 0
        ? Number(unitsDisplay)
        : null
  /**
   * Continuous web on rolls: one counted product per roll (e.g. Tube). Do not depend on derived `units`
   * being populated first — otherwise "Tubes per roll" stays empty in ROLL qty mode.
   */
  const productsPerRollDerived =
    isContinuousLength &&
    finishMode === 'Rolls' &&
    (qtyType === 'total_rolls' || qtyType === 'rolls_units')
      ? 1
      : qtyType === 'rolls_units' ||
          rollCountForProductsPerRoll == null ||
          !(rollCountForProductsPerRoll > 0) ||
          totalProductsCountForPerRoll == null ||
          !(totalProductsCountForPerRoll > 0)
        ? null
        : totalProductsCountForPerRoll / rollCountForProductsPerRoll

  /** Non–continuous length: show meters/roll from preview/derived geometry (read-only). */
  const metersPerRollCalculatedText = useMemo(() => {
    if (isContinuousLength) return ''
    const fromPreview =
      quickPreview?.m_per_roll != null && Number.isFinite(Number(quickPreview.m_per_roll)) ? Number(quickPreview.m_per_roll) : null
    const fromDerived =
      derivedForDisplay?.mPerRoll != null && Number.isFinite(Number(derivedForDisplay.mPerRoll))
        ? Number(derivedForDisplay.mPerRoll)
        : null
    const m = fromPreview != null && fromPreview > 0 ? fromPreview : fromDerived != null && fromDerived > 0 ? fromDerived : null
    return m != null ? fmtQtyNumber(m, 2) : ''
  }, [isContinuousLength, quickPreview?.m_per_roll, derivedForDisplay?.mPerRoll])

  const totalKgEditable = qtyType === 'kg'
  const unitsEditable = qtyType === 'units'
  const rollsEditable = finishMode === 'Rolls' && (qtyType === 'total_rolls' || qtyType === 'rolls_units')
  const weightPerRollEditable =
    finishMode === 'Rolls' &&
    (qtyType === 'units' || qtyType === 'kg' || (qtyType === 'total_rolls' && !isContinuousLength))

  // Only show computed value when the inputs that drive it are set; otherwise keep showing the field's stored value (so changing Qty Type doesn't wipe the display).
  const haveDriverForTotalKg =
    ((qtyType === 'units') && numUnitsNum > 0) ||
    (qtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) ||
    (qtyType === 'total_rolls' && numRollsNum > 0 && (isContinuousLength ? metersPerRollNum > 0 : weightPerRollNum > 0))
  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    (numRollsNum > 0 || (isContinuousLength && (qtyType === 'units') && numUnitsNum > 0)) &&
    ((qtyType === 'kg' && totalKgNum > 0) ||
      ((qtyType === 'units') && numUnitsNum > 0) ||
      (qtyType === 'rolls_units' && unitsPerRollNum > 0) ||
      (qtyType === 'total_rolls' && isContinuousLength && metersPerRollNum > 0))

  const qtyTypeTransitionSnapshot = useMemo(() => {
    let totalKgFromUi: number | null = null
    if (totalKgEditable) {
      if (totalKg.trim() !== '' && Number.isFinite(totalKgNum) && totalKgNum > 0) totalKgFromUi = totalKgNum
    } else if (haveDriverForTotalKg && totalKgDisplay != null && Number.isFinite(Number(totalKgDisplay)) && Number(totalKgDisplay) > 0) {
      totalKgFromUi = Number(totalKgDisplay)
    } else if (totalKg.trim() !== '' && Number.isFinite(totalKgNum) && totalKgNum > 0) {
      totalKgFromUi = totalKgNum
    }

    let weightPerRollFromUi: number | null = null
    if (weightPerRollEditable) {
      if (weightPerRollNum > 0) weightPerRollFromUi = weightPerRollNum
    } else if (
      weightPerRollDisplay != null &&
      Number.isFinite(Number(weightPerRollDisplay)) &&
      Number(weightPerRollDisplay) > 0
    ) {
      weightPerRollFromUi = Number(weightPerRollDisplay)
    } else if (weightPerRollNum > 0) {
      weightPerRollFromUi = weightPerRollNum
    }

    let rollsFromUi: number | null = null
    if (finishMode === 'Rolls') {
      if (rollsEditable && numRollsNum > 0) rollsFromUi = numRollsNum
      else if (rollsDisplay != null && Number.isFinite(Number(rollsDisplay)) && Number(rollsDisplay) > 0) {
        rollsFromUi = Math.round(Number(rollsDisplay))
      } else if (qtyType === 'kg') {
        // KG + MOQ (or priced kg) often has `quantity.rolls` / preview rolls while `rollsDisplay` is empty
        // because it required weight/roll to infer roll count from total kg.
        const q = calcPayload?.quantity as Record<string, unknown> | undefined
        const qr = q?.rolls != null ? Number(q.rolls) : NaN
        if (Number.isFinite(qr) && qr > 0) rollsFromUi = Math.round(qr)
        else if (quickPreview?.rolls != null && Number(quickPreview.rolls) > 0) {
          rollsFromUi = Math.round(Number(quickPreview.rolls))
        }
      } else if (numRollsNum > 0) rollsFromUi = numRollsNum
    }

    let unitsFromUi: number | null = null
    if (unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')) {
      if (numUnitsNum > 0) unitsFromUi = numUnitsNum
    } else if (unitsDisplay != null && Number.isFinite(Number(unitsDisplay)) && Number(unitsDisplay) > 0) {
      unitsFromUi = Math.round(Number(unitsDisplay))
    } else if (numUnitsNum > 0) {
      unitsFromUi = numUnitsNum
    }

    let cartonsFromUi: number | null = null
    if (finishMode === 'Cartons' && cartonQtyMode === 'ctn' && numCartonsNum > 0) cartonsFromUi = numCartonsNum

    let unitsPerRollFromUi: number | null = null
    if (qtyType === 'rolls_units' && unitsPerRollNum > 0) unitsPerRollFromUi = unitsPerRollNum
    else if (
      productsPerRollDerived != null &&
      Number.isFinite(Number(productsPerRollDerived)) &&
      Number(productsPerRollDerived) > 0
    ) {
      unitsPerRollFromUi = Math.max(0, Math.floor(Number(productsPerRollDerived)))
    }

    let metersPerRollFromUi: number | null = null
    if (isContinuousLength) {
      if (metersPerRollNum > 0) metersPerRollFromUi = metersPerRollNum
    } else if (metersPerRollCalculatedText.trim() !== '') {
      const m = Number(metersPerRollCalculatedText)
      if (Number.isFinite(m) && m > 0) metersPerRollFromUi = m
    }

    return {
      totalKgFromUi,
      weightPerRollFromUi,
      rollsFromUi,
      unitsFromUi,
      cartonsFromUi,
      unitsPerRollFromUi,
      metersPerRollFromUi,
    }
  }, [
    totalKgEditable,
    totalKg,
    totalKgNum,
    haveDriverForTotalKg,
    totalKgDisplay,
    weightPerRollEditable,
    weightPerRollNum,
    weightPerRollDisplay,
    finishMode,
    rollsEditable,
    numRollsNum,
    rollsDisplay,
    unitsEditable,
    qtyMode,
    numUnitsNum,
    unitsDisplay,
    cartonQtyMode,
    numCartonsNum,
    qtyType,
    unitsPerRollNum,
    productsPerRollDerived,
    isContinuousLength,
    metersPerRollNum,
    metersPerRollCalculatedText,
    calcPayload.quantity,
    quickPreview?.rolls,
  ])
  qtyTypeCarrySnapRef.current = qtyTypeTransitionSnapshot

  const applyQuantityCarryForNewQtyType = useCallback((nextQtyType: QtyType, nextCartonQtyMode?: '1000' | 'ctn') => {
    const snap = qtyTypeCarrySnapRef.current

    let rollsCarry = snap.rollsFromUi != null && snap.rollsFromUi > 0 ? snap.rollsFromUi : null
    let totalKgCarry = snap.totalKgFromUi != null && snap.totalKgFromUi > 0 ? snap.totalKgFromUi : null

    if (finishMode === 'Rolls' && !(rollsCarry != null && rollsCarry > 0)) {
      const q = calcPayload?.quantity as Record<string, unknown> | undefined
      const qr = q?.rolls != null ? Number(q.rolls) : NaN
      if (Number.isFinite(qr) && qr > 0) rollsCarry = Math.round(qr)
      else if (quickPreview?.rolls != null && Number(quickPreview.rolls) > 0) {
        rollsCarry = Math.round(Number(quickPreview.rolls))
      }
    }

    if (!(totalKgCarry != null && totalKgCarry > 0) && derivedForDisplay?.derivedTotalKg != null) {
      const d = Number(derivedForDisplay.derivedTotalKg)
      if (Number.isFinite(d) && d > 0) totalKgCarry = d
    }

    const impliedJobKgPerRoll =
      rollsCarry != null &&
      rollsCarry > 0 &&
      totalKgCarry != null &&
      totalKgCarry > 0 &&
      Number.isFinite(totalKgCarry / rollsCarry)
        ? totalKgCarry / rollsCarry
        : null

    const wprStored = parsePositiveKgLoose(weightPerRoll)
    /** For ROLL modes: job kg ÷ rolls, else explicit typed weight — never conversion `kgPerRoll` (~avg roll). */
    const rollWeightToApply =
      nextQtyType === 'total_rolls' || nextQtyType === 'rolls_units'
        ? impliedJobKgPerRoll != null && impliedJobKgPerRoll > 0
          ? impliedJobKgPerRoll
          : wprStored != null && wprStored > 0
            ? wprStored
            : null
        : null

    if (nextQtyType === 'kg') {
      if (snap.totalKgFromUi != null && snap.totalKgFromUi > 0) setTotalKg(formatKgDisplay(snap.totalKgFromUi))
      if (finishMode === 'Rolls' && snap.weightPerRollFromUi != null && snap.weightPerRollFromUi > 0) {
        setWeightPerRoll(formatKgDisplay(snap.weightPerRollFromUi))
      }
      return
    }

    if (nextQtyType === 'units') {
      if (finishMode === 'Cartons' && nextCartonQtyMode === 'ctn') {
        if (snap.cartonsFromUi != null && snap.cartonsFromUi > 0) setNumCartons(String(snap.cartonsFromUi))
        return
      }
      if (snap.unitsFromUi != null && snap.unitsFromUi > 0) setNumUnits(String(snap.unitsFromUi))
      if (finishMode === 'Rolls' && snap.weightPerRollFromUi != null && snap.weightPerRollFromUi > 0) {
        setWeightPerRoll(formatKgDisplay(snap.weightPerRollFromUi))
      }
      return
    }

    if (nextQtyType === 'total_rolls') {
      if (rollsCarry != null && rollsCarry > 0) setNumRolls(String(rollsCarry))
      if (isContinuousLength) {
        if (snap.metersPerRollFromUi != null && snap.metersPerRollFromUi > 0) {
          setMetersPerRoll(String(snap.metersPerRollFromUi))
        }
        if (rollWeightToApply != null) setWeightPerRoll(formatKgDisplay(rollWeightToApply))
      } else if (rollWeightToApply != null) {
        setWeightPerRoll(formatKgDisplay(rollWeightToApply))
      }
      return
    }

    if (nextQtyType === 'rolls_units') {
      if (rollsCarry != null && rollsCarry > 0) setNumRolls(String(rollsCarry))
      if (snap.unitsPerRollFromUi != null && snap.unitsPerRollFromUi > 0) {
        setUnitsPerRoll(String(Math.max(1, Math.round(snap.unitsPerRollFromUi))))
      }
      if (isContinuousLength) {
        if (snap.metersPerRollFromUi != null && snap.metersPerRollFromUi > 0) {
          setMetersPerRoll(String(snap.metersPerRollFromUi))
        }
        if (rollWeightToApply != null) setWeightPerRoll(formatKgDisplay(rollWeightToApply))
      } else if (rollWeightToApply != null) {
        setWeightPerRoll(formatKgDisplay(rollWeightToApply))
      }
    }
  }, [finishMode, isContinuousLength, calcPayload, quickPreview, derivedForDisplay, weightPerRoll])

  // Keep quantity fields populated when switching qty type; only backfill empties.
  // We intentionally do not clear `totalKg` when other drivers (e.g. `numUnits` from CTN sync) change
  // while not in kg mode: that was wiping the stored value when switching Qty Type away and back (KG ↔ CTN).
  useEffect(() => {
    if (qtyType === 'kg') {
      // Only backfill from derived totals when positive; empty + derived 0 would otherwise become "0.00" (masks failed hydrate).
      if (
        (totalKg == null || String(totalKg).trim() === '') &&
        totalKgDisplay != null &&
        Number.isFinite(Number(totalKgDisplay)) &&
        Number(totalKgDisplay) > 0
      ) {
        setTotalKg(formatKgDisplay(Number(totalKgDisplay)))
      }
      return
    }
    if (qtyType === 'units') {
      if ((numUnits == null || String(numUnits).trim() === '') && unitsDisplay != null && Number.isFinite(Number(unitsDisplay))) {
        setNumUnits(String(Math.round(Number(unitsDisplay))))
      }
      return
    }
    if (qtyType === 'rolls_units') {
      if ((numRolls == null || String(numRolls).trim() === '') && rollsDisplay != null && Number.isFinite(Number(rollsDisplay))) {
        setNumRolls(String(Math.max(0, Math.round(Number(rollsDisplay)))))
      }
      if (
        (unitsPerRoll == null || String(unitsPerRoll).trim() === '') &&
        productsPerRollDerived != null &&
        Number.isFinite(Number(productsPerRollDerived))
      ) {
        setUnitsPerRoll(String(Math.max(0, Math.floor(Number(productsPerRollDerived)))))
      }
      return
    }
    if (qtyType === 'total_rolls') {
      if ((numRolls == null || String(numRolls).trim() === '') && rollsDisplay != null && Number.isFinite(Number(rollsDisplay))) {
        setNumRolls(String(Math.max(0, Math.round(Number(rollsDisplay)))))
      }
      if (isContinuousLength) {
        if ((metersPerRoll == null || String(metersPerRoll).trim() === '') && numRollsNum > 0 && Number(totalKgDisplay || 0) > 0) {
          const totalM = Number(calcPayload?.quantity?.total_m || 0)
          if (Number.isFinite(totalM) && totalM > 0) {
            setMetersPerRoll(formatKgDisplay(totalM / numRollsNum))
          }
        }
      } else if (
        (weightPerRoll == null || String(weightPerRoll).trim() === '') &&
        weightPerRollDisplay != null &&
        Number.isFinite(Number(weightPerRollDisplay))
      ) {
        setWeightPerRoll(formatKgDisplay(Number(weightPerRollDisplay)))
      }
    }
  }, [
    qtyType,
    totalKg,
    numUnits,
    numRolls,
    unitsPerRoll,
    metersPerRoll,
    weightPerRoll,
    isContinuousLength,
    numRollsNum,
    totalKgDisplay,
    unitsDisplay,
    rollsDisplay,
    productsPerRollDerived,
    weightPerRollDisplay,
    calcPayload?.quantity?.total_m,
  ])

  // Keep No. of units state in sync when it's computed (Total KG or Total Rolls mode), so switching to Units/Bags shows the value that was displayed instead of clearing it.
  // Continuous length on Rolls: total products = roll count from the calculator.
  useEffect(() => {
    if (qtyType === 'units' || qtyType === 'rolls_units') return
    if (derivedForDisplay?.units == null) return
    const fromKgOrRollsMode =
      (qtyType === 'kg' && totalKgNum > 0) ||
      (qtyType === 'total_rolls' && numRollsNum > 0 && (isContinuousLength ? metersPerRollNum > 0 : weightPerRollNum > 0))
    const fromContinuousRolls =
      isContinuousLength &&
      finishMode === 'Rolls' &&
      derivedForDisplay.rolls != null &&
      Number(derivedForDisplay.rolls) > 0
    if (!(fromKgOrRollsMode || fromContinuousRolls)) return
    const computed = Math.round(Number(derivedForDisplay.units))
    setNumUnits(Number.isFinite(computed) && computed >= 0 ? String(computed) : '')
  }, [
    qtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    metersPerRollNum,
    finishMode,
    isContinuousLength,
    derivedForDisplay?.units,
    derivedForDisplay?.rolls,
  ])

  // Rolls × per roll: infer job kg/roll from billed total ÷ rolls when empty.
  // For continuous total rolls, keep weight as derived display-only to avoid state feedback loops with MOQ synthesis.
  useEffect(() => {
    if (qtyType !== 'rolls_units') return
    const wpr = parsePositiveKgLoose(weightPerRoll)
    if (wpr != null && wpr > 0) return
    const rolls = numRollsNum
    const dkg = derivedForDisplay?.derivedTotalKg
    if (!(rolls > 0 && dkg != null && Number(dkg) > 0)) return
    const implied = Number(dkg) / rolls
    if (!(Number.isFinite(implied) && implied > 0)) return
    const next = roundTo2Decimals(String(implied))
    if (String(weightPerRoll).trim() === next) return
    setWeightPerRoll(next)
  }, [qtyType, weightPerRoll, numRollsNum, derivedForDisplay?.derivedTotalKg])

  const layflatWidthMm = useMemo(() => {
    try {
      return computeLayflatWidthMm({
        product_type: productType,
        geometry: derivedGeometry,
        base_width_mm: widthMmNum,
        run_up: showRunUp ? runUp : null,
        gusset_mm: canHaveGusset && flagGusset ? gussetReturnMmNum : null,
        ufilm_left_width_mm: isUFilm ? ufilmLeftWidthMmNum : null,
        ufilm_right_width_mm: isUFilm ? ufilmRightWidthMmNum : null,
      })
    } catch {
      return 0
    }
  }, [canHaveGusset, derivedGeometry, flagGusset, gussetReturnMmNum, isUFilm, productType, runUp, showRunUp, ufilmLeftWidthMmNum, ufilmRightWidthMmNum, widthMmNum])

  const extruderDecisionWidthMm = useMemo(() => {
    // For U-Film, use the middle width as the "decision width" (per SpecPayloadForm behavior).
    return isUFilm ? widthMmNum : layflatWidthMm
  }, [isUFilm, layflatWidthMm, widthMmNum])

  const selectedExtruder = useMemo(() => {
    const extruders = Array.isArray(ratebook?.extruders) ? ratebook!.extruders : []
    if (!extruders.length || !(extruderDecisionWidthMm > 0)) return { extruder: null as any, helperText: '' }

    const usable = extruders
      .filter((e) => e && typeof e.decision_width_mm === 'number' && Number.isFinite(e.decision_width_mm))
      .map((e) => ({ ...e, decision_width_mm: Number(e.decision_width_mm) }))
      .sort((a, b) => (a.decision_width_mm! - b.decision_width_mm!) || String(a.extruder_code).localeCompare(String(b.extruder_code)))

    const widthLabel = isUFilm ? 'middle width' : 'layflat'
    const firstFit = usable.find((e) => (e.decision_width_mm ?? 0) >= extruderDecisionWidthMm) || null
    if (firstFit) return { extruder: firstFit, helperText: `Auto-selected for ${widthLabel} ${Math.round(extruderDecisionWidthMm)}mm.` }

    const fallback = usable.length ? usable[usable.length - 1] : null
    return {
      extruder: fallback,
      helperText: fallback
        ? `No extruder can handle ${widthLabel} ${Math.round(extruderDecisionWidthMm)}mm (showing largest available).`
        : 'No extruders available.',
    }
  }, [extruderDecisionWidthMm, isUFilm, ratebook])

  const calcInputs: QuickQuoteInputs = useMemo(
    () => ({
      override_price_per_kg:
        suggestedPricePerKg.trim() !== '' && Number.isFinite(Number(suggestedPricePerKg)) && Number(suggestedPricePerKg) > 0
          ? Number(suggestedPricePerKg)
          : null,
      product_type: calcPayload.product_type,
      geometry: calcPayload.geometry,
      base_width_mm: Number(calcPayload.base_width_mm || 0),
      run_up: calcPayload.run_up != null ? Number(calcPayload.run_up) : null,
      ufilm_left_width_mm: calcPayload.ufilm_left_width_mm != null ? Number(calcPayload.ufilm_left_width_mm) : null,
      ufilm_right_width_mm: calcPayload.ufilm_right_width_mm != null ? Number(calcPayload.ufilm_right_width_mm) : null,
      thickness_um: Number(calcPayload.thickness_um || 0),
      base_length_mm: Number(calcPayload.base_length_mm || 0),
      continuous_roll: !!calcPayload.continuous_roll,
      inline_perforation: !!calcPayload.inline_perforation,
      inline_seal: !!calcPayload.inline_seal,
      hole_punched: !!calcPayload.hole_punched,
      gusset_mm: calcPayload.gusset_mm != null ? Number(calcPayload.gusset_mm) : null,
      trim_pct: calcPayload.trim_pct != null ? Number(calcPayload.trim_pct) : null,
      resin_blend_code: calcPayload.resin_blend_code != null ? String(calcPayload.resin_blend_code) : null,
      print_method: calcPayload.print_method,
      num_colours: Number(calcPayload.num_colours || 0),
      finish_mode: calcPayload.finish_mode,
      bags_per_carton: calcPayload.bags_per_carton != null ? Number(calcPayload.bags_per_carton) : null,
      core_type: calcPayload.core_type,
      roll_weight_billing: calcPayload.roll_weight_billing != null ? calcPayload.roll_weight_billing : null,
      extruder_code: selectedExtruder.extruder?.extruder_code || null,
      colour_components: calcPayload.colour_components,
      additives: calcPayload.additives,
      blend: calcPayload.blend,
      resin_code: calcPayload.resin_code,
      quantity: calcPayload.quantity || {},
      nominal_weight_per_roll_kg:
        (calcPayload as { nominal_weight_per_roll_kg?: number | null }).nominal_weight_per_roll_kg ?? null,
      qty_entry_type: qtyType,
    }),
    [calcPayload, suggestedPricePerKg, selectedExtruder.extruder?.extruder_code, qtyType],
  )

  /** Full form state for persisting; used to re-hydrate on edit. */
  const payloadForSave = useMemo(
    () => ({
      ...calcPayload,
      quote_uses_moq_only: quoteUsesMoqOnly,
      qtyType,
      length,
      lengthUnits,
      numUnits,
      numCartons,
      cartonQtyMode,
      unitsPerRoll,
      metersPerRoll,
      numRolls,
      totalKg,
      weightPerRoll,
      colourRows,
      additiveRows,
      resinBlendCode,
      coreType,
      rollWeightBilling,
      bagsPerCarton,
      palletType,
      flagPerforated,
      flagSealed,
      flagPunched,
      desiredNumColours: desiredNumColours || numColours,
      showNumColours: flagPrinted,
      quoted_totals_kg:
        quickPreview?.totals_kg != null && Number.isFinite(Number(quickPreview.totals_kg))
          ? Number(quickPreview.totals_kg)
          : null,
      quoted_total_price:
        quickPreview?.final_price != null && Number.isFinite(Number(quickPreview.final_price))
          ? Number(quickPreview.final_price)
          : null,
      notes: quoteNotes,
      ...(convertedOrderId?.trim() ? { converted_order_id: convertedOrderId.trim() } : {}),
    }),
    [
      calcPayload,
      quoteNotes,
      convertedOrderId,
      qtyType,
      length,
      lengthUnits,
      numUnits,
      numCartons,
      cartonQtyMode,
      unitsPerRoll,
      metersPerRoll,
      numRolls,
      totalKg,
      weightPerRoll,
      colourRows,
      additiveRows,
      resinBlendCode,
      coreType,
      rollWeightBilling,
      bagsPerCarton,
      palletType,
      flagPerforated,
      flagSealed,
      flagPunched,
      desiredNumColours,
      numColours,
      flagPrinted,
      quickPreview?.totals_kg,
      quickPreview?.final_price,
      quoteUsesMoqOnly,
    ],
  )

  // For edit-mode "did user edit the spec?" we exclude pricing snapshots so rate recalculations don't look like a spec edit.
  const payloadForEditDetection = useMemo(() => {
    const {
      quoted_totals_kg: _qtk,
      quoted_total_price: _qtp,
      converted_order_id: _co,
      ...rest
    } = payloadForSave as {
      quoted_totals_kg?: unknown
      quoted_total_price?: unknown
      converted_order_id?: unknown
      [k: string]: unknown
    }
    return rest
  }, [payloadForSave])
  payloadForEditDetectionRef.current = payloadForEditDetection

  // Edit mode: capture payload snapshot for edit-detection only after pricing inputs are available and defaults
  // (resin blend list, etc.) have settled. Otherwise a full tab refresh can normalize the form after the
  // first snapshot and falsely clear `preserveLoadedPricePerKgRef`, losing the saved price/kg adjustment.
  useEffect(() => {
    if (!isEditMode || !hydratedFromQuote) return
    if (!ratebook || quoteRatebookState.status !== 'succeeded') return
    if (quoteResinBlendsState.status === 'loading') return
    if (editPayloadBaselineCapturedRef.current) return

    const t = window.setTimeout(() => {
      if (editPayloadBaselineCapturedRef.current) return
      initialPayloadSnapshotRef.current = JSON.stringify(payloadForEditDetectionRef.current)
      editPayloadBaselineCapturedRef.current = true
    }, 0)
    return () => window.clearTimeout(t)
  }, [
    isEditMode,
    hydratedFromQuote,
    ratebook,
    quoteRatebookState.status,
    quoteResinBlendsState.status,
    resinBlendCode,
  ])

  // Edit mode: when user edits the form spec, clear the "preserve loaded price/kg" guard so recalculated retail can update the override field.
  useEffect(() => {
    if (
      isEditMode &&
      hydratedFromQuote &&
      initialPayloadSnapshotRef.current != null &&
      JSON.stringify(payloadForEditDetection) !== initialPayloadSnapshotRef.current
    ) {
      preserveLoadedPricePerKgRef.current = false
      initialPayloadSnapshotRef.current = null
    }
  }, [isEditMode, hydratedFromQuote, payloadForEditDetection])

  const printingErrorComputed: string | null = useMemo(() => {
    if (!ratebook) return null
    if (!flagPrinted || printMethod === 'None') return null
    const desired = Number(numColours || desiredNumColours || 0)
    if (!Number.isFinite(desired) || desired < 1) return null
    const inputsForPrint: QuickQuoteInputs = {
      ...calcInputs,
      print_method: printMethod,
      num_colours: desired,
    }
    return computePrintingUnavailableReason(inputsForPrint, ratebook)
  }, [calcInputs, desiredNumColours, flagPrinted, numColours, printMethod, ratebook])

  const materialsMoqPanelLine = useMemo(() => {
    if (!(widthMmNum > 0) || !ratebook) return null
    if (quickPreview?.materials_moq_summary_line) return quickPreview.materials_moq_summary_line
    if (!mapProductTypeToMaterialsRetailGroup(productType)) {
      return 'This product type does not use width-based material minimum order quantities.'
    }
    const res = resolveMaterialsRetailBand(ratebook, productType, widthMmNum)
    if (!res.band) return 'No materials retail bands are configured for this product type.'
    const hasPrintingSelection = flagPrinted && printMethod !== 'None' && Number(numColours || desiredNumColours || 0) > 0
    const plain = res.band.moq_plain_kg != null ? Number(res.band.moq_plain_kg) : null
    const printed = res.band.moq_printed_kg != null ? Number(res.band.moq_printed_kg) : null
    const plainOk = plain != null && Number.isFinite(plain) && plain > 0
    const printedOk = printed != null && Number.isFinite(printed) && printed > 0
    if (hasPrintingSelection) {
      if (printedOk && printed != null) return `Minimum order quantity (printed): ${printed.toFixed(2)}kg`
      if (plainOk && plain != null) return `Minimum order quantity (plain): ${plain.toFixed(2)}kg`
      return 'No minimum order quantity is set for the band used for this width.'
    }
    if (plainOk && plain != null) return `Minimum order quantity (plain): ${plain.toFixed(2)}kg`
    if (printedOk && printed != null) return `Minimum order quantity (printed): ${printed.toFixed(2)}kg`
    return 'No minimum order quantity is set for the band used for this width.'
  }, [widthMmNum, ratebook, quickPreview, productType, flagPrinted, printMethod, numColours, desiredNumColours])

  const materialsMoqDenomKg = useMemo(() => {
    if (!(widthMmNum > 0) || !ratebook) return null
    try {
      return computeMaterialsMoqDenomKg(calcInputs, ratebook)
    } catch {
      return null
    }
  }, [widthMmNum, ratebook, calcInputs])

  /** Single-row email table: description, MOQ, and price — price column title reflects Qty Type (per kg / 1000 / roll / carton). */
  const emailQuoteTable = useMemo(() => {
    const base = (liveQuoteProductDescription || '—').replace(/\|/g, '·').replace(/\r?\n/g, ' ').trim()
    const hasProductLine = Boolean((liveQuoteProductDescription || '').trim())
    let desc = base
    if (hasProductLine) {
      const tail = quotePackagingPerUnitTail({
        finishMode,
        productType,
        bagsPerCarton: bagsPerCartonNum,
        isContinuousLength,
        metersPerRoll: metersPerRollNum,
        weightPerRollKg: weightPerRollNum,
        quantityTotalM: Number(calcPayload?.quantity?.total_m ?? 0),
        quantityRolls: Number(calcPayload?.quantity?.rolls ?? numRollsNum ?? 0),
      })
      desc = joinQuoteDescriptionWithPackagingTail(base, tail)
    }
    const priceHeader =
      qtyMode === 'kg'
        ? '$/kg'
        : qtyMode === 'units'
          ? isContinuousLength
            ? '$/ea'
            : '$/1000'
          : qtyMode === 'roll'
            ? '$/ROLL'
            : '$/CTN'
    const p = quickPreview
    if (!p || !Number.isFinite(Number(p.final_price))) {
      return {
        description: desc,
        minOrder: '—',
        price: '—',
        priceHeader,
        middleColumnHeader: 'Min QTY' as const,
        total: null as string | null,
        unitRateNumber: null as number | null,
      }
    }
    const final = Number(p.final_price)
    const totKg = Number(p.totals_kg || 0)
    const totU = Number(p.totals_units || 0)
    const rolls = Number(p.rolls || 0)
    const cartons = Number(p.cartons || 0)

    let moqKg: number | null = null
    if (widthMmNum > 0 && ratebook && mapProductTypeToMaterialsRetailGroup(productType)) {
      const res = resolveMaterialsRetailBand(ratebook, productType, widthMmNum)
      if (res.band) {
        const hasPrinting =
          flagPrinted && printMethod !== 'None' && Number(numColours || desiredNumColours || 0) > 0
        const plain = res.band.moq_plain_kg != null ? Number(res.band.moq_plain_kg) : null
        const printed = res.band.moq_printed_kg != null ? Number(res.band.moq_printed_kg) : null
        const plainOk = plain != null && Number.isFinite(plain) && plain > 0
        const printedOk = printed != null && Number.isFinite(printed) && printed > 0
        if (hasPrinting) {
          moqKg = printedOk && printed != null ? printed : plainOk && plain != null ? plain : null
        } else {
          moqKg = plainOk && plain != null ? plain : printedOk && printed != null ? printed : null
        }
      }
    }

    const denom = materialsMoqDenomKg
    let kgPerRoll: number | null = null
    if (p.kg_per_roll != null && Number(p.kg_per_roll) > 0) kgPerRoll = Number(p.kg_per_roll)
    if (kgPerRoll == null && denom?.kgPerRoll != null && denom.kgPerRoll > 0) kgPerRoll = denom.kgPerRoll
    if (kgPerRoll == null && finishMode === 'Rolls' && weightPerRollNum > 0) kgPerRoll = weightPerRollNum
    if (kgPerRoll == null && finishMode === 'Rolls' && getRollWeightAvgKg(ratebook) > 0) kgPerRoll = getRollWeightAvgKg(ratebook)
    if (kgPerRoll == null && totKg > 0 && rolls > 0) kgPerRoll = totKg / rolls

    let kgPerUnit: number | null = null
    if (totKg > 0 && totU > 0) kgPerUnit = totKg / totU
    if (kgPerUnit == null && denom?.kgPerProduct != null && denom.kgPerProduct > 0) kgPerUnit = denom.kgPerProduct

    let kgPerCarton: number | null = null
    if (totKg > 0 && cartons > 0) kgPerCarton = totKg / cartons
    if (kgPerCarton == null && denom?.kgPerCarton != null && denom.kgPerCarton > 0) kgPerCarton = denom.kgPerCarton

    let minOrder = '—'
    if (moqKg != null && moqKg > 0) {
      if (qtyMode === 'kg') {
        minOrder = `${fmtQtyNumber(moqKg, 2)}kg`
      } else if (qtyMode === 'units' && kgPerUnit != null && kgPerUnit > 0) {
        const minProducts = moqDiscreteProductCountCoveringMoq(moqKg, kgPerUnit)
        minOrder = `${fmtCount(minProducts)} ${productUnitLabel.toLowerCase()}`
      } else if (qtyMode === 'roll' && finishMode === 'Rolls' && kgPerRoll != null && kgPerRoll > 0) {
        minOrder = `${fmtCount(Math.ceil(moqKg / kgPerRoll))} ROLL`
      } else if (qtyMode === 'ctn' && finishMode === 'Cartons' && kgPerCarton != null && kgPerCarton > 0) {
        minOrder = `${fmtCount(Math.ceil(moqKg / kgPerCarton))} CTN`
      } else {
        minOrder = `${fmtQtyNumber(moqKg, 2)}kg`
      }
    }

    let price = '—'
    if (qtyMode === 'kg' && p.price_per_kg != null && Number(p.price_per_kg) > 0) {
      price = fmtDollarsPreview(p.price_per_kg, 2)
    } else if (qtyMode === 'units' && totU > 0) {
      if (isContinuousLength) {
        const perEa = final / totU
        if (Number.isFinite(perEa)) price = fmtDollarsPreview(perEa, 2)
      } else {
        const per1000 = final / (totU / 1000)
        if (Number.isFinite(per1000)) price = fmtDollarsPreview(per1000, 2)
      }
    } else if (qtyMode === 'roll' && rolls > 0) {
      const pr = roundToDecimalPlaces(final / rolls, 2)
      if (Number.isFinite(pr) && pr > 0) price = fmtDollarsPreview(pr, 2)
    } else if (qtyMode === 'ctn' && cartons > 0) {
      const pr = final / cartons
      if (Number.isFinite(pr)) price = fmtDollarsPreview(pr, 2)
    }

    let rateNum: number | null = null
    if (qtyMode === 'kg' && p.price_per_kg != null && Number(p.price_per_kg) > 0) {
      rateNum = Number(p.price_per_kg)
    } else if (qtyMode === 'units' && totU > 0) {
      if (isContinuousLength) {
        const perEa = final / totU
        if (Number.isFinite(perEa)) rateNum = perEa
      } else {
        const per1000 = final / (totU / 1000)
        if (Number.isFinite(per1000)) rateNum = per1000
      }
    } else if (qtyMode === 'roll' && rolls > 0) {
      const pr = roundToDecimalPlaces(final / rolls, 2)
      if (Number.isFinite(pr) && pr > 0) rateNum = pr
    } else if (qtyMode === 'ctn' && cartons > 0) {
      const pr = final / cartons
      if (Number.isFinite(pr)) rateNum = pr
    }

    if (!quoteUsesMoqOnly) {
      let qtyFactor: number | null = null
      let jobQtyStr = '—'
      if (qtyMode === 'kg' && totKg > 0) {
        qtyFactor = totKg
        jobQtyStr = `${fmtQtyNumber(totKg, 2)}kg`
      } else if (qtyMode === 'units' && totU > 0) {
        if (isContinuousLength) {
          qtyFactor = totU
          jobQtyStr = `${fmtCount(Math.round(totU))} ea`
        } else {
          qtyFactor = totU / 1000
          jobQtyStr = `${fmtCount(Math.round(totU))} ${productUnitLabel.toLowerCase()}`
        }
      } else if (qtyMode === 'roll' && rolls > 0) {
        qtyFactor = rolls
        jobQtyStr = `${fmtCount(rolls)} ROLL`
      } else if (qtyMode === 'ctn' && cartons > 0) {
        qtyFactor = cartons
        jobQtyStr = `${fmtCount(cartons)} CTN`
      }
      const totalStr =
        rateNum != null && qtyFactor != null && qtyFactor > 0 && Number.isFinite(rateNum)
          ? fmtDollarsPreview(roundMoneyCents(rateNum * qtyFactor), 2)
          : '—'
      return {
        description: desc,
        minOrder: jobQtyStr,
        price,
        priceHeader,
        middleColumnHeader: 'QTY' as const,
        total: totalStr,
        unitRateNumber: rateNum,
      }
    }

    return {
      description: desc,
      minOrder,
      price,
      priceHeader,
      middleColumnHeader: 'Min QTY' as const,
      total: null,
      unitRateNumber: rateNum,
    }
  }, [
    liveQuoteProductDescription,
    quickPreview,
    widthMmNum,
    ratebook,
    productType,
    flagPrinted,
    printMethod,
    numColours,
    desiredNumColours,
    materialsMoqDenomKg,
    finishMode,
    weightPerRollNum,
    productUnitLabel,
    qtyMode,
    bagsPerCartonNum,
    isContinuousLength,
    metersPerRollNum,
    quoteUsesMoqOnly,
    calcPayload,
    numRollsNum,
  ])

  /** Rate basis for the locked job price (same logic as the copyable quote price), for the Live Quote Adjustments row. */
  const adjustmentsLockedRateLabel = useMemo(() => {
    const p = quickPreview
    if (!p?.price_override_active) return null
    const final = Number(p.final_price)
    if (!Number.isFinite(final) || final <= 0) return null
    const totU = Number(p.totals_units || 0)
    const rolls = Number(p.rolls || 0)
    const cartons = Number(p.cartons || 0)

    if (qtyMode === 'kg' && p.price_per_kg != null && Number(p.price_per_kg) > 0) {
      return `${fmtDollarsPreview(p.price_per_kg, 2)}/kg`
    }
    if (qtyMode === 'units' && totU > 0) {
      if (isContinuousLength) {
        const perEa = final / totU
        if (Number.isFinite(perEa)) return `${fmtDollarsPreview(perEa, 2)}/ea`
      } else {
        const per1000 = final / (totU / 1000)
        if (Number.isFinite(per1000)) return `${fmtDollarsPreview(per1000, 2)}/1000`
      }
    }
    if (qtyMode === 'roll' && finishMode === 'Rolls' && rolls > 0) {
      const pr = roundToDecimalPlaces(final / rolls, 2)
      if (Number.isFinite(pr) && pr > 0) return `${fmtDollarsPreview(pr, 2)}/ROLL`
    }
    if (qtyMode === 'ctn' && finishMode === 'Cartons' && cartons > 0) {
      const pr = final / cartons
      if (Number.isFinite(pr)) return `${fmtDollarsPreview(pr, 2)}/CTN`
    }
    if (p.price_per_kg != null && Number(p.price_per_kg) > 0) {
      return `${fmtDollarsPreview(p.price_per_kg, 2)}/kg`
    }
    return null
  }, [quickPreview, qtyMode, isContinuousLength, finishMode])

  const moqPayloadHasQty =
    quoteUsesMoqOnly &&
    ratebook != null &&
    calcPayload?.quantity != null &&
    typeof calcPayload.quantity === 'object' &&
    Object.keys(calcPayload.quantity as object).length > 0

  const userQtyComplete =
    qtyType === 'total_rolls'
      ? numRollsNum > 0 && (isContinuousLength ? metersPerRollNum > 0 : weightPerRollNum > 0)
      : qtyType === 'rolls_units'
        ? numRollsNum > 0 && unitsPerRollNum > 0
        : qtyType === 'units'
          ? numUnitsNum > 0 &&
            (!isContinuousLength ||
              (finishMode === 'Rolls' && (weightPerRollNum > 0 || getRollWeightAvgKg(ratebook) > 0)) ||
              (finishMode === 'Cartons' &&
                Number(bagsPerCarton || 0) >= 1 &&
                (weightPerRollNum > 0 || getRollWeightAvgKg(ratebook) > 0)))
          : qtyType === 'kg'
            ? totalKg.trim() !== '' && (finishMode !== 'Rolls' || weightPerRollNum > 0)
            : false

  const canCalculate =
    (quoteUsesMoqOnly ? moqPayloadHasQty : userQtyComplete) &&
    widthMmNum > 0 &&
    (!isUFilm || (ufilmLeftWidthMmNum > 0 && ufilmRightWidthMmNum > 0)) &&
    thicknessUmNum > 0 &&
    (isContinuousLength || baseLengthMm > 0) &&
    (!(canHaveGusset && flagGusset) || gussetReturnMmNum > 0) &&
    (!flagPrinted || (printMethod !== 'None' && (Number(numColours || 0) >= 1 || !!printingErrorComputed))) &&
    (finishMode !== 'Cartons' || Number(bagsPerCarton || 0) >= 1)

  const missingForCalc = useMemo(() => {
    const missing: string[] = []
    if (!ratebook) missing.push('Pricing rates')
    if (!quoteUsesMoqOnly) {
      if ((qtyType === 'units') && !(numUnitsNum > 0))
        missing.push(
          `No. of ${productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : productType + 's'}`
        )
      else if (
        (qtyType === 'units') &&
        isContinuousLength &&
        finishMode === 'Rolls' &&
        numUnitsNum > 0 &&
        !(weightPerRollNum > 0 || getRollWeightAvgKg(ratebook) > 0)
      ) {
        missing.push('Weight per roll (or conversion average roll weight)')
      } else if (qtyType === 'kg') {
        if (!(totalKgNum > 0)) missing.push('Total KG')
        if (finishMode === 'Rolls' && !(weightPerRollNum > 0)) missing.push('Weight per roll')
      } else if (qtyType === 'total_rolls') {
        if (!(numRollsNum > 0)) missing.push('No. of Rolls')
        if (isContinuousLength) {
          if (!(metersPerRollNum > 0)) missing.push('Meters per roll')
        } else if (!(weightPerRollNum > 0)) {
          missing.push('Weight per roll')
        }
      } else if (qtyType === 'rolls_units') {
        if (!(numRollsNum > 0)) missing.push('No. of Rolls')
        if (!(unitsPerRollNum > 0)) missing.push(`${productUnitLabel} per roll`)
      }
    } else {
      if (qtyType === 'total_rolls') {
        if (isContinuousLength && !(metersPerRollNum > 0)) missing.push('Meters per roll')
        if (
          !isContinuousLength &&
          !(weightPerRollNum > 0) &&
          !(getRollWeightAvgKg(ratebook) > 0) &&
          !(materialsMoqDenomKg?.kgPerRoll != null && materialsMoqDenomKg.kgPerRoll > 0)
        ) {
          missing.push('Weight per roll (or conversion average roll weight)')
        }
      }
      if (qtyType === 'kg' && finishMode === 'Rolls' && !(weightPerRollNum > 0)) {
        missing.push('Weight per roll')
      }
      if (qtyType === 'rolls_units' && !(unitsPerRollNum > 0)) {
        missing.push(`${productUnitLabel} per roll`)
      }
      if (
        qtyType === 'units' &&
        isContinuousLength &&
        finishMode === 'Rolls' &&
        !(metersPerRollNum > 0) &&
        !(weightPerRollNum > 0 || getRollWeightAvgKg(ratebook) > 0)
      ) {
        missing.push('Meters per roll or weight per roll')
      }
    }
    if (!(widthMmNum > 0)) missing.push(`${productType} Width`)
    if (isUFilm && !(ufilmLeftWidthMmNum > 0)) missing.push('U-Film Left Width')
    if (isUFilm && !(ufilmRightWidthMmNum > 0)) missing.push('U-Film Right Width')
    if (!(thicknessUmNum > 0)) missing.push('Gauge')
    if (!isContinuousLength && !(baseLengthMm > 0)) missing.push('Length')
    if (canHaveGusset && flagGusset && !(gussetReturnMmNum > 0)) missing.push('Gusset Return')
    if (flagPrinted && !(printMethod !== 'None')) missing.push('Print Method')
    if (flagPrinted && showNumColours && !(Number(numColours || 0) >= 1) && !printingErrorComputed) missing.push('No. Colours')
    if (finishMode === 'Cartons' && !(Number(bagsPerCarton || 0) >= 1)) missing.push('Bags/Carton')
    return missing
  }, [
    baseLengthMm,
    bagsPerCarton,
    canHaveGusset,
    finishMode,
    flagGusset,
    flagPrinted,
    gussetReturnMmNum,
    isContinuousLength,
    isUFilm,
    numColours,
    printMethod,
    printingErrorComputed,
    numRollsNum,
    numUnitsNum,
    unitsPerRollNum,
    metersPerRollNum,
    productType,
    qtyType,
    ratebook,
    totalKgNum,
    weightPerRoll,
    weightPerRollNum,
    showNumColours,
    thicknessUmNum,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
    quoteUsesMoqOnly,
    cartonQtyMode,
    materialsMoqDenomKg,
    productUnitLabel,
  ])

  const appliedExtrusionWasteFactors: AppliedExtrusionWasteFactor[] = useMemo(() => {
    if (!ratebook) return []
    try {
      return computeAppliedExtrusionWasteFactors(calcInputs, ratebook)
    } catch {
      return []
    }
  }, [calcInputs, ratebook])

  function wasteFactorLabel(slug: string): string {
    switch (slug) {
      case 'simple_job':
        return 'Simple Job'
      case 'complex_set_up_print_or_perforation':
        return 'Complex Set up (Print or Perforation)'
      case 'non_standard_resin_or_colour':
        return 'Non standard Resin or Colour'
      case 'non_standard_resin':
        return 'Non standard resin'
      case 'colour_not_clear':
        return 'Colour (not clear)'
      case 'gusset':
        return 'Gusset'
      default:
        return slug
    }
  }

  useEffect(() => {
    if (!canCalculate || !ratebook) {
      setQuickPreview(null)
      return
    }
    const t = window.setTimeout(() => {
      setCalcLoading(true)
      try {
        const res = computeQuickQuotePreview(calcInputs, ratebook)
        setQuickPreview(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to calculate quick quote')
        setQuickPreview(null)
      } finally {
        setCalcLoading(false)
      }
    }, 450)
    return () => window.clearTimeout(t)
  }, [canCalculate, ratebook, calcInputs])

  /** Server-backed customer picker: avoid rendering thousands of `<MenuItem>` rows. */
  const customerPickerItems = useAppSelector((s) => s.customers.list.items)
  const customerPickerLoading = useAppSelector((s) => s.customers.list.status === 'loading')
  const selectedCustomerDetail = useAppSelector((s) =>
    customerId.trim() ? s.customers.detail.byId[customerId]?.customer : null,
  )
  const [customerSearch, setCustomerSearch] = useState('')

  useEffect(() => {
    const delayMs = customerSearch ? 300 : 0
    const t = window.setTimeout(() => {
      void dispatch(
        fetchCustomers({
          q: customerSearch,
          page: 1,
          page_size: Math.min(CUSTOMER_PICKER_PAGE_SIZE, 100),
        }),
      )
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [dispatch, customerSearch])

  useEffect(() => {
    if (!customerId.trim()) return
    if (customerPickerItems.some((c) => c.id === customerId)) return
    if (selectedCustomerDetail?.id === customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, customerPickerItems, selectedCustomerDetail, dispatch])

  const customerAutocompleteValue: CustomerSummary | null = useMemo(() => {
    if (!customerId) return null
    const inList = customerPickerItems.find((c) => c.id === customerId)
    if (inList) return inList
    if (selectedCustomerDetail?.id === customerId) {
      return {
        id: selectedCustomerDetail.id,
        name: selectedCustomerDetail.name,
        status: selectedCustomerDetail.status,
      }
    }
    return { id: customerId, name: 'Loading…', status: 'active' }
  }, [customerId, customerPickerItems, selectedCustomerDetail])
  const costPerKgForSave =
    quickPreview?.cost_per_kg != null && Number.isFinite(Number(quickPreview.cost_per_kg))
      ? Number(quickPreview.cost_per_kg)
      : null
  const billedKgForPriceSave =
    quickPreview?.totals_kg != null && Number.isFinite(Number(quickPreview.totals_kg)) && Number(quickPreview.totals_kg) > 0
      ? Number(quickPreview.totals_kg)
      : null
  const finalPriceForSave =
    quickPreview?.final_price != null && Number.isFinite(Number(quickPreview.final_price)) && Number(quickPreview.final_price) > 0
      ? Number(quickPreview.final_price)
      : null
  /** Roll qty basis: $/ROLL is 2 d.p.; job total = that rate × rolls (cent-rounded). Saved $/kg backs out from this total so persist matches the table. */
  const finalPriceForSaveAdjusted =
    qtyMode === 'roll' &&
    finalPriceForSave != null &&
    quickPreview?.rolls != null &&
    Number.isFinite(Number(quickPreview.rolls)) &&
    Number(quickPreview.rolls) > 0
      ? (() => {
          const rollsN = Number(quickPreview.rolls)
          return roundMoneyCents(roundToDecimalPlaces(finalPriceForSave / rollsN, 2) * rollsN)
        })()
      : finalPriceForSave
  const pricePerKgFromJobTotal =
    billedKgForPriceSave != null && finalPriceForSaveAdjusted != null
      ? pricePerKgFromQuotedTotal(finalPriceForSaveAdjusted, billedKgForPriceSave)
      : null
  const pricePerKgForSave =
    pricePerKgFromJobTotal != null && Number.isFinite(pricePerKgFromJobTotal) && pricePerKgFromJobTotal > 0
      ? pricePerKgFromJobTotal
      : suggestedPricePerKg.trim() !== '' && Number.isFinite(Number(suggestedPricePerKg)) && Number(suggestedPricePerKg) > 0
        ? Number(suggestedPricePerKg)
        : null

  const { setDirty } = useUnsavedChanges()

  const clearPricePerKgOverride = useCallback(() => {
    preserveLoadedPricePerKgRef.current = false
    setSuggestedPricePerKg('')
    setDirty(true)
  }, [setDirty])

  /** Qty type KG: user-edited $/kg in the Live Quote table → optional override (2 d.p.). */
  const applyTableKgPriceOverride = useCallback(
    (rawPricePerKg: number) => {
      if (!Number.isFinite(rawPricePerKg) || rawPricePerKg <= 0) return
      const rounded = roundToDecimalPlaces(rawPricePerKg, 2)
      if (!Number.isFinite(rounded) || rounded <= 0) return
      preserveLoadedPricePerKgRef.current = false
      setSuggestedPricePerKg(formatPricePerKgString(rounded))
      setDirty(true)
    },
    [setDirty],
  )

  /**
   * User-entered unit rate ($/ROLL, $/1000, $/ea, $/CTN) → implied job total → $/kg override that reproduces that total
   * after cents rounding (same basis as save / `pricePerKgFromQuotedTotal`).
   */
  const applyTableUnitPriceOverride = useCallback(
    (rawUnitPrice: number) => {
      const p = quickPreview
      if (!p || !Number.isFinite(rawUnitPrice) || rawUnitPrice <= 0) return
      const billedKg = Number(p.totals_kg || 0)
      if (!(billedKg > 0)) return

      const unitRate = roundToDecimalPlaces(rawUnitPrice, 2)
      if (!Number.isFinite(unitRate) || unitRate <= 0) return

      let targetTotal: number | null = null
      if (qtyMode === 'roll') {
        const rolls = Number(p.rolls || 0)
        if (rolls > 0) targetTotal = roundMoneyCents(unitRate * rolls)
      } else if (qtyMode === 'units') {
        const totU = Number(p.totals_units || 0)
        if (totU > 0) {
          if (isContinuousLength) targetTotal = roundMoneyCents(unitRate * totU)
          else targetTotal = roundMoneyCents(unitRate * (totU / 1000))
        }
      } else if (qtyMode === 'ctn') {
        const cartons = Number(p.cartons || 0)
        if (cartons > 0) targetTotal = roundMoneyCents(unitRate * cartons)
      }

      if (targetTotal == null || !(targetTotal > 0)) return
      const ppg = pricePerKgFromQuotedTotal(targetTotal, billedKg)
      if (ppg != null && Number.isFinite(ppg) && ppg > 0) {
        preserveLoadedPricePerKgRef.current = false
        setSuggestedPricePerKg(formatPricePerKgString(ppg))
        setDirty(true)
      }
    },
    [quickPreview, qtyMode, isContinuousLength, setDirty],
  )

  const [converting, setConverting] = useState(false)
  const [convertErr, setConvertErr] = useState<string | null>(null)

  /**
   * Create or update the saved quote. Used by Save and by Convert (convert always saves first).
   * @returns Saved quote id
   */
  async function persistQuote(opts: { navigateToEditOnCreate: boolean }): Promise<string> {
    if (!customerId.trim()) {
      throw new Error('Select a customer to save this quote.')
    }
    if (quoteId) {
      await dispatch(
        updateSavedQuote({
          quoteId,
          payload: payloadForSave,
          cost_per_kg: costPerKgForSave ?? undefined,
          price_per_kg: pricePerKgForSave ?? undefined,
        }),
      ).unwrap()
      setDirty(false)
      return quoteId
    }
    const quote = await dispatch(
      createSavedQuote({
        customer_id: customerId.trim(),
        payload: payloadForSave,
        cost_per_kg: costPerKgForSave,
        price_per_kg: pricePerKgForSave,
      }),
    ).unwrap()
    const id = quote?.id
    if (!id) throw new Error('Failed to save quote')
    setDirty(false)
    if (opts.navigateToEditOnCreate) {
      navigate(`/quotes/${id}/edit`)
    }
    return id
  }

  async function handleConvertToOrder() {
    if (!customerId.trim() || !canCalculate) {
      setConvertErr('Select a customer and complete the quote fields before converting to order.')
      return
    }
    setConvertErr(null)
    setConverting(true)
    try {
      let savedQuoteId: string
      try {
        savedQuoteId = await persistQuote({ navigateToEditOnCreate: false })
      } catch (e) {
        setConvertErr(formatThunkRejection(e, 'Failed to save quote before converting to order.'))
        return
      }

      const suffix = `${String(savedQuoteId).slice(0, 8)}-${Date.now().toString(36).slice(-4)}`

      // Merge live quantity fields so convert matches the form even if `payloadForSave` lagged a render
      // or persisted payload keys differ (e.g. snake_case-only reload edge cases).
      const qpLive: QuotePayload = {
        ...(payloadForSave as QuotePayload),
        qtyType,
        numRolls,
        weightPerRoll,
        totalKg,
        numUnits,
        unitsPerRoll,
      }

      const spec = buildSpecFromQuotePayload(qpLive)
      const fromSpec = (getDisplayProductCodeFromSpec(spec) || '').trim()
      const productCode = fromSpec || `Q-${suffix}`
      let createProductRes: { ok?: boolean; product?: { id: string }; version?: { id: string } }
      try {
        createProductRes = await dispatch(
          createProduct({
            data: {
              customer_id: customerId,
              code: productCode,
              spec,
            },
          }),
        ).unwrap()
      } catch (e) {
        setConvertErr(formatThunkRejection(e, 'Failed to create product'))
        return
      }
      const productId = createProductRes?.product?.id
      if (!productId) {
        setConvertErr('Failed to create product')
        return
      }

      const previewNums = {
        totals_kg: quickPreview?.totals_kg != null ? Number(quickPreview.totals_kg) : null,
        rolls: quickPreview?.rolls != null ? Number(quickPreview.rolls) : null,
        cartons: quickPreview?.cartons != null ? Number(quickPreview.cartons) : null,
        totals_units: quickPreview?.totals_units != null ? Number(quickPreview.totals_units) : null,
      }
      const qty = getOrderQuantityFromQuotePayload(qpLive, previewNums)
      const pricePerKg =
        pricePerKgForSave != null && Number.isFinite(Number(pricePerKgForSave))
          ? Number(pricePerKgForSave)
          : quickPreview?.price_per_kg != null && Number.isFinite(Number(quickPreview.price_per_kg))
            ? Number(quickPreview.price_per_kg)
            : null
      const finalPrice =
        quickPreview?.final_price != null && Number.isFinite(Number(quickPreview.final_price))
          ? Number(quickPreview.final_price)
          : null

      let rate: number | null = null
      let totalPrice: number | null = null
      if (qty.quantity_unit === 'rolls' || qty.quantity_unit === 'cartons' || qty.quantity_unit === '1000') {
        if (qty.quantity_value > 0 && finalPrice != null) {
          rate = finalPrice / qty.quantity_value
          totalPrice = finalPrice
        }
      } else if (qty.quantity_unit === 'kg') {
        const kg = qty.quantity_value
        if (kg > 0 && pricePerKg != null) {
          rate = pricePerKg
          totalPrice = kg * pricePerKg
        }
      }

      const today = new Date()
      const orderDate = today.toISOString().slice(0, 10)
      const dueDate = new Date(today)
      dueDate.setDate(dueDate.getDate() + 28)
      const dueDateStr = dueDate.toISOString().slice(0, 10)

      // Use live form state for job-sheet extras. Weight/roll must match quote preview + PUT payload
      // logic: `computeQuickQuotePreview().kg_per_roll` (= billedKgPerRoll ?? kgPerRoll from geometry),
      // not the raw nominal "weight per roll" input (e.g. 100kg ÷ 10.1 → 10 rolls → ~10kg/roll billed).
      const qtyTypeForOrder = String(
        qpLive.qtyType || (qpLive as { qty_type?: string }).qty_type || '',
      ).trim()
      const previewKgPerRoll =
        quickPreview?.kg_per_roll != null &&
        Number.isFinite(Number(quickPreview.kg_per_roll)) &&
        Number(quickPreview.kg_per_roll) > 0
          ? Number(quickPreview.kg_per_roll)
          : null
      const derivedKgPerRoll =
        derivedForDisplay != null
          ? (() => {
              const x = derivedForDisplay.billedKgPerRoll ?? derivedForDisplay.kgPerRoll
              return x != null && Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null
            })()
          : null
      const wprResolved =
        previewKgPerRoll ??
        derivedKgPerRoll ??
        resolveWeightPerRollKgForOrderConvert(qpLive, {
          qtyTypeOverride: qtyType,
          weightPerRollOverride: weightPerRoll,
        })
      const wprOk = wprResolved != null && wprResolved > 0
      const wprNum = wprResolved ?? 0

      const previewRolls =
        quickPreview?.rolls != null &&
        Number.isFinite(Number(quickPreview.rolls)) &&
        Number(quickPreview.rolls) > 0
          ? Math.max(1, Math.round(Number(quickPreview.rolls)))
          : null
      const nrState = Math.max(0, Math.round(Number(numRolls) || 0))
      const nrOrder = Math.max(1, Math.round(Number(qty.quantity_value) || 1))
      const rollsFinish = finishMode === 'Rolls'
      const numRollsForSheet =
        nrState > 0
          ? nrState
          : rollsFinish && previewRolls != null
            ? previewRolls
            : qty.quantity_unit === 'rolls'
              ? nrOrder
              : undefined

      const sendWeightPerRoll =
        rollsFinish &&
        wprOk &&
        (qty.quantity_unit === 'rolls' || qty.quantity_unit === 'kg' || qty.quantity_unit === '1000')

      const orderPayload: {
        customer_id: string
        quote_id?: string
        status: string
        order_date?: string
        items: Array<{
          product_id: string
          quantity_value: number
          quantity_unit: string
          due_date?: string | null
          rate?: number | null
          total_price?: number | null
          qty_type?: string
          num_product_units?: number
          weight_per_roll_kg?: number
          num_rolls?: number
        }>
      } = {
        customer_id: customerId,
        status: 'draft',
        order_date: orderDate,
        items: [
          {
            product_id: productId,
            quantity_value: qty.quantity_value,
            quantity_unit: qty.quantity_unit,
            due_date: dueDateStr,
            ...(rate != null && Number.isFinite(rate) ? { rate } : {}),
            ...(totalPrice != null && Number.isFinite(totalPrice) ? { total_price: totalPrice } : {}),
            ...(qtyTypeForOrder ? { qty_type: qtyTypeForOrder } : {}),
            ...(qtyTypeForOrder === 'units' && numUnitsNum > 0 ? { num_product_units: numUnitsNum } : {}),
            ...(sendWeightPerRoll ? { weight_per_roll_kg: wprNum } : {}),
            ...(numRollsForSheet != null && numRollsForSheet >= 1 ? { num_rolls: numRollsForSheet } : {}),
          },
        ],
      }
      orderPayload.quote_id = savedQuoteId

      const createOrderRes = await dispatch(createOrder(orderPayload)).unwrap()
      const orderId = createOrderRes?.order_id
      if (!orderId) {
        setConvertErr('Failed to create order')
        return
      }
      try {
        await dispatch(
          updateSavedQuote({
            quoteId: savedQuoteId,
            payload: { ...payloadForSave, converted_order_id: orderId },
            cost_per_kg: costPerKgForSave ?? undefined,
            price_per_kg: pricePerKgForSave ?? undefined,
          }),
        ).unwrap()
      } catch (e) {
        setConvertErr(
          `Order was created (id: ${orderId}) but saving the link on this quote failed: ${formatThunkRejection(e, 'Update failed')}. Open the order from the orders list.`,
        )
        return
      }
      setConvertedOrderId(orderId)
      setDirty(false)
      const orderEditPath = `/orders/${encodeURIComponent(orderId)}/edit`
      try {
        const { order } = await dispatch(fetchOrder(orderId)).unwrap()
        const firstItem = Array.isArray(order?.items) ? order.items[0] : null
        const jobSheetId =
          firstItem && firstItem.job_sheet_id != null ? String(firstItem.job_sheet_id).trim() : ''
        const productId =
          firstItem && firstItem.product_id != null ? String(firstItem.product_id).trim() : ''
        const productCode = firstItem != null ? String(firstItem.product_code || '') : ''
        if (jobSheetId && productId) {
          navigate(orderEditPath, {
            replace: true,
            state: {
              openJobSheetFor: {
                job_sheet_id: jobSheetId,
                product_id: productId,
                product_code: productCode || null,
              },
            },
          })
        } else {
          navigate(orderEditPath, { replace: true })
        }
      } catch {
        navigate(orderEditPath, { replace: true })
      }
    } catch (e) {
      setConvertErr(formatThunkRejection(e, 'Convert to order failed'))
    } finally {
      setConverting(false)
    }
  }

  async function handleSaveQuote() {
    if (!customerId.trim()) {
      setErr('Select a customer to save this quote.')
      return
    }
    setErr(null)
    try {
      await persistQuote({ navigateToEditOnCreate: true })
    } catch {
      // Error stored in quotes.upsert.error, shown via displayErr
    }
  }

  function renderQuoteActions() {
    return (
      <>
        <Button component={Link} to="/quotes" variant="text" color="primary">
          Cancel
        </Button>
        <Button
          variant="outlined"
          disabled={saving || !customerId.trim() || !canCalculate}
          onClick={() => void handleSaveQuote()}
        >
          {saving ? 'Saving…' : isEditMode ? 'Update quote' : 'Save quote'}
        </Button>
        <Button
          variant="contained"
          disabled={
            saving ||
            converting ||
            !customerId.trim() ||
            !canCalculate ||
            Boolean(convertedOrderId?.trim())
          }
          onClick={() => void handleConvertToOrder()}
        >
          {convertedOrderId?.trim()
            ? 'Converted to order'
            : converting
              ? 'Converting…'
              : saving
                ? 'Saving…'
                : 'Convert to order'}
        </Button>
      </>
    )
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5">Quote Calculator</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {renderQuoteActions()}
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Customer
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          {isEditMode ? (
            <TextField
              size="small"
              label="Customer"
              value={initialData?.customer_name?.trim() ? initialData.customer_name : customerId}
              InputProps={{ readOnly: true }}
              disabled
              sx={{ minWidth: 280 }}
            />
          ) : (
            <Autocomplete
              size="small"
              sx={{ minWidth: 280, maxWidth: '100%' }}
              options={customerPickerItems}
              loading={customerPickerLoading}
              value={customerAutocompleteValue}
              onChange={(_e, v) => {
                setCustomerId(v?.id ? String(v.id) : '')
                setDirty(true)
              }}
              onInputChange={(_e, v, reason) => {
                if (reason === 'input' || reason === 'clear') setCustomerSearch(v)
              }}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(c) => c.name || c.id}
              filterOptions={(opts) => opts}
              noOptionsText={customerSearch.trim() ? 'No customers match' : 'Type to search'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Customer"
                  placeholder="Search by name…"
                />
              )}
            />
          )}
          {isEditMode ? (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              Created: {fmtSavedQuoteDate(initialData?.created_at)}
              {initialData?.updated_at ? ` · Edited: ${fmtSavedQuoteDate(initialData.updated_at)}` : ''}
            </Typography>
          ) : null}
        </Box>
      </Paper>

      {convertedOrderId?.trim() ? (
        <Alert severity="info">
          This quote has been converted to an order.{' '}
          <Link to={`/orders/${convertedOrderId.trim()}/edit`}>Open order</Link>
        </Alert>
      ) : null}

      {(displayErr || ratebookErr || convertErr) && (
        <Alert severity="error">{displayErr || ratebookErr || convertErr}</Alert>
      )}
      <PrintingUnavailableAlert message={printingErrorComputed} prominent />

      <Box
        sx={{
          display: { xs: 'block', md: 'flex' },
          gap: 2,
          alignItems: 'flex-start',
        }}
        onChange={() => setDirty(true)}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Product Type
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                <DefaultSelectField defaultValue="Bag" label="Product Type" value={productType} onChange={(e) => setProductType(e.target.value)}>
                  {productTypes.map((pt: string) => (
                    <MenuItem key={pt} value={pt}>
                      {pt}
                    </MenuItem>
                  ))}
                </DefaultSelectField>
                <DefaultSelectField defaultValue="Rolls" label="Finish Mode" value={finishMode} onChange={(e) => setFinishMode(e.target.value as any)}>
                  <MenuItem value="Rolls">Rolls</MenuItem>
                  <MenuItem value="Cartons">Cartons</MenuItem>
                </DefaultSelectField>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Geometry
              </Typography>
              <Stack spacing={2}>

                <FormGroup row>
                  <FormControlLabel
                    control={
                      <Checkbox checked={canHaveGusset && flagGusset} onChange={(e) => setFlagGusset(e.target.checked)} disabled={!canHaveGusset} />
                    }
                    label="Gusset"
                  />
                  <FormControlLabel control={<Checkbox checked={flagPrinted} onChange={(e) => setPrinted(e.target.checked)} />} label="Printed" />
                  <FormControlLabel control={<Checkbox checked={flagPerforated} onChange={(e) => setFlagPerforated(e.target.checked)} />} label="Perforated" />
                  <FormControlLabel control={<Checkbox checked={flagSealed} onChange={(e) => setFlagSealed(e.target.checked)} />} label="Sealed" />
                  <FormControlLabel control={<Checkbox checked={flagPunched} onChange={(e) => setFlagPunched(e.target.checked)} />} label="Punched" />
                </FormGroup>

                {isUFilm ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2 }}>
                    <TextField label="Left Width (mm)" type="number" value={ufilmLeftWidthMm} onChange={(e) => setUfilmLeftWidthMm(e.target.value)} />
                    <TextField label="Middle Width (mm)" type="number" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} />
                    <TextField label="Right Width (mm)" type="number" value={ufilmRightWidthMm} onChange={(e) => setUfilmRightWidthMm(e.target.value)} />
                  </Box>
                ) : (
                  <Stack spacing={2}>
                    {showRunUp ? (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                          gap: 2,
                        }}
                      >
                        <TextField
                          label="Layflat Width (mm)"
                          type="number"
                          value={layflatInput != null ? layflatInput : (layflatWidthMm > 0 ? String(Math.round(layflatWidthMm)) : '')}
                          onFocus={() => setLayflatInput(layflatWidthMm > 0 ? String(Math.round(layflatWidthMm)) : '')}
                          onChange={(e) => {
                            const raw = e.target.value
                            setLayflatInput(raw)
                            if (raw === '') {
                              setWidthMm('')
                            } else {
                              const v = Number(raw)
                              if (Number.isFinite(v) && runUp > 0) setWidthMm(String((v * 2) / runUp))
                            }
                          }}
                          onBlur={() => setLayflatInput(null)}
                        />
                        <DefaultSelectField
                          label="Run Up"
                          value={String(runUp)}
                          defaultValue={String(runUpOptions[0] || 1)}
                          onChange={(e) => setRunUp(Number(e.target.value || 1))}
                        >
                          {runUpOptions.map((v) => (
                            <MenuItem key={v} value={String(v)}>
                              {v} up
                            </MenuItem>
                          ))}
                        </DefaultSelectField>
                        <TextField
                          label={`${productType} Width (mm)`}
                          type="number"
                          value={widthMm}
                          onChange={(e) => setWidthMm(e.target.value)}
                        />
                      </Box>
                    ) : canHaveGusset && flagGusset ? (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          flexWrap: 'wrap',
                        }}
                      >
                        <TextField
                          label={`${productType} Width (mm)`}
                          type="number"
                          value={widthMm}
                          onChange={(e) => setWidthMm(e.target.value)}
                          sx={{ width: isMobile ? '100%' : 200 }}
                        />
                        <Typography sx={{ fontSize: '1.75rem', lineHeight: 1, color: 'text.secondary', px: 0.5 }}>+</Typography>
                        <TextField
                          label="Gusset Return (mm)"
                          type="number"
                          value={gussetReturnMm}
                          onChange={(e) => setGussetReturnMm(e.target.value)}
                          sx={{ width: isMobile ? '100%' : 200 }}
                        />
                        <Typography sx={{ fontSize: '1.75rem', lineHeight: 1, color: 'text.secondary', px: 0.5 }}>=</Typography>
                        <TextField
                          label="Layflat Width (mm)"
                          value={
                            widthMmNum > 0 || gussetReturnMmNum > 0
                              ? String(widthMmNum + gussetReturnMmNum)
                              : ''
                          }
                          InputProps={{ readOnly: true }}
                          disabled
                          sx={{ width: isMobile ? '100%' : 180 }}
                        />
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 1fr)',
                          gap: 2,
                        }}
                      >
                        <TextField label={`${productType} Width (mm)`} type="number" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} />
                      </Box>
                    )}
                  </Stack>
                )}

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField
                    label="Length Units"
                    value={effectiveLengthUnits}
                    defaultValue="mm"
                    onChange={(e) => {
                      const v = e.target.value as 'mm' | 'm' | 'continuous'
                      setLengthUnits(v)
                      if (v === 'continuous') setLength('')
                    }}
                    disabled={isTubeProduct}
                  >
                    <MenuItem value="mm">mm</MenuItem>
                    <MenuItem value="m">m</MenuItem>
                    {lengthAllowsContinuous ? <MenuItem value="continuous">Continuous</MenuItem> : null}
                  </DefaultSelectField>
                  <TextField
                    label={
                      isContinuousLength
                        ? 'Length'
                        : effectiveLengthUnits === 'm'
                          ? 'Length (m)'
                          : 'Length (mm)'
                    }
                    type={isContinuousLength ? 'text' : 'number'}
                    value={isContinuousLength ? 'Continuous' : length}
                    onChange={(e) => setLength(e.target.value)}
                    disabled={isContinuousLength}
                    helperText={isTubeProduct ? 'Tubes use continuous length' : undefined}
                  />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 1fr)', gap: 2 }}>
                  <TextField label="Thickness / Gauge (µm)" type="number" value={thicknessUm} onChange={(e) => setThicknessUm(e.target.value)} />
                </Box>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Quantity
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">Qty Type</FormLabel>
                    <RadioGroup
                      row
                      value={qtyMode}
                      onChange={(_e, v) => {
                        if (v === 'units') {
                          applyQuantityCarryForNewQtyType('units', '1000')
                          setQtyType('units')
                          if (finishMode === 'Cartons') setCartonQtyMode('1000')
                        } else if (v === 'ctn') {
                          applyQuantityCarryForNewQtyType('units', 'ctn')
                          setQtyType('units')
                          setCartonQtyMode('ctn')
                        } else if (v === 'kg') {
                          applyQuantityCarryForNewQtyType('kg')
                          setQtyType('kg')
                        } else if (finishMode === 'Rolls') {
                          const nextQtyType = isContinuousLength
                            ? 'total_rolls'
                            : qtyType === 'rolls_units'
                              ? 'rolls_units'
                              : 'total_rolls'
                          applyQuantityCarryForNewQtyType(nextQtyType)
                          setQtyType(nextQtyType)
                        }
                      }}
                    >
                      <FormControlLabel
                        value="units"
                        control={<Radio />}
                        label={
                          isContinuousLength
                            ? `total ${productUnitLabel.toLowerCase()}`
                            : `1000 (total ${productUnitLabel.toLowerCase()})`
                        }
                      />
                      <FormControlLabel value="kg" control={<Radio />} label="KG (total kg)" />
                      {finishMode === 'Cartons' ? <FormControlLabel value="ctn" control={<Radio />} label="CTN" /> : null}
                      {finishMode === 'Rolls' ? <FormControlLabel value="roll" control={<Radio />} label="ROLL" /> : null}
                    </RadioGroup>
                  </FormControl>
                </Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={quoteUsesMoqOnly}
                      onChange={(_e, checked) => setQuoteUsesMoqOnly(checked)}
                    />
                  }
                  label="Price at minimum order quantity (MOQ) only"
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
                  When checked, pricing uses the materials MOQ for this width and the primary quantity fields update to
                  match. Edit a primary quantity (total kg, rolls, units, cartons, etc.) to price a specific job quantity
                  instead; re-check to snap back to MOQ. With MOQ off, the copyable table adds QTY and Total columns.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                  <TextField
                    label="Total KG"
                    type="number"
                    inputProps={{ min: 0, step: 0.1 }}
                    value={
                      totalKgEditable
                        ? totalKg
                        : (haveDriverForTotalKg && totalKgDisplay != null
                          ? formatKgDisplay(totalKgDisplay)
                          : totalKg !== '' && Number.isFinite(Number(totalKg))
                            ? formatKgDisplay(Number(totalKg))
                            : totalKg)
                    }
                    onChange={
                      totalKgEditable
                        ? (e) => {
                            setQuoteUsesMoqOnly(false)
                            setTotalKg(e.target.value)
                          }
                        : undefined
                    }
                    disabled={!totalKgEditable}
                  />
                  {finishMode === 'Rolls' ? (
                    <TextField
                      label={`${productUnitLabel} per roll`}
                      type="number"
                      inputProps={{ min: 0, step: qtyType === 'rolls_units' ? 1 : 'any' }}
                      value={
                        qtyType === 'rolls_units'
                          ? unitsPerRoll
                          : productsPerRollDerived != null
                            ? String(Math.max(0, Math.floor(productsPerRollDerived)))
                            : ''
                      }
                      onChange={(e) => {
                        setQuoteUsesMoqOnly(false)
                        setUnitsPerRoll(e.target.value)
                        setQtyType('rolls_units')
                      }}
                      disabled={
                        (qtyType === 'total_rolls' && isContinuousLength) ||
                        !(qtyMode === 'roll' || qtyType === 'rolls_units')
                      }
                    />
                  ) : (
                    <TextField
                      label={`${productUnitLabel} per Carton`}
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={bagsPerCarton}
                      onChange={(e) => setBagsPerCarton(e.target.value)}
                    />
                  )}
                  <TextField
                    label={finishMode === 'Cartons' ? 'Weight per Carton (kg)' : 'Weight per Roll (kg)'}
                    type="number"
                    inputProps={{ min: 0, step: 'any' }}
                    value={
                      weightPerRollEditable
                        ? weightPerRoll
                        : qtyType === 'rolls_units' && finishMode === 'Rolls'
                          ? weightPerRollDisplay != null
                            ? formatKgDisplay(weightPerRollDisplay)
                            : ''
                          : haveDriverForWeightPerRoll && weightPerRollDisplay != null
                            ? formatKgDisplay(weightPerRollDisplay)
                            : finishMode === 'Cartons'
                              ? '—'
                              : weightPerRoll !== '' && Number.isFinite(Number(weightPerRoll))
                                ? formatKgDisplay(Number(weightPerRoll))
                                : weightPerRoll
                    }
                    onChange={
                      qtyMode === 'roll'
                        ? (e) => {
                            setQuoteUsesMoqOnly(false)
                            setWeightPerRoll(e.target.value)
                            setQtyType('total_rolls')
                            if (isContinuousLength) {
                              const nextWpr = Number(e.target.value || 0)
                              const totalM =
                                quickPreview?.totals_m != null && Number.isFinite(Number(quickPreview.totals_m))
                                  ? Number(quickPreview.totals_m)
                                  : null
                              const totalKgSnap =
                                quickPreview?.totals_kg != null && Number.isFinite(Number(quickPreview.totals_kg))
                                  ? Number(quickPreview.totals_kg)
                                  : null
                              const kgPerM =
                                totalM != null && totalM > 0 && totalKgSnap != null && totalKgSnap > 0
                                  ? totalKgSnap / totalM
                                  : null
                              if (kgPerM != null && Number.isFinite(kgPerM) && kgPerM > 0 && nextWpr > 0) {
                                const mpr = nextWpr / kgPerM
                                if (Number.isFinite(mpr) && mpr > 0) setMetersPerRoll(roundTo2Decimals(String(mpr)))
                              }
                              const rcRoll = continuousRollCountForTotalKgSync()
                              if (rcRoll != null && rcRoll > 0 && nextWpr > 0) {
                                setTotalKg(formatKgDisplay(nextWpr * rcRoll))
                              }
                            }
                          }
                        : isContinuousLength && finishMode === 'Rolls' && weightPerRollEditable
                          ? (e) => {
                              setQuoteUsesMoqOnly(false)
                              setWeightPerRoll(e.target.value)
                              const nextWpr = Number(e.target.value || 0)
                              const totalM =
                                quickPreview?.totals_m != null && Number.isFinite(Number(quickPreview.totals_m))
                                  ? Number(quickPreview.totals_m)
                                  : null
                              const totalKgSnap =
                                quickPreview?.totals_kg != null && Number.isFinite(Number(quickPreview.totals_kg))
                                  ? Number(quickPreview.totals_kg)
                                  : null
                              const kgPerM =
                                totalM != null && totalM > 0 && totalKgSnap != null && totalKgSnap > 0
                                  ? totalKgSnap / totalM
                                  : null
                              if (kgPerM != null && Number.isFinite(kgPerM) && kgPerM > 0 && nextWpr > 0) {
                                const mpr = nextWpr / kgPerM
                                if (Number.isFinite(mpr) && mpr > 0) setMetersPerRoll(roundTo2Decimals(String(mpr)))
                              }
                              const rcKgUnits = continuousRollCountForTotalKgSync()
                              if (rcKgUnits != null && rcKgUnits > 0 && nextWpr > 0) {
                                setTotalKg(formatKgDisplay(nextWpr * rcKgUnits))
                              }
                            }
                          : weightPerRollEditable
                            ? (e) => setWeightPerRoll(e.target.value)
                            : undefined
                    }
                    disabled={qtyMode === 'roll' ? false : !weightPerRollEditable}
                  />
                  <TextField
                    label={finishMode === 'Cartons' ? 'No. of Cartons' : 'No. of Rolls'}
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    value={
                      finishMode === 'Cartons' && qtyMode === 'ctn'
                        ? numCartons
                        : rollsEditable
                        ? numRolls
                        : (rollsDisplay != null ? rollsDisplay : finishMode === 'Cartons' ? '—' : numRolls)
                    }
                    onChange={
                      finishMode === 'Cartons' && qtyMode === 'ctn'
                        ? (e) => {
                            setQuoteUsesMoqOnly(false)
                            setNumCartons(e.target.value)
                          }
                        : rollsEditable
                          ? (e) => {
                              setQuoteUsesMoqOnly(false)
                              setNumRolls(e.target.value)
                            }
                          : undefined
                    }
                    disabled={finishMode === 'Cartons' && qtyMode === 'ctn' ? false : !rollsEditable}
                  />
                  <TextField
                    label="Total products"
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    sx={finishMode === 'Cartons' ? { gridColumn: '1 / -1' } : undefined}
                    value={
                      unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')
                        ? numUnits
                        : unitsDisplay != null && Number.isFinite(Number(unitsDisplay))
                          ? String(Math.round(Number(unitsDisplay)))
                          : numUnits !== '' && Number.isFinite(Number(numUnits))
                            ? String(Math.round(Number(numUnits)))
                            : ''
                    }
                    onChange={
                      unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')
                        ? (e) => {
                            setQuoteUsesMoqOnly(false)
                            setNumUnits(e.target.value)
                          }
                        : undefined
                    }
                    disabled={!unitsEditable || (finishMode === 'Cartons' && qtyMode === 'ctn')}
                  />
                  {finishMode === 'Rolls' && isContinuousLength ? (
                    <TextField
                      label="Meters per roll"
                      type="number"
                      inputProps={{ min: 0, step: 'any' }}
                      value={metersPerRoll}
                      onChange={(e) => {
                        setQuoteUsesMoqOnly(false)
                        const raw = e.target.value
                        setMetersPerRoll(raw)
                        const mpr = Number(raw || 0)
                        const totalM =
                          quickPreview?.totals_m != null && Number.isFinite(Number(quickPreview.totals_m))
                            ? Number(quickPreview.totals_m)
                            : null
                        const totalKgSnap =
                          quickPreview?.totals_kg != null && Number.isFinite(Number(quickPreview.totals_kg))
                            ? Number(quickPreview.totals_kg)
                            : null
                        const kgPerM =
                          totalM != null && totalM > 0 && totalKgSnap != null && totalKgSnap > 0
                            ? totalKgSnap / totalM
                            : null
                        if (kgPerM != null && Number.isFinite(kgPerM) && kgPerM > 0 && mpr > 0) {
                          const wpr = mpr * kgPerM
                          if (Number.isFinite(wpr) && wpr > 0) {
                            setWeightPerRoll(roundTo2Decimals(String(wpr)))
                            const rcM = continuousRollCountForTotalKgSync()
                            if (rcM != null && rcM > 0) {
                              setTotalKg(formatKgDisplay(wpr * rcM))
                            }
                          }
                        }
                      }}
                    />
                  ) : null}
                </Box>
              </Stack>
              {quickPreview?.materials_moq_warning ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <Typography variant="body2" component="div">
                    {quickPreview.materials_moq_warning}
                  </Typography>
                  {(() => {
                    const warningText = String(quickPreview.materials_moq_warning || '')
                    const kgMatch = warningText.match(/at least\s+([0-9]+(?:\.[0-9]+)?)kg/i)
                    const minimumKg = kgMatch ? Number(kgMatch[1]) : null
                    if (!(minimumKg != null && Number.isFinite(minimumKg) && minimumKg > 0)) return null
                    return (
                      <Typography variant="body2" component="div" sx={{ mt: 0.75 }}>
                        Minimum total kg:{' '}
                        <Box component="span" sx={{ fontWeight: 700 }}>
                          {fmtQtyNumber(minimumKg, 2)}
                        </Box>
                      </Typography>
                    )
                  })()}
                  {quickPreview.materials_moq_minimum_hint?.kind === 'units' ? (
                    <Typography variant="body2" component="div" sx={{ mt: 0.75 }}>
                      Minimum {quickPreview.materials_moq_minimum_hint.nounPlural}:{' '}
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {fmtCount(quickPreview.materials_moq_minimum_hint.minimumTotal)}
                      </Box>
                    </Typography>
                  ) : quickPreview.materials_moq_minimum_hint?.kind === 'kg' ? (
                    <Typography variant="body2" component="div" sx={{ mt: 0.75 }}>
                      Minimum total kg:{' '}
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {fmtQtyNumber(quickPreview.materials_moq_minimum_hint.minimumTotalKg, 2)}
                      </Box>
                    </Typography>
                  ) : quickPreview.materials_moq_minimum_hint?.kind === 'rolls' ? (
                    <Typography variant="body2" component="div" sx={{ mt: 0.75 }}>
                      Minimum rolls:{' '}
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {fmtCount(quickPreview.materials_moq_minimum_hint.minimumTotalRolls)}
                      </Box>
                    </Typography>
                  ) : null}
                  {finishMode === 'Cartons' &&
                  quickPreview.materials_moq_minimum_hint?.kind === 'units' &&
                  bagsPerCartonNum > 0 ? (
                    <Typography variant="body2" component="div" sx={{ mt: 0.75 }}>
                      Minimum cartons:{' '}
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {fmtCount(Math.ceil(quickPreview.materials_moq_minimum_hint.minimumTotal / bagsPerCartonNum))}
                      </Box>
                    </Typography>
                  ) : null}
                </Alert>
              ) : null}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Run Requirements
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField defaultValue="13mm" label="Core Type" value={coreType} onChange={(e) => setCoreType(e.target.value)}>
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
                      value={rollWeightBilling}
                      onChange={(e) => setRollWeightBilling(e.target.value as any)}
                    >
                      <MenuItem value="core_included">Include core</MenuItem>
                      <MenuItem value="core_off">Exclude core</MenuItem>
                      <MenuItem value="core_half_off">Half core</MenuItem>
                    </DefaultSelectField>
                  ) : null}
                </Box>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Materials
              </Typography>
              <Stack spacing={2}>
                {resinBlendsErr && <Alert severity="warning">Resin blends unavailable: {resinBlendsErr}</Alert>}

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField
                    label="Resin Blend"
                    value={resinBlendCode}
                    defaultValue="LD"
                    onChange={(e) => setResinBlendCode(String(e.target.value || ''))}
                  >
                    {resinBlends.map((b) => (
                      <MenuItem key={b.blend_code} value={b.blend_code}>
                        {b.blend_code} — {b.name}
                      </MenuItem>
                    ))}
                  </DefaultSelectField>
                </Box>

                <MaterialsColoursAndAdditives
                  colourOptions={colourOptions}
                  additiveOptions={additiveOptions}
                  colourRows={colourRows}
                  onColourRowsChange={setColourRows}
                  additiveRows={additiveRows}
                  onAdditiveRowsChange={setAdditiveRows}
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Printing
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                <DefaultSelectField
                  defaultValue="None"
                  label="Printing Method"
                  value={printMethod}
                  onChange={(e) => onChangePrintMethod(e.target.value as any)}
                >
                  {printMethods.map((pm: string) => (
                    <MenuItem key={pm} value={pm}>
                      {pm}
                    </MenuItem>
                  ))}
                </DefaultSelectField>
                {showNumColours ? (
                  <TextField
                    label="Number of Colours"
                    type="number"
                    value={numColours}
                    onChange={(e) => {
                      setNumColours(e.target.value)
                      setDesiredNumColours(e.target.value)
                    }}
                  />
                ) : null}
              </Box>
              <PrintingUnavailableAlert message={printingErrorComputed} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Extrusion
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                <TextField
                  label="Extruder (for estimate)"
                  value={
                    selectedExtruder.extruder
                      ? `${selectedExtruder.extruder.extruder_code}. Decision Width: ${selectedExtruder.extruder.decision_width_mm ?? '—'}. Average output: ${
                          selectedExtruder.extruder.average_kg_hr ?? '—'
                        }kg/hr`
                      : ''
                  }
                  placeholder={ratebook?.extruders ? 'No suitable extruder' : 'Loading…'}
                  InputProps={{ readOnly: true }}
                  disabled
                  helperText={selectedExtruder.helperText}
                />
              </Box>

              {appliedExtrusionWasteFactors.length ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Applied waste factors
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Factor</TableCell>
                      <TableCell align="right">Time</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {appliedExtrusionWasteFactors.map((f) => (
                        <TableRow key={f.slug}>
                          <TableCell>{wasteFactorLabel(f.slug)}</TableCell>
                        <TableCell align="right">{fmtHoursMinutes(Number(f.minutes || 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : null}
              {quickPreview?.extrusion_hours != null &&
              Number.isFinite(Number(quickPreview.extrusion_hours)) &&
              Number(quickPreview.extrusion_hours) >= 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Extrusion estimate: {fmtHoursMinutesPreview(Number(quickPreview.extrusion_hours) * 60)}
                </Typography>
              ) : null}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Packaging
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField defaultValue="Chep" label="Pallet Type" value={palletType} onChange={(e) => setPalletType(e.target.value as any)}>
                    {(['Chep', 'Plain', 'Resin', 'None'] as const).map((v) => (
                      <MenuItem key={v} value={v}>
                        {v}
                      </MenuItem>
                    ))}
                  </DefaultSelectField>
                </Box>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Pricing
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
                  <Box sx={{ flex: '1 1 280px', minWidth: 200 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      Price per kg — optional override
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {qtyMode === 'kg' ? (
                        <>
                          Edit the <strong>$/kg</strong> cell in the Live Quote table (pencil). Values are rounded to 2
                          decimal places. When set, an Adjustments line keeps the job total aligned with this rate ×
                          billed kg.
                        </>
                      ) : (
                        <>
                          Edit the job <strong>unit price</strong> in the Live Quote table (pencil on the price column).
                          The form stores the equivalent <strong>$/kg</strong> override so the job total matches after
                          rounding.
                        </>
                      )}
                    </Typography>
                    {pricingOverrideDisplay != null ? (
                      <Typography variant="body1">Current override: {pricingOverrideDisplay}</Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No override — calculated retail applies.
                      </Typography>
                    )}
                  </Box>
                  <Button
                    variant="outlined"
                    sx={{ mt: 1 }}
                    disabled={
                      suggestedPricePerKg.trim() === '' ||
                      !Number.isFinite(Number(suggestedPricePerKg)) ||
                      Number(suggestedPricePerKg) <= 0
                    }
                    onClick={() => {
                      preserveLoadedPricePerKgRef.current = false
                      setSuggestedPricePerKg('')
                      setDirty(true)
                    }}
                  >
                    Use calculated price
                  </Button>
                </Box>

                <TextField
                  label="Notes"
                  multiline
                  minRows={4}
                  fullWidth
                  value={quoteNotes}
                  onChange={(e) => {
                    setQuoteNotes(e.target.value)
                    setDirty(true)
                  }}
                  placeholder="Optional notes for this quote…"
                />

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {renderQuoteActions()}
                </Box>
              </Stack>
            </Paper>
          </Stack>
        </Box>

        {!isMobile ? (
          <StickySideAside>
            <QuotePreviewPanel
              preview={quickPreview}
              loading={calcLoading}
              canCalculate={canCalculate}
              missing={missingForCalc}
              finishMode={finishMode}
              productType={productType}
              onClearPricePerKgOverride={clearPricePerKgOverride}
              emailQuoteTable={emailQuoteTable}
              materialsMoqLine={materialsMoqPanelLine}
              isContinuousLength={isContinuousLength}
              qtyMode={qtyMode}
              yieldPerEa={isContinuousLength && qtyType === 'units'}
              adjustmentsLockedRateLabel={adjustmentsLockedRateLabel}
              onApplyTableUnitPrice={qtyMode === 'kg' ? applyTableKgPriceOverride : applyTableUnitPriceOverride}
            />
          </StickySideAside>
        ) : null}
      </Box>

      {isMobile ? (
        <MobileFixedBottomAside>
          <QuotePreviewPanel
            preview={quickPreview}
            loading={calcLoading}
            canCalculate={canCalculate}
            missing={missingForCalc}
            finishMode={finishMode}
            productType={productType}
            onClearPricePerKgOverride={clearPricePerKgOverride}
            emailQuoteTable={emailQuoteTable}
            materialsMoqLine={materialsMoqPanelLine}
            isContinuousLength={isContinuousLength}
            qtyMode={qtyMode}
            yieldPerEa={isContinuousLength && qtyType === 'units'}
            adjustmentsLockedRateLabel={adjustmentsLockedRateLabel}
            onApplyTableUnitPrice={qtyMode === 'kg' ? applyTableKgPriceOverride : applyTableUnitPriceOverride}
          />
        </MobileFixedBottomAside>
      ) : null}

    </Stack>
  )
}


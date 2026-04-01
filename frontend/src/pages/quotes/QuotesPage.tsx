import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { createOrder } from '../../store/slices/ordersSlice'
import { createProduct } from '../../store/slices/productsSlice'
import {
  clearUpsertErrors,
  createSavedQuote,
  fetchQuoteRatebook,
  fetchQuoteResinBlends,
  fetchQuotesBootstrap,
  updateSavedQuote,
} from '../../store/slices/quotesSlice'
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { ColourOption } from '../../components/ColourSelect'
import type { AdditiveOption } from '../../components/AdditiveSelect'
import { MaterialsColoursAndAdditives } from '../../components/MaterialsColoursAndAdditives'
import { DefaultSelectField } from '../../components/DefaultSelectField'
import { productTypeCanHaveGusset } from '../../utils/specCompat'
import { computeProductCodeFromSpec } from '../../utils/productDescription'
import {
  computeAppliedExtrusionWasteFactors,
  computeDerivedGeometryAndTotals,
  computeLayflatWidthMm,
  computePrintingUnavailableReason,
  computeQuickQuotePreview,
  getBlendDensityKgPerM3,
  type AppliedExtrusionWasteFactor,
  type QuickQuoteInputs,
} from '../../utils/quoteCalculator'
import {
  buildSpecFromQuotePayload,
  getOrderQuantityFromQuotePayload,
} from '../../utils/quoteToSpec'
import { QuotePreviewPanel } from './components/QuotePreviewPanel'
import { MobileFixedBottomAside, StickySideAside } from '../../components/StickySideAside'
import { fmtHoursMinutes } from '../../utils/quoteFormat'

function formatKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

/** Round a numeric string to 2 decimal places for storage/display (Margin %, Price per KG). */
function roundTo2Decimals(s: string): string {
  if (s.trim() === '') return s
  const n = Number(s)
  return Number.isFinite(n) ? n.toFixed(2) : s
}

function fmtSavedQuoteDate(raw: string | null | undefined): string {
  if (!raw || String(raw).trim() === '') return '—'
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
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
  const skipNextMarginToPriceRef = useRef(false)
  const payloadForEditDetectionRef = useRef<Record<string, unknown>>({})

  // Quantity (four independent values; qtyType only controls which are editable vs computed)
  const [qtyType, setQtyType] = useState<'units' | 'kg' | 'total_rolls'>('kg')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')

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
  const [lengthUnits, setLengthUnits] = useState<'mm' | 'm'>('mm')
  const [length, setLength] = useState('')
  const [thicknessUm, setThicknessUm] = useState('')
  const [trimPctText, setTrimPctText] = useState<string>('')
  const [widthToleranceMmText, setWidthToleranceMmText] = useState<string>('')
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
  const [coreType, setCoreType] = useState('7mm')
  const [rollWeightBilling, setRollWeightBilling] = useState<'core_included' | 'core_off' | 'core_half_off'>('core_included')
  const [bagsPerCarton, setBagsPerCarton] = useState('')
  const [cartonOptionSlug, setCartonOptionSlug] = useState<string | null>(null)
  const [palletType, setPalletType] = useState<'Chep' | 'Plain' | 'Resin' | 'None'>('Chep')

  // Pricing: margin (%) and price per kg are linked; last-edited field drives the other to avoid loops.
  const [quickMargin, setQuickMargin] = useState('32')
  const [suggestedPricePerKg, setSuggestedPricePerKg] = useState('')
  const [priceDriver, setPriceDriver] = useState<'margin' | 'pricePerKg'>('margin')
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
    if (p.trim_pct != null) setTrimPctText(String(p.trim_pct))
    if (p.width_tolerance_mm != null) setWidthToleranceMmText(String(p.width_tolerance_mm))
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
      if (p.carton_option_slug != null) setCartonOptionSlug(p.carton_option_slug)
    }
    if (p.core_type != null) setCoreType(p.core_type)
    if (p.roll_weight_billing != null) setRollWeightBilling(p.roll_weight_billing)
    if (p.pallet_type != null) setPalletType(p.pallet_type)
    if (p.qtyType != null) setQtyType(p.qtyType)
    if (p.length != null) setLength(p.length)
    if (p.lengthUnits != null) setLengthUnits(p.lengthUnits === 'm' ? 'm' : 'mm')
    if (p.numUnits != null) setNumUnits(String(p.numUnits))
    if (p.numRolls != null) setNumRolls(String(p.numRolls))
    if (p.totalKg != null) setTotalKg(String(p.totalKg))
    if (p.weightPerRoll != null) setWeightPerRoll(String(p.weightPerRoll))
    if (p.quantity?.units != null) setNumUnits(String(p.quantity.units))
    if (p.quantity?.total_kg != null) setTotalKg(String(p.quantity.total_kg))
    if (p.quantity?.rolls != null) setNumRolls(String(p.quantity.rolls))
    if (p.flagPerforated != null) setFlagPerforated(!!p.flagPerforated)
    if (p.flagSealed != null) setFlagSealed(!!p.flagSealed)
    if (p.flagPunched != null) setFlagPunched(!!p.flagPunched)
    if (p.showNumColours != null) setFlagPrinted(!!p.showNumColours)
    // Prefer price_per_kg as source of truth on load; use saved margin from payload when present so we don't recompute (avoids two-way drift on save/reload).
    // Support string from API and number (legacy); round to 2dp for display.
    const pricePerKgNum = Number(initialData.price_per_kg)
    if (initialData.price_per_kg != null && initialData.price_per_kg !== '' && Number.isFinite(pricePerKgNum) && pricePerKgNum > 0) {
      setSuggestedPricePerKg(
        roundTo2Decimals(
          typeof initialData.price_per_kg === 'string' ? initialData.price_per_kg.trim() : String(initialData.price_per_kg)
        )
      )
      setPriceDriver('pricePerKg')
      preserveLoadedPricePerKgRef.current = true
      // Use saved margin string when present so both price and margin match exactly what was saved (no derivation/rounding).
      if (typeof p.requested_margin_pct_str === 'string' && p.requested_margin_pct_str.trim() !== '') {
        setQuickMargin(roundTo2Decimals(String(p.requested_margin_pct_str).trim()))
      } else {
        const cost =
          initialData.cost_per_kg != null &&
          initialData.cost_per_kg !== '' &&
          Number.isFinite(Number(initialData.cost_per_kg))
            ? Number(initialData.cost_per_kg)
            : null
        const price = pricePerKgNum
        if (cost != null && price > 0) {
          const marginPct = Math.max(0, Math.min(99.99, (1 - cost / price) * 100))
          setQuickMargin(roundTo2Decimals(String(marginPct)))
        } else if (p.requested_margin != null && Number.isFinite(Number(p.requested_margin))) {
          const pct = Number(p.requested_margin) * 100
          setQuickMargin(roundTo2Decimals(String(pct)))
        } else {
          setQuickMargin('')
        }
      }
    } else {
      preserveLoadedPricePerKgRef.current = false
      if (typeof p.requested_margin_pct_str === 'string' && p.requested_margin_pct_str.trim() !== '') {
        setQuickMargin(roundTo2Decimals(String(p.requested_margin_pct_str).trim()))
      } else if (p.requested_margin != null) {
        const pct = Number(p.requested_margin) * 100
        setQuickMargin(Number.isFinite(pct) ? roundTo2Decimals(String(pct)) : '')
      } else {
        setQuickMargin('')
      }
      setPriceDriver('margin')
    }
    setHydratedFromQuote(true)
  }, [initialData, hydratedFromQuote])

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  useEffect(() => {
    void dispatch(fetchQuoteResinBlends())
  }, [dispatch])

  useEffect(() => {
    const opts = ratebook?.carton_options
    if (!Array.isArray(opts) || opts.length === 0) return
    const defaultOpt = opts.find((o) => o?.is_default)
    if (defaultOpt && cartonOptionSlug === null) setCartonOptionSlug(defaultOpt.slug)
  }, [ratebook?.carton_options, cartonOptionSlug])

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

  const trimPct: number | null = useMemo(() => {
    const n = Number(trimPctText)
    return trimPctText.trim() === '' ? null : Number.isFinite(n) ? n : null
  }, [trimPctText])

  const widthToleranceMm: number | null = useMemo(() => {
    const n = Number(widthToleranceMmText)
    return widthToleranceMmText.trim() === '' ? null : Number.isFinite(n) ? n : null
  }, [widthToleranceMmText])

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

  const baseLengthMm = Math.round(toMm(length, lengthUnits))
  const widthMmNum = Math.round(Number(widthMm || 0))
  const ufilmLeftWidthMmNum = Math.round(Number(ufilmLeftWidthMm || 0))
  const ufilmRightWidthMmNum = Math.round(Number(ufilmRightWidthMm || 0))
  const thicknessUmNum = Math.round(Number(thicknessUm || 0))
  const gussetReturnMmNum = Math.round(Number(gussetReturnMm || 0))
  const totalKgNum = Number(totalKg || 0)
  const numUnitsNum = Math.round(Number(numUnits || 0))
  const numRollsNum = Math.round(Number(numRolls || 0))
  const weightPerRollNum = Number(weightPerRoll || 0)

  const showRunUp = !isUFilm && (productType === 'Sheet' || productType === 'Centerfold')
  const runUpOptions: number[] = productType === 'Centerfold' ? [1, 2] : productType === 'Sheet' ? [2, 4, 6] : [1]

  useEffect(() => {
    if (!showRunUp) {
      if (runUp !== 1) setRunUp(1)
      return
    }
    if (!runUpOptions.includes(runUp)) setRunUp(runUpOptions[0] || 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType, showRunUp])

  useEffect(() => {
    if (finishMode !== 'Rolls' && qtyType === 'total_rolls') setQtyType('kg')
  }, [finishMode, qtyType])

  const calcPayload = useMemo(() => {
    const qty: any = {}
    if (qtyType === 'units') qty.units = numUnitsNum
    if (qtyType === 'kg') {
      qty.total_kg = totalKgNum
      if (finishMode === 'Rolls' && totalKgNum > 0 && weightPerRollNum > 0) {
        qty.rolls = Math.round(totalKgNum / weightPerRollNum)
      }
    }
    if (qtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0) {
      qty.total_kg = numRollsNum * weightPerRollNum
      qty.rolls = numRollsNum
    } else if (finishMode === 'Rolls' && qtyType !== 'kg' && numRollsNum > 0) qty.rolls = numRollsNum

    if (qtyType === 'units' && numUnitsNum > 0 && baseLengthMm > 0) {
      // Provide total_m so printing/core costing can work for bag-style quotes.
      qty.total_m = (numUnitsNum * baseLengthMm) / 1000
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

    return {
      product_type: productType,
      geometry: derivedGeometry,
      base_width_mm: widthMmNum,
      run_up: showRunUp ? runUp : null,
      ufilm_left_width_mm: isUFilm ? ufilmLeftWidthMmNum : null,
      ufilm_right_width_mm: isUFilm ? ufilmRightWidthMmNum : null,
      thickness_um: thicknessUmNum,
      continuous_roll: false,
      base_length_mm: baseLengthMm,
      gusset_mm: canHaveGusset && flagGusset ? gussetReturnMmNum : null,
      length_units: lengthUnits,
      trim_pct: trimPct,
      width_tolerance_mm: widthToleranceMm,
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
      carton_option_slug: finishMode === 'Cartons' ? (cartonOptionSlug || null) : null,
      pallet_type: palletType,

      quantity: qty,
      requested_margin: Number(quickMargin || 0) / 100,
    }
  }, [
    additiveRows,
    baseLengthMm,
    bagsPerCarton,
    canHaveGusset,
    cartonOptionSlug,
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
    isUFilm,
    lengthUnits,
    numColours,
    palletType,
    printMethod,
    numRollsNum,
    numUnitsNum,
    qtyType,
    quickMargin,
    totalKgNum,
    weightPerRollNum,
    resinBlendCode,
    resinBlends,
    rollWeightBilling,
    showNumColours,
    showRunUp,
    thicknessUmNum,
    trimPct,
    widthToleranceMm,
    productType,
    runUp,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
  ])

  const derivedForDisplay = useMemo(() => {
    if (!ratebook || !calcPayload) return null
    try {
      const inputs: QuickQuoteInputs = {
        ...calcPayload,
        requested_margin: Number(calcPayload.requested_margin) || 0,
      }
      return computeDerivedGeometryAndTotals(inputs, ratebook)
    } catch {
      return null
    }
  }, [ratebook, calcPayload])

  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`

  const totalKgDisplay =
    qtyType === 'kg'
      ? totalKgNum
      : qtyType === 'units'
        ? (derivedForDisplay?.derivedTotalKg ?? null)
        : qtyType === 'total_rolls'
          ? (numRollsNum > 0 && weightPerRollNum > 0 ? numRollsNum * weightPerRollNum : null)
          : null
  const unitsDisplay =
    qtyType === 'units' ? numUnitsNum : (derivedForDisplay?.units != null ? derivedForDisplay.units : null)
  const rollsDisplay =
    finishMode === 'Rolls'
      ? qtyType === 'kg' && totalKgNum > 0 && weightPerRollNum > 0
        ? Math.round(totalKgNum / weightPerRollNum)
        : qtyType === 'units' && derivedForDisplay?.derivedTotalKg != null && weightPerRollNum > 0
          ? Math.round(derivedForDisplay.derivedTotalKg / weightPerRollNum)
          : numRollsNum
      : null
  const weightPerRollDisplay =
    qtyType === 'total_rolls'
      ? weightPerRollNum
      : finishMode === 'Rolls' && numRollsNum > 0 &&
          (derivedForDisplay?.billedKgPerRoll != null || derivedForDisplay?.kgPerRoll != null)
        ? (derivedForDisplay.billedKgPerRoll ?? derivedForDisplay.kgPerRoll)
        : null

  const totalKgEditable = qtyType === 'kg'
  const unitsEditable = qtyType === 'units'
  const rollsEditable = finishMode === 'Rolls' && qtyType === 'total_rolls'
  const weightPerRollEditable =
    finishMode === 'Rolls' &&
    (qtyType === 'total_rolls' || qtyType === 'units' || qtyType === 'kg')

  // Only show computed value when the inputs that drive it are set; otherwise keep showing the field's stored value (so changing Qty Type doesn't wipe the display).
  const haveDriverForTotalKg =
    (qtyType === 'units' && numUnitsNum > 0) || (qtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForUnits =
    (qtyType === 'kg' && totalKgNum > 0) ||
    (qtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    numRollsNum > 0 &&
    ((qtyType === 'kg' && totalKgNum > 0) || (qtyType === 'units' && numUnitsNum > 0))

  // Keep No. of units state in sync when it's computed (Total KG or Total Rolls mode), so switching to Units/Bags shows the value that was displayed instead of clearing it.
  useEffect(() => {
    if (
      qtyType !== 'units' &&
      derivedForDisplay?.units != null &&
      ((qtyType === 'kg' && totalKgNum > 0) ||
        (qtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0))
    ) {
      const computed = Math.round(Number(derivedForDisplay.units))
      setNumUnits(Number.isFinite(computed) && computed >= 0 ? String(computed) : '')
    }
  }, [qtyType, totalKgNum, numRollsNum, weightPerRollNum, derivedForDisplay?.units])

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
      requested_margin: Number(calcPayload.requested_margin || 0),
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
      carton_option_slug: calcPayload.carton_option_slug ?? null,
      core_type: calcPayload.core_type,
      roll_weight_billing: calcPayload.roll_weight_billing != null ? calcPayload.roll_weight_billing : null,
      extruder_code: selectedExtruder.extruder?.extruder_code || null,
      colour_components: calcPayload.colour_components,
      additives: calcPayload.additives,
      blend: calcPayload.blend,
      resin_code: calcPayload.resin_code,
      quantity: calcPayload.quantity || {},
    }),
    [calcPayload],
  )

  /** Full form state for persisting; used to re-hydrate on edit. */
  const payloadForSave = useMemo(
    () => ({
      ...calcPayload,
      requested_margin_pct_str: quickMargin,
      qtyType,
      length,
      lengthUnits,
      numUnits,
      numRolls,
      totalKg,
      weightPerRoll,
      colourRows,
      additiveRows,
      resinBlendCode,
      coreType,
      rollWeightBilling,
      bagsPerCarton,
      cartonOptionSlug,
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
    }),
    [
      calcPayload,
      quickMargin,
      qtyType,
      length,
      lengthUnits,
      numUnits,
      numRolls,
      totalKg,
      weightPerRoll,
      colourRows,
      additiveRows,
      resinBlendCode,
      coreType,
      rollWeightBilling,
      bagsPerCarton,
      cartonOptionSlug,
      palletType,
      flagPerforated,
      flagSealed,
      flagPunched,
      desiredNumColours,
      numColours,
      flagPrinted,
      quickPreview?.totals_kg,
      quickPreview?.final_price,
    ],
  )

  // For edit-mode "did user edit the spec?" we exclude pricing (requested_margin, requested_margin_pct_str) so that updating Price per KG → margin sync doesn't trigger a switch to margin driver.
  // Also exclude quoted_totals_kg / quoted_total_price (calculator snapshots) so rate recalculations don't look like a spec edit.
  const payloadForEditDetection = useMemo(() => {
    const {
      requested_margin: _rm,
      requested_margin_pct_str: _rmStr,
      quoted_totals_kg: _qtk,
      quoted_total_price: _qtp,
      ...rest
    } = payloadForSave as {
      requested_margin?: number
      requested_margin_pct_str?: string
      quoted_totals_kg?: unknown
      quoted_total_price?: unknown
      [k: string]: unknown
    }
    return rest
  }, [payloadForSave])
  payloadForEditDetectionRef.current = payloadForEditDetection

  // Edit mode: capture payload snapshot for edit-detection only after pricing inputs are available and defaults
  // (resin blend list, carton slug, etc.) have settled. Otherwise a full tab refresh can normalize the form after the
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
    cartonOptionSlug,
  ])

  // Edit mode: when user edits the form spec (not just margin/price), switch to margin-as-driver so margin is maintained and price per kg updates
  useEffect(() => {
    if (
      isEditMode &&
      hydratedFromQuote &&
      initialPayloadSnapshotRef.current != null &&
      JSON.stringify(payloadForEditDetection) !== initialPayloadSnapshotRef.current
    ) {
      preserveLoadedPricePerKgRef.current = false
      setPriceDriver('margin')
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

  const canCalculate =
    (qtyType === 'total_rolls'
      ? numRollsNum > 0 && weightPerRollNum > 0
      : qtyType === 'units'
        ? numUnitsNum > 0
        : qtyType === 'kg'
          ? totalKg.trim() !== '' && (finishMode !== 'Rolls' || weightPerRollNum > 0)
          : false) &&
    widthMmNum > 0 &&
    (!isUFilm || (ufilmLeftWidthMmNum > 0 && ufilmRightWidthMmNum > 0)) &&
    thicknessUmNum > 0 &&
    baseLengthMm > 0 &&
    (!(canHaveGusset && flagGusset) || gussetReturnMmNum > 0) &&
    (!flagPrinted || (printMethod !== 'None' && (Number(numColours || 0) >= 1 || !!printingErrorComputed))) &&
    (finishMode !== 'Cartons' || Number(bagsPerCarton || 0) >= 1)

  const missingForCalc = useMemo(() => {
    const missing: string[] = []
    if (!ratebook) missing.push('Pricing rates')
    if (qtyType === 'units' && !(numUnitsNum > 0))
      missing.push(
        `No. of ${productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : productType + 's'}`
      )
    else if (qtyType === 'kg') {
      if (!(totalKgNum > 0)) missing.push('Total KG')
      if (finishMode === 'Rolls' && !(weightPerRollNum > 0)) missing.push('Weight per roll')
    }
    else if (qtyType === 'total_rolls') {
      if (!(numRollsNum > 0)) missing.push('No. of Rolls')
      if (!(weightPerRollNum > 0)) missing.push('Weight per roll')
    }
    if (!(widthMmNum > 0)) missing.push(`${productType} Width`)
    if (isUFilm && !(ufilmLeftWidthMmNum > 0)) missing.push('U-Film Left Width')
    if (isUFilm && !(ufilmRightWidthMmNum > 0)) missing.push('U-Film Right Width')
    if (!(thicknessUmNum > 0)) missing.push('Gauge')
    if (!(baseLengthMm > 0)) missing.push('Length')
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
    isUFilm,
    numColours,
    printMethod,
    printingErrorComputed,
    numRollsNum,
    numUnitsNum,
    productType,
    qtyType,
    ratebook,
    totalKgNum,
    weightPerRollNum,
    showNumColours,
    thicknessUmNum,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
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

  const lastPayloadKeyRef = useRef<string>('')

  function payloadToInputs(payload: any): QuickQuoteInputs {
    return {
      requested_margin: Number(payload.requested_margin || 0),
      product_type: payload.product_type,
      geometry: payload.geometry,
      base_width_mm: Number(payload.base_width_mm || 0),
      ufilm_left_width_mm: payload.ufilm_left_width_mm != null ? Number(payload.ufilm_left_width_mm) : null,
      ufilm_right_width_mm: payload.ufilm_right_width_mm != null ? Number(payload.ufilm_right_width_mm) : null,
      thickness_um: Number(payload.thickness_um || 0),
      base_length_mm: Number(payload.base_length_mm || 0),
      continuous_roll: !!payload.continuous_roll,
      inline_perforation: !!payload.inline_perforation,
      inline_seal: !!payload.inline_seal,
      hole_punched: !!payload.hole_punched,
      gusset_mm: payload.gusset_mm != null ? Number(payload.gusset_mm) : null,
      trim_pct: payload.trim_pct != null ? Number(payload.trim_pct) : null,
      resin_blend_code: payload.resin_blend_code != null ? String(payload.resin_blend_code) : null,
      print_method: payload.print_method,
      num_colours: Number(payload.num_colours || 0),
      finish_mode: payload.finish_mode,
      bags_per_carton: payload.bags_per_carton != null ? Number(payload.bags_per_carton) : null,
      carton_option_slug: payload.carton_option_slug ?? null,
      core_type: payload.core_type,
      roll_weight_billing: payload.roll_weight_billing != null ? payload.roll_weight_billing : null,
      colour_components: payload.colour_components,
      additives: payload.additives,
      blend: payload.blend,
      resin_code: payload.resin_code,
      quantity: payload.quantity || {},
    }
  }

  function calcQuick(payloadOverride?: any) {
    if (!ratebook) {
      setQuickPreview(null)
      return
    }
    const payload = payloadOverride || calcPayload
    try {
      const inputs = payloadOverride ? payloadToInputs(payload) : calcInputs
      if (payloadOverride) inputs.extruder_code = selectedExtruder.extruder?.extruder_code || null
      const res = computeQuickQuotePreview(inputs, ratebook)
      setQuickPreview(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to calculate quick quote')
      setQuickPreview(null)
    }
  }

  useEffect(() => {
    if (!canCalculate || !ratebook) {
      setQuickPreview(null)
      return
    }
    const key = JSON.stringify(calcPayload)
    if (key === lastPayloadKeyRef.current) return
    const t = window.setTimeout(() => {
      lastPayloadKeyRef.current = key
      setCalcLoading(true)
      try {
        calcQuick(calcPayload)
      } finally {
        setCalcLoading(false)
      }
    }, 450)
    return () => window.clearTimeout(t)
    // finishMode included so changing Roll/Carton always triggers recalc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate, calcPayload, ratebook, finishMode])

  // When margin is the driver, sync price-per-kg from the result. Skip when we just loaded price_per_kg or just switched from it (wait for recalc with new margin).
  useEffect(() => {
    if (priceDriver !== 'margin') return
    if (preserveLoadedPricePerKgRef.current) return
    if (skipNextMarginToPriceRef.current) {
      skipNextMarginToPriceRef.current = false
      return
    }
    const p = quickPreview
    if (!p || typeof p.totals_kg !== 'number' || p.totals_kg <= 0) return
    const fp = Number(p.final_price)
    if (Number.isFinite(fp)) setSuggestedPricePerKg(roundTo2Decimals(String(fp / p.totals_kg)))
  }, [quickPreview, priceDriver])

  // When price-per-kg is the driver and we have a result, sync margin from (total_cost, price, totals_kg).
  // If we just loaded a saved quote with price_per_kg: recompute margin from this result once, then switch to margin-as-driver so subsequent recalc uses that margin.
  useEffect(() => {
    if (priceDriver !== 'pricePerKg') return
    const priceKg = Number(suggestedPricePerKg)
    if (!Number.isFinite(priceKg) || priceKg <= 0) return
    const p = quickPreview
    if (!p || typeof p.totals_kg !== 'number' || p.totals_kg <= 0) return
    const totalCost = Number(p.total_cost)
    if (!Number.isFinite(totalCost)) return
    const margin = 1 - totalCost / (priceKg * p.totals_kg)
    const pct = Math.max(0, Math.min(99.99, margin * 100))
    const next = roundTo2Decimals(String(pct))
    if (next !== quickMargin) setQuickMargin(next)
    if (preserveLoadedPricePerKgRef.current) {
      preserveLoadedPricePerKgRef.current = false
      skipNextMarginToPriceRef.current = true
      setPriceDriver('margin')
    }
  }, [quickPreview, priceDriver, suggestedPricePerKg, quickMargin])

  const estimatedPallets = useMemo(() => {
    if (!ratebook || !quickPreview?.totals_kg || Number(quickPreview.totals_kg) <= 0 || !calcPayload) return null
    const totalsKg = Number(quickPreview.totals_kg)
    const density = getBlendDensityKgPerM3(calcPayload as QuickQuoteInputs, ratebook)
    const totalVolumeM3 = totalsKg / density
    const packingFactor =
      finishMode === 'Rolls' ? (ratebook.packing_factor_rolls ?? 0.7) : (ratebook.packing_factor_cartons ?? 0.5)
    const packedVolumeM3 = totalVolumeM3 / packingFactor
    const palletVol = ratebook.pallet_volume_m3 ?? 1
    return Math.ceil(packedVolumeM3 / palletVol)
  }, [ratebook, quickPreview?.totals_kg, finishMode, calcPayload])

  const customers = bootstrap?.customers ?? []
  const costPerKgForSave =
    quickPreview?.cost_per_kg != null && Number.isFinite(Number(quickPreview.cost_per_kg))
      ? Number(quickPreview.cost_per_kg)
      : null
  const pricePerKgForSave =
    suggestedPricePerKg.trim() !== '' && Number.isFinite(Number(suggestedPricePerKg))
      ? Number(suggestedPricePerKg)
      : quickPreview?.totals_kg > 0 && quickPreview?.final_price != null
        ? Number(quickPreview.final_price) / Number(quickPreview.totals_kg)
        : null

  const { setDirty } = useUnsavedChanges()

  const [converting, setConverting] = useState(false)
  const [convertErr, setConvertErr] = useState<string | null>(null)

  async function handleConvertToOrder() {
    if (!customerId.trim() || !canCalculate) {
      setConvertErr('Select a customer and complete the quote fields before converting to order.')
      return
    }
    setConvertErr(null)
    setConverting(true)
    try {
      const suffix = quoteId
        ? `${String(quoteId).slice(0, 8)}-${Date.now().toString(36).slice(-4)}`
        : Date.now().toString(36)

      const spec = buildSpecFromQuotePayload(payloadForSave as any)
      const fromSpec = (computeProductCodeFromSpec(spec) || '').trim()
      const productCode = fromSpec || `Q-${suffix}`
      const createProductRes = await dispatch(
        createProduct({
          data: {
            customer_id: customerId,
            code: productCode,
            spec,
          },
        }),
      ).unwrap()
      const productId = createProductRes?.product?.id
      if (!productId) {
        setConvertErr('Failed to create product')
        return
      }

      const qty = getOrderQuantityFromQuotePayload(payloadForSave as any)
      const pricePerKg = pricePerKgForSave != null ? Number(pricePerKgForSave) : null
      const totalKg = quickPreview?.totals_kg != null ? Number(quickPreview.totals_kg) : null
      const rate = pricePerKg
      const totalPrice = totalKg != null && pricePerKg != null ? totalKg * pricePerKg : null

      const today = new Date()
      const orderDate = today.toISOString().slice(0, 10)
      const dueDate = new Date(today)
      dueDate.setDate(dueDate.getDate() + 28)
      const dueDateStr = dueDate.toISOString().slice(0, 10)

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
          },
        ],
      }
      if (quoteId) orderPayload.quote_id = quoteId

      const createOrderRes = await dispatch(createOrder(orderPayload)).unwrap()
      const orderId = createOrderRes?.order_id
      if (!orderId) {
        setConvertErr('Failed to create order')
        return
      }
      setDirty(false)
      navigate(`/orders/${orderId}/edit`, { replace: true })
    } catch (e) {
      setConvertErr(e instanceof Error ? e.message : 'Convert to order failed')
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
      } else {
        const quote = await dispatch(
          createSavedQuote({
            customer_id: customerId.trim(),
            payload: payloadForSave,
            cost_per_kg: costPerKgForSave,
            price_per_kg: pricePerKgForSave,
          }),
        ).unwrap()
        setDirty(false)
        navigate(`/quotes/${quote.id}/edit`)
      }
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
          disabled={converting || !customerId.trim() || !canCalculate}
          onClick={() => void handleConvertToOrder()}
        >
          {converting ? 'Converting…' : 'Convert to order'}
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
          <TextField
            select
            size="small"
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={isEditMode}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">— Select customer —</MenuItem>
            {customers.map((c: { id: string; code?: string | null; name: string }) => (
              <MenuItem key={c.id} value={c.id}>
                {c.code ? `${c.code} – ${c.name}` : c.name}
              </MenuItem>
            ))}
          </TextField>
          {isEditMode ? (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              Created: {fmtSavedQuoteDate(initialData?.created_at)}
              {initialData?.updated_at ? ` · Edited: ${fmtSavedQuoteDate(initialData.updated_at)}` : ''}
            </Typography>
          ) : null}
        </Box>
      </Paper>

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
                Quantity
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                  <DefaultSelectField defaultValue="kg" label="Qty Type" value={qtyType} onChange={(e) => setQtyType(e.target.value as any)}>
                    <MenuItem value="units">{productUnitLabel} (Units)</MenuItem>
                    <MenuItem value="kg">Total KG</MenuItem>
                    {finishMode === 'Rolls' ? <MenuItem value="total_rolls">Total Rolls</MenuItem> : null}
                  </DefaultSelectField>
                </Box>
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
                    onChange={totalKgEditable ? (e) => setTotalKg(e.target.value) : undefined}
                    disabled={!totalKgEditable}
                  />
                  <TextField
                    label={`No. of ${productUnitLabel}`}
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    value={
                      unitsEditable
                        ? numUnits
                        : (haveDriverForUnits && unitsDisplay != null ? unitsDisplay : numUnits)
                    }
                    onChange={unitsEditable ? (e) => setNumUnits(e.target.value) : undefined}
                    disabled={!unitsEditable}
                  />
                  <TextField
                    label="Weight per Roll (kg)"
                    type="number"
                    inputProps={{ min: 0, step: 'any' }}
                    value={
                      weightPerRollEditable
                        ? weightPerRoll
                        : (haveDriverForWeightPerRoll && weightPerRollDisplay != null
                          ? formatKgDisplay(weightPerRollDisplay)
                          : finishMode === 'Cartons'
                            ? '—'
                            : weightPerRoll !== '' && Number.isFinite(Number(weightPerRoll))
                              ? formatKgDisplay(Number(weightPerRoll))
                              : weightPerRoll)
                    }
                    onChange={weightPerRollEditable ? (e) => setWeightPerRoll(e.target.value) : undefined}
                    disabled={!weightPerRollEditable}
                  />
                  <TextField
                    label="No. of Rolls"
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    value={
                      rollsEditable
                        ? numRolls
                        : (rollsDisplay != null ? rollsDisplay : finishMode === 'Cartons' ? '—' : numRolls)
                    }
                    onChange={rollsEditable ? (e) => setNumRolls(e.target.value) : undefined}
                    disabled={!rollsEditable}
                  />
                </Box>
              </Stack>
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
                  <DefaultSelectField label="Length Units" value={lengthUnits} defaultValue="mm" onChange={(e) => setLengthUnits(e.target.value as any)}>
                    <MenuItem value="mm">mm</MenuItem>
                    <MenuItem value="m">m</MenuItem>
                  </DefaultSelectField>
                  <TextField label="Length" type="number" value={length} onChange={(e) => setLength(e.target.value)} />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 1fr)', gap: 2 }}>
                  <TextField label="Thickness / Gauge (µm)" type="number" value={thicknessUm} onChange={(e) => setThicknessUm(e.target.value)} />
                </Box>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Run Requirements
              </Typography>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField defaultValue="7mm" label="Core Type" value={coreType} onChange={(e) => setCoreType(e.target.value)}>
                    {['7mm', '13mm', 'PVC', 'None'].map((v) => (
                      <MenuItem key={v} value={v}>
                        {v}
                      </MenuItem>
                    ))}
                  </DefaultSelectField>
                  {finishMode === 'Cartons' ? (
                    <TextField
                      label="Bags per Carton"
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={bagsPerCarton}
                      onChange={(e) => setBagsPerCarton(e.target.value)}
                    />
                  ) : (
                    <DefaultSelectField
                      label="Roll weight billing"
                      defaultValue="core_included"
                      value={rollWeightBilling}
                      onChange={(e) => setRollWeightBilling(e.target.value as any)}
                    >
                      <MenuItem value="core_included">Include core</MenuItem>
                      <MenuItem value="core_off">Exclude core</MenuItem>
                      <MenuItem value="core_half_off">Half core</MenuItem>
                    </DefaultSelectField>
                  )}
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Trim (%)"
                    type="number"
                    inputProps={{ min: 0, step: 0.1 }}
                    value={trimPctText}
                    onChange={(e) => setTrimPctText(e.target.value)}
                  />
                  <TextField
                    label="Tolerance (mm)"
                    type="number"
                    inputProps={{ min: 0, step: 0.1 }}
                    value={widthToleranceMmText}
                    onChange={(e) => setWidthToleranceMmText(e.target.value)}
                  />
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
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Packaging
              </Typography>
              <Stack spacing={2}>
                {finishMode === 'Cartons' && ratebook?.carton_options && ratebook.carton_options.length > 0 ? (
                  <DefaultSelectField
                    label="Carton option"
                    defaultValue={ratebook.carton_options.find((o) => o.is_default)?.slug ?? ratebook.carton_options[0]?.slug ?? ''}
                    value={cartonOptionSlug ?? (ratebook.carton_options.find((o) => o.is_default)?.slug ?? ratebook.carton_options[0]?.slug ?? '')}
                    onChange={(e) => setCartonOptionSlug(e.target.value || null)}
                  >
                    <MenuItem value="">—</MenuItem>
                    {ratebook.carton_options.map((opt) => (
                      <MenuItem key={opt.slug} value={opt.slug}>
                        {opt.name} (${Number(opt.cost_per_unit).toFixed(2)})
                      </MenuItem>
                    ))}
                  </DefaultSelectField>
                ) : null}

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
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Margin (%)"
                    type="number"
                    inputProps={{ min: 0, max: 100, step: 0.01 }}
                    value={quickMargin}
                    onBlur={() => setQuickMargin((m) => roundTo2Decimals(m))}
                    onChange={(e) => {
                      preserveLoadedPricePerKgRef.current = false
                      setQuickMargin(e.target.value)
                      setPriceDriver('margin')
                    }}
                  />
                  <TextField
                    label="Price per kg ($)"
                    type="number"
                    inputProps={{ min: 0, step: 0.01 }}
                    value={suggestedPricePerKg}
                    onBlur={() => setSuggestedPricePerKg((p) => roundTo2Decimals(p))}
                    onChange={(e) => {
                      preserveLoadedPricePerKgRef.current = false
                      const v = e.target.value
                      setSuggestedPricePerKg(v)
                      setPriceDriver('pricePerKg')
                      const priceKg = Number(v)
                      const p = quickPreview
                      if (Number.isFinite(priceKg) && priceKg > 0 && p && typeof p.totals_kg === 'number' && p.totals_kg > 0) {
                        const totalCost = Number(p.total_cost)
                        if (Number.isFinite(totalCost)) {
                          const margin = 1 - totalCost / (priceKg * p.totals_kg)
                          const pct = Math.max(0, Math.min(99.99, margin * 100))
                          setQuickMargin(roundTo2Decimals(String(pct)))
                        }
                      }
                    }}
                    helperText="Edit either field; the other updates from the quote result."
                  />
                </Box>

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
              estimatedPallets={estimatedPallets}
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
            estimatedPallets={estimatedPallets}
          />
        </MobileFixedBottomAside>
      ) : null}
    </Stack>
  )
}


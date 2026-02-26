import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../api/client'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
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
import { ColourSelect, type ColourOption } from '../components/ColourSelect'
import { AdditiveSelect, type AdditiveOption } from '../components/AdditiveSelect'
import { defaultRowSx, isDefaultRow } from '../components/DefaultRowTable'
import { DefaultSelectField } from '../components/DefaultSelectField'
import { productTypeCanHaveGusset } from '../utils/specCompat'
import {
  computeAppliedExtrusionWasteFactors,
  computeLayflatWidthMm,
  computePrintingUnavailableReason,
  computeQuickQuotePreview,
  type AppliedExtrusionWasteFactor,
  type QuickQuoteInputs,
  type QuoteRatebook,
} from '../utils/quoteCalculator'

function fmtDollars(v: any, dp: number = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `$${n.toFixed(dp)}`
}

type ResinBlendPreset = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
}

function QuotePreview(props: {
  preview: any
  loading: boolean
  canCalculate: boolean
  missing: string[]
  finishMode: 'Rolls' | 'Cartons'
}) {
  const { preview, loading, canCalculate, missing, finishMode } = props
  const p = preview
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Live Quote</Typography>
        <Typography variant="caption" color="text.secondary">
          {loading ? 'Calculating…' : p ? 'Up to date' : canCalculate ? 'Ready' : 'Incomplete'}
        </Typography>
      </Box>

      {!p ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {canCalculate ? 'Ready to calculate.' : 'Add more details to see pricing.'}
          </Typography>
          {missing.length ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Missing: {missing.join(', ')}
            </Typography>
          ) : null}
        </Box>
      ) : (
        <>
          <Box sx={{ mt: 1 }}>
            {(() => {
              const kgPerUnit =
                p.kg_per_unit != null
                  ? Number(p.kg_per_unit)
                  : Number(p.totals_units || 0) > 0 && p.totals_kg != null
                    ? Number(p.totals_kg) / Number(p.totals_units || 1)
                    : null
              const kgPer1000 = kgPerUnit != null && Number.isFinite(kgPerUnit) ? kgPerUnit * 1000 : null
              if (kgPer1000 == null || !Number.isFinite(kgPer1000)) return null
              return (
                <Typography variant="body2">
                  Yield estimate: {kgPer1000.toFixed(2)} kg / 1000 products
                </Typography>
              )
            })()}
            {p.cost_per_kg != null && (
              <Typography variant="body2">
                Cost / kg: {fmtDollars(p.cost_per_kg)}
              </Typography>
            )}
            {p.extrusion_hours != null ? (
              <Typography variant="body2">
                Extrusion time: {Number(p.extrusion_hours).toFixed(2)} hr
              </Typography>
            ) : null}
            {Number(p.extrusion_waste_minutes || 0) > 0 ? (
              <Typography variant="body2">
                Wasted extrusion minutes: {Math.round(Number(p.extrusion_waste_minutes || 0))} min
              </Typography>
            ) : null}
            {finishMode === 'Rolls' && p.kg_per_roll != null && (
              <Typography variant="body2">
                Weight / Roll: {Number(p.kg_per_roll).toFixed(2)} kg
              </Typography>
            )}
            {finishMode === 'Rolls' && p.m_per_roll != null && (
              <Typography variant="body2">
                Meters / Roll: {Number(p.m_per_roll).toFixed(2)} m
              </Typography>
            )}
            {p.unit_price != null && (
              <Typography variant="body2">
                Unit price: {fmtDollars(p.unit_price, 4)}
              </Typography>
            )}
            {p.cartons != null && (
              <Typography variant="body2">
                Cartons: {Number(p.cartons)}
                {p.kg_per_carton != null ? ` (${Number(p.kg_per_carton).toFixed(2)} kg/carton)` : ''}
              </Typography>
            )}
            {p.conversion_minutes_total != null && (
              <Typography variant="body2">
                Conversion time: {Number(p.conversion_minutes_total).toFixed(1)} min
                {p.conversion_minutes_run != null && p.conversion_minutes_roll_changes != null
                  ? ` (run ${Number(p.conversion_minutes_run).toFixed(1)} + roll changes ${Number(p.conversion_minutes_roll_changes).toFixed(1)})`
                  : ''}
              </Typography>
            )}
            {p.carton_cost_total != null && Number(p.carton_cost_total || 0) > 0 && (
              <Typography variant="body2">Carton cost: {fmtDollars(p.carton_cost_total)}</Typography>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Breakdown
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Stage</TableCell>
                <TableCell>Cost</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Material</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.material_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Extrusion</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.extrusion_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Printing</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.printing_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Conversion</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.conversion_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Core</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.core_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Waste</TableCell>
                <TableCell>{fmtDollars(p.cost_breakdown?.waste_cost)}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell colSpan={2} sx={{ py: 0.5 }} />
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Total cost</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{fmtDollars(p.total_cost)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Margin (%)</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{Math.round(Number(p.margin || 0) * 100)}%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Suggested price</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{fmtDollars(p.final_price)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Suggested price / kg</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>
                  {Number(p.totals_kg || 0) > 0 ? fmtDollars(Number(p.final_price || 0) / Number(p.totals_kg || 1)) : '—'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </Paper>
  )
}

export function QuotesPage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [bootstrap, setBootstrap] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ratebook, setRatebook] = useState<QuoteRatebook | null>(null)
  const [ratebookErr, setRatebookErr] = useState<string | null>(null)

  // Quantity
  const [qtyType, setQtyType] = useState<'units' | 'kg'>('kg')
  const [qtyTotal, setQtyTotal] = useState('')
  const [qtyRolls, setQtyRolls] = useState('')

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
  const [runUp, setRunUp] = useState<number>(1)

  // Materials
  const [resinBlends, setResinBlends] = useState<ResinBlendPreset[]>([])
  const [resinBlendsErr, setResinBlendsErr] = useState<string | null>(null)
  const [resinBlendCode, setResinBlendCode] = useState<string>('LD')
  const [colourRows, setColourRows] = useState<Array<{ colour_code: string; strength_pct: string }>>([
    { colour_code: 'WHITE', strength_pct: '' },
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
  const [palletType, setPalletType] = useState<'Chep' | 'Plain' | 'Resin' | 'None'>('Chep')

  // Pricing
  const [quickMargin, setQuickMargin] = useState('0.20')
  const [quickPreview, setQuickPreview] = useState<any>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [printingError, setPrintingError] = useState<string | null>(null)

  const showNumColours = printMethod && printMethod !== 'None'
  const canHaveGusset = productTypeCanHaveGusset(productType)
  const isUFilm = productType === 'U-Film'
  const derivedGeometry: 'Flat' | 'Gusset' = canHaveGusset && flagGusset ? 'Gusset' : 'Flat'

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        const b = await apiFetch<any>('/api/quotes/bootstrap')
        setBootstrap(b)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load quote data')
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setRatebookErr(null)
        const rb = await apiFetch<QuoteRatebook>('/api/rate-cards/ratebook')
        setRatebook(rb)
      } catch (e) {
        setRatebookErr(e instanceof Error ? e.message : 'Failed to load pricing rates')
        setRatebook(null)
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setResinBlendsErr(null)
        const rows = await apiFetch<ResinBlendPreset[]>('/api/rate-cards/resin-blends')
        if (cancelled) return
        setResinBlends(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setResinBlendsErr(e instanceof Error ? e.message : 'Failed to load resin blends')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
  const qtyUnitsNum = Math.round(Number(qtyTotal || 0))
  const qtyKgNum = Number(qtyTotal || 0)
  const qtyRollsNum = Math.round(Number(qtyRolls || 0))

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

  const canCalculate =
    (qtyType === 'units' ? Number(qtyTotal || 0) > 0 : !!qtyTotal) &&
    widthMmNum > 0 &&
    (!isUFilm || (ufilmLeftWidthMmNum > 0 && ufilmRightWidthMmNum > 0)) &&
    thicknessUmNum > 0 &&
    baseLengthMm > 0 &&
    (!(canHaveGusset && flagGusset) || gussetReturnMmNum > 0) &&
    (!flagPrinted || (printMethod !== 'None' && (Number(numColours || 0) >= 1 || !!printingError))) &&
    (finishMode !== 'Cartons' || Number(bagsPerCarton || 0) >= 1)

  const missingForCalc = useMemo(() => {
    const missing: string[] = []
    if (!ratebook) missing.push('Pricing rates')
    if (!(qtyType === 'units' ? qtyUnitsNum > 0 : qtyKgNum > 0)) missing.push(qtyType === 'units' ? 'Total Bags' : 'Total KG')
    if (!(widthMmNum > 0)) missing.push('Width')
    if (isUFilm && !(ufilmLeftWidthMmNum > 0)) missing.push('U-Film Left Width')
    if (isUFilm && !(ufilmRightWidthMmNum > 0)) missing.push('U-Film Right Width')
    if (!(thicknessUmNum > 0)) missing.push('Gauge')
    if (!(baseLengthMm > 0)) missing.push('Length')
    if (canHaveGusset && flagGusset && !(gussetReturnMmNum > 0)) missing.push('Gusset Return')
    if (flagPrinted && !(printMethod !== 'None')) missing.push('Print Method')
    if (flagPrinted && showNumColours && !(Number(numColours || 0) >= 1) && !printingError) missing.push('No. Colours')
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
    printingError,
    qtyKgNum,
    qtyType,
    qtyUnitsNum,
    ratebook,
    showNumColours,
    thicknessUmNum,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
  ])

  const calcPayload = useMemo(() => {
    const qty: any = {}
    if (qtyType === 'units') qty.units = qtyUnitsNum
    if (qtyType === 'kg') qty.total_kg = Number(qtyTotal || 0)
    if (finishMode === 'Rolls' && qtyRollsNum > 0) qty.rolls = qtyRollsNum

    if (qtyType === 'units' && qtyUnitsNum > 0 && baseLengthMm > 0) {
      // Provide total_m so printing/core costing can work for bag-style quotes.
      qty.total_m = (Number(qtyUnitsNum) * baseLengthMm) / 1000
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
      core_type: finishMode === 'Rolls' ? coreType : null,
      roll_weight_billing: finishMode === 'Rolls' ? rollWeightBilling : null,
      bags_per_carton: finishMode === 'Cartons' ? (bagsPerCarton ? Number(bagsPerCarton) : null) : null,
      pallet_type: palletType,

      quantity: qty,
      requested_margin: quickMargin,
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
    isUFilm,
    lengthUnits,
    numColours,
    palletType,
    printMethod,
    qtyTotal,
    qtyRollsNum,
    qtyType,
    qtyUnitsNum,
    quickMargin,
    resinBlendCode,
    resinBlends,
    rollWeightBilling,
    showNumColours,
    showRunUp,
    thicknessUmNum,
    trimPct,
    productType,
    runUp,
    ufilmLeftWidthMmNum,
    ufilmRightWidthMmNum,
    widthMmNum,
  ])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate, calcPayload, ratebook])

  const printingErrorComputed: string | null = useMemo(() => {
    if (!ratebook) return null
    if (!flagPrinted || printMethod === 'None') return null
    const desired = Number(desiredNumColours || 0)
    if (!Number.isFinite(desired) || desired < 1) return null
    const inputsForPrint: QuickQuoteInputs = {
      ...calcInputs,
      print_method: printMethod,
      num_colours: desired,
    }
    return computePrintingUnavailableReason(inputsForPrint, ratebook)
  }, [calcInputs, desiredNumColours, flagPrinted, printMethod, ratebook])

  useEffect(() => {
    if (printingErrorComputed) {
      setPrintingError(printingErrorComputed)
      if (numColours !== '0') setNumColours('0')
      return
    }

    setPrintingError(null)

    // If the error cleared, restore the user's desired value so printing resumes automatically.
    if (flagPrinted && printMethod !== 'None') {
      const desired = desiredNumColours.trim()
      if (numColours === '0' && Number(desired || 0) >= 1) setNumColours(desired)
    }
  }, [desiredNumColours, flagPrinted, numColours, printMethod, printingErrorComputed])

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Quote Calculator</Typography>
        <Typography variant="body2" color="text.secondary">
          Quick quote calculator (no existing product required).
        </Typography>
      </Box>

      {(err || ratebookErr) && <Alert severity="error">{err || ratebookErr}</Alert>}

      <Box
        sx={{
          display: { xs: 'block', md: 'flex' },
          gap: 2,
          alignItems: 'flex-start',
        }}
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
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField defaultValue="kg" label="Qty Type" value={qtyType} onChange={(e) => setQtyType(e.target.value as any)}>
                    <MenuItem value="units">Bags (Units)</MenuItem>
                    <MenuItem value="kg">Total KG</MenuItem>
                  </DefaultSelectField>
                  <TextField
                    label={qtyType === 'units' ? 'Total Bags' : 'Total KG'}
                    type="number"
                    value={qtyTotal}
                    onChange={(e) => setQtyTotal(e.target.value)}
                  />
                </Box>

                {finishMode === 'Rolls' ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                    <TextField
                      label="No. of Rolls"
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={qtyRolls}
                      onChange={(e) => setQtyRolls(e.target.value)}
                    />
                  </Box>
                ) : null}
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
                          label="Product Width (mm)"
                          type="number"
                          value={widthMm}
                          onChange={(e) => setWidthMm(e.target.value)}
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
                          label="Layflat Width (mm)"
                          value={layflatWidthMm > 0 ? Math.round(layflatWidthMm) : ''}
                          InputProps={{ readOnly: true }}
                          disabled
                        />
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: isMobile ? '1fr' : canHaveGusset && flagGusset ? 'repeat(2, minmax(0, 1fr))' : 'minmax(240px, 1fr)',
                          gap: 2,
                        }}
                      >
                        <TextField label="Width (mm)" type="number" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} />
                        {canHaveGusset && flagGusset ? (
                          <TextField
                            label="Gusset Return (mm)"
                            type="number"
                            value={gussetReturnMm}
                            onChange={(e) => setGussetReturnMm(e.target.value)}
                          />
                        ) : null}
                      </Box>
                    )}

                    {showRunUp && canHaveGusset && flagGusset ? (
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                        <TextField
                          label="Gusset Return (mm)"
                          type="number"
                          value={gussetReturnMm}
                          onChange={(e) => setGussetReturnMm(e.target.value)}
                        />
                      </Box>
                    ) : null}
                  </Stack>
                )}

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <DefaultSelectField label="Length Units" value={lengthUnits} defaultValue="mm" onChange={(e) => setLengthUnits(e.target.value as any)}>
                    <MenuItem value="mm">mm</MenuItem>
                    <MenuItem value="m">m</MenuItem>
                  </DefaultSelectField>
                  <TextField label="Length" type="number" value={length} onChange={(e) => setLength(e.target.value)} />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr)', gap: 2 }}>
                  <TextField label="Thickness / Gauge (µm)" type="number" value={thicknessUm} onChange={(e) => setThicknessUm(e.target.value)} />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr)', gap: 2 }}>
                  <TextField
                    label="Trim (%)"
                    type="number"
                    inputProps={{ min: 0, step: 0.1 }}
                    value={trimPctText}
                    onChange={(e) => setTrimPctText(e.target.value)}
                    helperText="Optional. Percentage trim allowance."
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

                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Colour</TableCell>
                      <TableCell>Percentage (%)</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {colourRows.map((row, idx) => {
                      const defaults = idx === 0 ? { colour_code: 'WHITE', strength_pct: '' } : { colour_code: '', strength_pct: '' }
                      const isDefault = isDefaultRow(row, defaults)
                      const isWhite = idx === 0
                      return (
                        <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                          <TableCell sx={{ width: '55%' }}>
                            {isWhite ? (
                              <TextField
                                size="small"
                                label="Colour"
                                value="WHITE (Opaque)"
                                disabled
                                fullWidth
                                sx={{
                                  // Keep this non-editable, but make the text a bit darker so it doesn't read as "fully disabled".
                                  '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: 'rgba(0,0,0,0.72)' },
                                  '& .MuiInputLabel-root.Mui-disabled': { color: 'rgba(0,0,0,0.6)' },
                                }}
                              />
                            ) : (
                              <ColourSelect
                                options={colourOptions}
                                valueCode={row.colour_code}
                                label="Colour"
                                onChangeCode={(nextCode) =>
                                  setColourRows((prev) => {
                                    const next = [...prev]
                                    next[idx] = { ...(next[idx] || { colour_code: '', strength_pct: '' }), colour_code: nextCode }
                                    return next
                                  })
                                }
                              />
                            )}
                          </TableCell>
                          <TableCell sx={{ width: '45%' }}>
                            <TextField
                              size="small"
                              label="%"
                              type="number"
                              inputProps={{ min: 0, step: 0.1 }}
                              value={row.strength_pct}
                              onChange={(e) =>
                                setColourRows((prev) => {
                                  const next = [...prev]
                                  next[idx] = { ...(next[idx] || { colour_code: '', strength_pct: '' }), strength_pct: e.target.value }
                                  return next
                                })
                              }
                              fullWidth
                            />
                          </TableCell>
                          <TableCell sx={{ width: '10%' }}>
                            {!isDefault ? (
                              <Button
                                size="small"
                                color="inherit"
                                onClick={() =>
                                  setColourRows((prev) => {
                                    const next = [...prev]
                                    next[idx] = defaults
                                    return next
                                  })
                                }
                              >
                                Clear
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                <Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Additive</TableCell>
                        <TableCell>Percentage (%)</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {additiveRows.map((row, idx) => {
                        const defaults = { additive_code: '', pct: '' }
                        const isDefault = isDefaultRow(row, defaults)
                        return (
                          <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                            <TableCell sx={{ width: '55%' }}>
                              <AdditiveSelect
                                options={additiveOptions}
                                valueCode={row.additive_code}
                                label={`Additive ${idx + 1}`}
                                onChangeCode={(nextCode) =>
                                  setAdditiveRows((prev) => {
                                    const next = [...prev]
                                    next[idx] = { ...(next[idx] || { additive_code: '', pct: '' }), additive_code: nextCode }
                                    return next
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell sx={{ width: '35%' }}>
                              <TextField
                                size="small"
                                label="Pct"
                                type="number"
                                inputProps={{ min: 0, step: 0.1 }}
                                value={row.pct}
                                onChange={(e) =>
                                  setAdditiveRows((prev) => {
                                    const next = [...prev]
                                    next[idx] = { ...(next[idx] || { additive_code: '', pct: '' }), pct: e.target.value }
                                    return next
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell sx={{ width: '10%' }}>
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                {!isDefault ? (
                                  <Button
                                    size="small"
                                    color="inherit"
                                    onClick={() =>
                                      setAdditiveRows((prev) => {
                                        const next = [...prev]
                                        next[idx] = defaults
                                        return next
                                      })
                                    }
                                  >
                                    Clear
                                  </Button>
                                ) : null}
                                <Button
                                  size="small"
                                  color="inherit"
                                  onClick={() => setAdditiveRows((prev) => prev.filter((_, i) => i !== idx))}
                                  disabled={additiveRows.length <= 2}
                                >
                                  Remove
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <Box sx={{ mt: 1 }}>
                    <Button variant="outlined" size="small" onClick={() => setAdditiveRows((prev) => [...prev, { additive_code: '', pct: '' }])}>
                      Add additive
                    </Button>
                  </Box>
                </Box>
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
                    disabled={!!printingError}
                  />
                ) : null}
              </Box>
              {printingError ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {printingError}
                </Alert>
              ) : null}
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
                        } kg/hr`
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
                        <TableCell align="right">Minutes</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {appliedExtrusionWasteFactors.map((f) => (
                        <TableRow key={f.slug}>
                          <TableCell>{wasteFactorLabel(f.slug)}</TableCell>
                          <TableCell align="right">{Math.round(Number(f.minutes || 0))}</TableCell>
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
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <TextField label="Finish Type" value={finishMode} InputProps={{ readOnly: true }} disabled helperText="From Product Identity" />

                  {finishMode === 'Rolls' ? (
                    <DefaultSelectField defaultValue="7mm" label="Core Type" value={coreType} onChange={(e) => setCoreType(e.target.value)}>
                      {['7mm', '13mm', 'PVC', 'None'].map((v) => (
                        <MenuItem key={v} value={v}>
                          {v}
                        </MenuItem>
                      ))}
                    </DefaultSelectField>
                  ) : null}

                  {finishMode === 'Rolls' ? (
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
                  ) : null}

                  {finishMode === 'Cartons' ? (
                    <TextField
                      label="Bags per Carton"
                      type="number"
                      inputProps={{ min: 1, step: 1 }}
                      value={bagsPerCarton}
                      onChange={(e) => setBagsPerCarton(e.target.value)}
                    />
                  ) : null}
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
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
                    label="Margin (decimal)"
                    type="number"
                    inputProps={{ min: 0, max: 1, step: 0.01 }}
                    value={quickMargin}
                    onChange={(e) => setQuickMargin(e.target.value)}
                    helperText="Enter as decimal (e.g., 0.25 = 25%)"
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button variant="contained" onClick={() => void calcQuick(calcPayload)} disabled={!canCalculate || calcLoading}>
                    {calcLoading ? 'Calculating…' : 'Recalculate now'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setQuickPreview(null)
                      lastPayloadKeyRef.current = ''
                    }}
                  >
                    Clear preview
                  </Button>
                </Box>
              </Stack>
            </Paper>
          </Stack>
        </Box>

        {/* Desktop sticky panel */}
        {!isMobile ? (
          <Box
            sx={{
              width: 380,
              flex: '0 0 auto',
              position: 'sticky',
              // Account for the fixed app bar (56px xs, 64px sm+) plus a small gap.
              top: { xs: 72, sm: 80 },
              alignSelf: 'flex-start',
            }}
          >
            <QuotePreview preview={quickPreview} loading={calcLoading} canCalculate={canCalculate} missing={missingForCalc} finishMode={finishMode} />
          </Box>
        ) : null}
      </Box>

      {/* Mobile bottom panel */}
      {isMobile ? (
        <>
          <Box sx={{ height: 220 }} />
          <Paper
            variant="outlined"
            sx={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1200,
              borderLeft: 0,
              borderRight: 0,
              borderBottom: 0,
              borderRadius: 0,
              maxHeight: '45vh',
              overflow: 'auto',
              p: 1.5,
              backgroundColor: 'background.paper',
            }}
          >
            <QuotePreview preview={quickPreview} loading={calcLoading} canCalculate={canCalculate} missing={missingForCalc} finishMode={finishMode} />
          </Paper>
        </>
      ) : null}
    </Stack>
  )
}


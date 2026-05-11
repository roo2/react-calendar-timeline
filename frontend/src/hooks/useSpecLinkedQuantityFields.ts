import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpecPayload } from '../components/SpecPayloadForm'
import { useDebouncedCallback } from './useDebouncedCallback'
import type { QuickQuoteInputs, QuoteRatebook } from '../utils/quoteCalculator'
import { computeDerivedGeometryAndTotals } from '../utils/quoteCalculator'
import { parsePositiveKgLoose } from '../utils/quoteToSpec'
import { buildQuickQuoteInputsFromSpec, type SpecQuantitySlice } from '../utils/specToQuoteInputs'
import {
  coerceQtyTypeForFinishMode,
  computeTotalKgDisplay,
  computeWeightPerRollDisplay,
  productDisplayUnitPlural,
  type DerivedDisplay,
  type FinishMode,
  type QtyType,
} from '../utils/quantityRollFields'

const QTY_FIELD_DEBOUNCE_MS = 120

function formatKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

function roundTo2Decimals(s: string): string {
  if (s.trim() === '') return s
  const n = Number(s)
  return Number.isFinite(n) ? n.toFixed(2) : s
}

function kgDisplayStringsCloseEnough(a: string, b: string): boolean {
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a).trim() === String(b).trim()
  return Math.abs(na - nb) < 1e-6
}

export type SpecLinkedQuantityHydrate = Partial<{
  qtyType: QtyType
  cartonQtyMode: '1000' | 'ctn'
  totalKg: string
  numRolls: string
  weightPerRoll: string
  numUnits: string
  unitsPerRoll: string
  metersPerRoll: string
  numCartons: string
}>

/**
 * Quantity state + Quotes-style cross-field updates for screens backed by a product {@link SpecPayload}
 * (job sheets, product editor). Mirrors `QuotesPage` linking when MOQ mirroring is off.
 */
export type SpecLinkedQuantityBind = ReturnType<typeof useSpecLinkedQuantityFields>

export function useSpecLinkedQuantityFields(opts: {
  spec: SpecPayload
  ratebook: QuoteRatebook | null
  extruderCode?: string | null
}) {
  const { spec, ratebook, extruderCode } = opts

  const finishMode: FinishMode = spec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const productType = String(spec.identity?.product_type || 'Bag')
  const lengthUnitsRaw = String(spec.dimensions?.length_units || '')
  const isContinuousLength =
    productType === 'Tube' || lengthUnitsRaw === 'Continuous' || lengthUnitsRaw.toLowerCase() === 'continuous'

  const [qtyType, setQtyType] = useState<QtyType>('kg')
  const [cartonQtyMode, setCartonQtyMode] = useState<'1000' | 'ctn'>('1000')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('1')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')
  const [numCartons, setNumCartons] = useState('')
  const [unitsPerRoll, setUnitsPerRoll] = useState('')
  const [metersPerRoll, setMetersPerRoll] = useState('')

  const totalKgStrRef = useRef('')
  const prevCartonKgMassDriversRef = useRef<{ tk: number; wpr: number } | null>(null)
  const prevRollsKgMassDriversRef = useRef<{ tk: number; wpr: number } | null>(null)
  const prevDiscreteUnitsRollsKpuRef = useRef<number | undefined>(undefined)

  const qtyTypeCarrySnapRef = useRef({
    totalKgFromUi: null as number | null,
    weightPerRollFromUi: null as number | null,
    rollsFromUi: null as number | null,
    unitsFromUi: null as number | null,
    cartonsFromUi: null as number | null,
    unitsPerRollFromUi: null as number | null,
    metersPerRollFromUi: null as number | null,
  })

  const bagsPerCartonNum =
    spec.packaging?.bags_per_carton != null ? Math.max(1, Math.round(Number(spec.packaging.bags_per_carton))) : 0

  const effectiveQtyType = useMemo(
    () => coerceQtyTypeForFinishMode(finishMode, qtyType, isContinuousLength),
    [finishMode, qtyType, isContinuousLength],
  )

  const totalKgNum = Number(totalKg || 0)
  totalKgStrRef.current = totalKg
  const numUnitsNum = Math.max(0, Math.round(Number(numUnits || 0)))
  const numCartonsNum = Math.max(0, Math.round(Number(numCartons || 0)))
  const numRollsNum = Math.max(0, Math.round(Number(numRolls || 0)))
  const unitsPerRollNum = Math.max(0, Math.round(Number(unitsPerRoll || 0)))
  const metersPerRollNum = Number(metersPerRoll || 0)
  const weightPerRollNum = parsePositiveKgLoose(weightPerRoll) ?? 0

  const qtyMode: 'units' | 'kg' | 'roll' | 'ctn' =
    effectiveQtyType === 'units'
      ? finishMode === 'Cartons' && cartonQtyMode === 'ctn'
        ? 'ctn'
        : 'units'
      : effectiveQtyType === 'kg'
        ? 'kg'
        : 'roll'

  const quantitySlice: SpecQuantitySlice = useMemo(
    () => ({
      qtyType: effectiveQtyType,
      totalKg: totalKgNum,
      numUnits: numUnitsNum,
      numRolls: numRollsNum,
      weightPerRoll: weightPerRollNum,
      unitsPerRoll: unitsPerRollNum,
      metersPerRoll: metersPerRollNum,
    }),
    [effectiveQtyType, totalKgNum, numUnitsNum, numRollsNum, weightPerRollNum, unitsPerRollNum, metersPerRollNum],
  )

  const quickInputs: QuickQuoteInputs | null = useMemo(() => {
    if (!ratebook) return null
    try {
      return buildQuickQuoteInputsFromSpec(spec, quantitySlice, { ratebook, extruderCode: extruderCode ?? null })
    } catch {
      return null
    }
  }, [spec, quantitySlice, ratebook, extruderCode])

  const derivedForDisplay = useMemo(() => {
    if (!ratebook || !quickInputs) return null
    try {
      return computeDerivedGeometryAndTotals(quickInputs, ratebook)
    } catch {
      return null
    }
  }, [ratebook, quickInputs])

  const derivedDisplayForQty: DerivedDisplay = derivedForDisplay
    ? {
        derivedTotalKg: derivedForDisplay.derivedTotalKg ?? null,
        units: derivedForDisplay.units ?? null,
        kgPerRoll: derivedForDisplay.kgPerRoll ?? null,
        billedKgPerRoll: derivedForDisplay.billedKgPerRoll ?? null,
      }
    : null

  const discreteUnitsRollsFromBags =
    effectiveQtyType === 'units' &&
    finishMode === 'Rolls' &&
    !isContinuousLength &&
    numUnitsNum > 0 &&
    unitsPerRollNum > 0
      ? Math.ceil(numUnitsNum / Math.max(1, unitsPerRollNum))
      : null

  const rollsCountForRollsDisplay =
    finishMode === 'Rolls'
      ? isContinuousLength && effectiveQtyType === 'units' && numUnitsNum > 0
        ? numUnitsNum
        : effectiveQtyType === 'kg' && totalKgNum > 0 && weightPerRollNum > 0
          ? Math.round(totalKgNum / weightPerRollNum)
          : discreteUnitsRollsFromBags != null
            ? discreteUnitsRollsFromBags
            : effectiveQtyType === 'units' &&
                !isContinuousLength &&
                derivedForDisplay?.derivedTotalKg != null &&
                weightPerRollNum > 0
              ? Math.round(Number(derivedForDisplay.derivedTotalKg) / weightPerRollNum)
              : numRollsNum
      : null

  const rollsDisplay = finishMode === 'Rolls' ? rollsCountForRollsDisplay : null

  const rollsCountForWeightPerRollDisplay =
    rollsDisplay != null && rollsDisplay > 0 ? rollsDisplay : numRollsNum

  const weightPerRollDisplay = computeWeightPerRollDisplay(
    effectiveQtyType,
    finishMode,
    rollsCountForWeightPerRollDisplay,
    weightPerRollNum,
    derivedDisplayForQty,
    isContinuousLength && effectiveQtyType === 'total_rolls',
  )

  const totalKgDisplay = computeTotalKgDisplay(
    effectiveQtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    numUnitsNum,
    derivedDisplayForQty,
  )

  const unitsDisplay =
    effectiveQtyType === 'units'
      ? numUnitsNum
      : effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0
        ? numRollsNum * unitsPerRollNum
        : derivedForDisplay?.units != null
          ? Number(derivedForDisplay.units)
          : null

  const rollCountForProductsPerRoll =
    finishMode === 'Rolls'
      ? rollsDisplay != null && rollsDisplay > 0
        ? Number(rollsDisplay)
        : numRollsNum > 0
          ? numRollsNum
          : null
      : numRollsNum > 0
        ? numRollsNum
        : null

  const totalProductsCountForPerRoll =
    effectiveQtyType === 'units'
      ? numUnitsNum > 0
        ? numUnitsNum
        : null
      : unitsDisplay != null && unitsDisplay > 0
        ? Number(unitsDisplay)
        : null

  const productsPerRollDerived =
    isContinuousLength && finishMode === 'Rolls' && (effectiveQtyType === 'total_rolls' || effectiveQtyType === 'rolls_units')
      ? 1
      : effectiveQtyType === 'rolls_units' ||
          rollCountForProductsPerRoll == null ||
          !(rollCountForProductsPerRoll > 0) ||
          totalProductsCountForPerRoll == null ||
          !(totalProductsCountForPerRoll > 0)
        ? null
        : totalProductsCountForPerRoll / rollCountForProductsPerRoll

  const cartonCountForDisplay = useMemo(() => {
    if (finishMode !== 'Cartons') return null
    if (cartonQtyMode === 'ctn' && numCartonsNum > 0) return numCartonsNum
    if (effectiveQtyType === 'kg' && totalKgNum > 0) {
      if (weightPerRollNum > 0) return Math.max(1, Math.round(totalKgNum / weightPerRollNum))
      const ku = derivedForDisplay?.kgPerUnit
      if (bagsPerCartonNum > 0 && ku != null && Number(ku) > 0) {
        const cartonKg = bagsPerCartonNum * Number(ku)
        return Math.max(1, Math.round(totalKgNum / cartonKg))
      }
    }
    if (bagsPerCartonNum > 0 && numUnitsNum > 0) return Math.ceil(numUnitsNum / bagsPerCartonNum)
    return null
  }, [
    finishMode,
    cartonQtyMode,
    numCartonsNum,
    effectiveQtyType,
    totalKgNum,
    weightPerRollNum,
    bagsPerCartonNum,
    numUnitsNum,
    derivedForDisplay?.kgPerUnit,
  ])

  const cartonWeightKgForDisplay = useMemo(() => {
    if (finishMode !== 'Cartons') return null
    if (effectiveQtyType === 'units' && (cartonQtyMode === 'ctn' || cartonQtyMode === '1000')) {
      const ku = derivedForDisplay?.kgPerUnit
      if (bagsPerCartonNum > 0 && ku != null && Number.isFinite(Number(ku)) && Number(ku) > 0) {
        return bagsPerCartonNum * Number(ku)
      }
      const dkg = derivedForDisplay?.derivedTotalKg
      const c = cartonCountForDisplay
      if (dkg != null && c != null && c > 0 && Number.isFinite(Number(dkg)) && Number(dkg) > 0) return Number(dkg) / c
    }
    if (weightPerRollNum > 0) return weightPerRollNum
    const dkg = derivedForDisplay?.derivedTotalKg
    const c = cartonCountForDisplay
    if (dkg != null && c != null && c > 0 && Number.isFinite(Number(dkg)) && Number(dkg) > 0) return Number(dkg) / c
    return null
  }, [
    finishMode,
    effectiveQtyType,
    cartonQtyMode,
    bagsPerCartonNum,
    derivedForDisplay?.kgPerUnit,
    derivedForDisplay?.derivedTotalKg,
    weightPerRollNum,
    cartonCountForDisplay,
  ])

  const continuousRollCountForTotalKgSync = useCallback((): number | null => {
    if (!(isContinuousLength && finishMode === 'Rolls')) return null
    if (qtyMode === 'roll') return numRollsNum > 0 ? numRollsNum : null
    if (qtyMode === 'kg') {
      if (totalKgNum > 0 && weightPerRollNum > 0) {
        const r = Math.round(totalKgNum / weightPerRollNum)
        if (r > 0) return r
      }
      const qr = quickInputs?.quantity?.rolls != null ? Number(quickInputs.quantity.rolls) : NaN
      if (Number.isFinite(qr) && qr > 0) return Math.round(qr)
      if (numRollsNum > 0) return numRollsNum
      return null
    }
    if (qtyMode === 'units') {
      if (numUnitsNum > 0) return numUnitsNum
      if (rollsDisplay != null && rollsDisplay > 0) return Math.round(Number(rollsDisplay))
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
    quickInputs?.quantity?.rolls,
    rollsDisplay,
  ])

  const totalKgEditable = effectiveQtyType === 'kg'
  const unitsEditable = effectiveQtyType === 'units'
  const rollsEditable = finishMode === 'Rolls' && (effectiveQtyType === 'total_rolls' || effectiveQtyType === 'rolls_units')
  const weightPerRollEditable =
    (finishMode === 'Rolls' &&
      (effectiveQtyType === 'kg' ||
        (effectiveQtyType === 'units' && isContinuousLength))) ||
    (finishMode === 'Cartons' && effectiveQtyType === 'kg')

  const haveDriverForTotalKg =
    (effectiveQtyType === 'units' && numUnitsNum > 0) ||
    (effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) ||
    (effectiveQtyType === 'total_rolls' &&
      numRollsNum > 0 &&
      (isContinuousLength ? metersPerRollNum > 0 : weightPerRollNum > 0))

  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    (numRollsNum > 0 ||
      (isContinuousLength && effectiveQtyType === 'units' && numUnitsNum > 0) ||
      (effectiveQtyType === 'units' && !isContinuousLength && numUnitsNum > 0 && unitsPerRollNum > 0)) &&
    ((effectiveQtyType === 'kg' && totalKgNum > 0) ||
      (effectiveQtyType === 'units' && numUnitsNum > 0) ||
      (effectiveQtyType === 'rolls_units' && unitsPerRollNum > 0) ||
      (effectiveQtyType === 'total_rolls' && isContinuousLength && metersPerRollNum > 0))

  const totalMetersReadonly = useMemo(() => {
    if (!ratebook) return '…'
    if (!derivedForDisplay) return '—'
    const m = derivedForDisplay.derivedTotalM
    if (m == null || !Number.isFinite(Number(m)) || Number(m) <= 0) return '—'
    return `${Math.round(Number(m)).toLocaleString()} m`
  }, [ratebook, derivedForDisplay])

  const productUnitLabel = productDisplayUnitPlural(productType)
  const productTypeIsBag = productType.toLowerCase() === 'bag'

  useEffect(() => {
    const coerced = coerceQtyTypeForFinishMode(finishMode, qtyType, isContinuousLength)
    if (coerced !== qtyType) setQtyType(coerced)
  }, [finishMode, isContinuousLength, qtyType])

  useEffect(() => {
    if (finishMode === 'Cartons' && qtyType === 'kg') {
      setQtyType('units')
      setCartonQtyMode('ctn')
      return
    }
    if (finishMode !== 'Rolls' && (qtyType === 'total_rolls' || qtyType === 'rolls_units')) {
      setQtyType('units')
      setCartonQtyMode('ctn')
      return
    }
    if (isContinuousLength && qtyType === 'rolls_units') setQtyType('total_rolls')
  }, [finishMode, qtyType, isContinuousLength])

  useEffect(() => {
    if (!isContinuousLength || finishMode !== 'Rolls') return
    if (!(effectiveQtyType === 'total_rolls' || effectiveQtyType === 'rolls_units')) return
    const t = String(unitsPerRoll ?? '').trim()
    if (t === '1') return
    const n = Number(t)
    if (t === '' || !Number.isFinite(n) || n !== 1) setUnitsPerRoll('1')
  }, [isContinuousLength, finishMode, effectiveQtyType, unitsPerRoll])

  useEffect(() => {
    if (!(finishMode === 'Cartons' && effectiveQtyType === 'units' && cartonQtyMode === 'ctn')) return
    if (!(numCartonsNum > 0) || !(bagsPerCartonNum > 0)) {
      if (numUnits !== '') setNumUnits('')
      return
    }
    const nextUnits = String(numCartonsNum * bagsPerCartonNum)
    if (numUnits !== nextUnits) setNumUnits(nextUnits)
  }, [finishMode, effectiveQtyType, cartonQtyMode, numCartonsNum, bagsPerCartonNum, numUnits])

  useEffect(() => {
    if (!(finishMode === 'Cartons' && effectiveQtyType === 'kg')) {
      prevCartonKgMassDriversRef.current = null
      return
    }
    if (!(totalKgNum > 0 && weightPerRollNum > 0)) {
      prevCartonKgMassDriversRef.current = null
      return
    }
    const cur = { tk: totalKgNum, wpr: weightPerRollNum }
    const prev = prevCartonKgMassDriversRef.current
    prevCartonKgMassDriversRef.current = cur
    if (prev == null) return
    if (prev.tk === cur.tk && prev.wpr === cur.wpr) return
    const n = Math.max(1, Math.round(cur.tk / cur.wpr))
    const next = String(n)
    if (numCartons !== next) setNumCartons(next)
    const ku = derivedForDisplay?.kgPerUnit
    if (ku != null && Number.isFinite(Number(ku)) && Number(ku) > 0) {
      const nu = Math.max(0, Math.round(cur.tk / Number(ku)))
      const nextU = String(nu)
      if (numUnits !== nextU) setNumUnits(nextU)
    }
  }, [finishMode, effectiveQtyType, totalKgNum, weightPerRollNum, numCartons, numUnits, derivedForDisplay?.kgPerUnit])

  useEffect(() => {
    if (!(finishMode === 'Rolls' && effectiveQtyType === 'kg' && !isContinuousLength)) {
      prevRollsKgMassDriversRef.current = null
      return
    }
    if (!(totalKgNum > 0 && weightPerRollNum > 0)) {
      prevRollsKgMassDriversRef.current = null
      return
    }
    const cur = { tk: totalKgNum, wpr: weightPerRollNum }
    const prev = prevRollsKgMassDriversRef.current
    prevRollsKgMassDriversRef.current = cur
    if (prev == null) return
    if (prev.tk === cur.tk && prev.wpr === cur.wpr) return
    const nr = Math.max(1, Math.round(cur.tk / cur.wpr))
    if (numRolls !== String(nr)) setNumRolls(String(nr))
    const kpu = derivedForDisplay?.kgPerUnit
    if (kpu != null && Number.isFinite(Number(kpu)) && Number(kpu) > 0) {
      const nu = Math.max(0, Math.round(cur.tk / Number(kpu)))
      if (numUnits !== String(nu)) setNumUnits(String(nu))
    }
  }, [finishMode, effectiveQtyType, isContinuousLength, totalKgNum, weightPerRollNum, numRolls, numUnits, derivedForDisplay?.kgPerUnit])

  useEffect(() => {
    if (!(finishMode === 'Cartons' && effectiveQtyType === 'units' && cartonQtyMode === 'ctn')) return
    const ku = derivedForDisplay?.kgPerUnit
    if (!(bagsPerCartonNum > 0 && ku != null && Number.isFinite(Number(ku)) && Number(ku) > 0)) return
    const next = bagsPerCartonNum * Number(ku)
    if (!(next > 0) || !Number.isFinite(next)) return
    const formatted = formatKgDisplay(next)
    if (weightPerRoll !== formatted) setWeightPerRoll(formatted)
  }, [finishMode, effectiveQtyType, cartonQtyMode, bagsPerCartonNum, derivedForDisplay?.kgPerUnit, weightPerRoll])

  const qtyCascadeCtxRef = useRef({
    finishMode,
    isContinuousLength,
    qtyType: effectiveQtyType,
    ratebook,
    cartonQtyMode,
    bagsPerCartonNum,
    numCartonsNum,
    unitsPerRollNum,
    numRollsNum,
    derivedKpu: null as number | null,
  })
  const numUnitsForCascadeRef = useRef(numUnitsNum)
  const lastNumUnitsRawRef = useRef('')
  const lastUnitsPerRollRawRef = useRef('')
  const lastBagsPerCartonRawRef = useRef('')

  qtyCascadeCtxRef.current = {
    finishMode,
    isContinuousLength,
    qtyType: effectiveQtyType,
    ratebook,
    cartonQtyMode,
    bagsPerCartonNum,
    numCartonsNum,
    unitsPerRollNum,
    numRollsNum,
    derivedKpu:
      derivedForDisplay?.kgPerUnit != null &&
      Number.isFinite(Number(derivedForDisplay.kgPerUnit)) &&
      Number(derivedForDisplay.kgPerUnit) > 0
        ? Number(derivedForDisplay.kgPerUnit)
        : null,
  }
  numUnitsForCascadeRef.current = numUnitsNum

  const debouncedTotalProductsCascade = useDebouncedCallback(() => {
    const raw = lastNumUnitsRawRef.current
    const s = qtyCascadeCtxRef.current
    const u = raw.trim() !== '' ? Math.max(0, Math.round(Number(raw))) : 0
    if (s.finishMode === 'Cartons' && s.qtyType === 'units' && s.cartonQtyMode === '1000' && s.ratebook) {
      const kpu = s.derivedKpu
      if (u > 0 && kpu != null && kpu > 0) setTotalKg(formatKgDisplay(u * kpu))
      if (u > 0 && s.bagsPerCartonNum > 0) {
        setNumCartons(String(Math.max(1, Math.ceil(u / s.bagsPerCartonNum))))
      }
    }
    if (s.finishMode === 'Rolls' && !s.isContinuousLength && s.qtyType === 'units' && s.ratebook) {
      const bags = s.unitsPerRollNum
      const kpu = s.derivedKpu
      if (u > 0 && kpu != null && kpu > 0) setTotalKg(formatKgDisplay(u * kpu))
      if (u > 0 && bags > 0) setNumRolls(String(Math.max(1, Math.ceil(u / bags))))
      if (u > 0 && bags > 0 && kpu != null && kpu > 0) {
        setWeightPerRoll(roundTo2Decimals(String(bags * kpu)))
      }
    }
  }, QTY_FIELD_DEBOUNCE_MS)

  const debouncedUnitsPerRollCascade = useDebouncedCallback(() => {
    const raw = lastUnitsPerRollRawRef.current
    const s = qtyCascadeCtxRef.current
    const uProducts = numUnitsForCascadeRef.current
    const stayDiscreteRollQty = s.finishMode === 'Rolls' && !s.isContinuousLength && s.qtyType === 'total_rolls'
    if (stayDiscreteRollQty && s.ratebook) {
      const bags = Math.max(1, Math.round(Number(raw || 0)))
      const rolls = s.numRollsNum
      const kpu = s.derivedKpu
      if (bags > 0 && rolls > 0 && kpu != null && kpu > 0) {
        setNumUnits(String(rolls * bags))
        setTotalKg(formatKgDisplay(rolls * bags * kpu))
        setWeightPerRoll(roundTo2Decimals(String(bags * kpu)))
      }
    }
    if (s.finishMode === 'Rolls' && !s.isContinuousLength && s.qtyType === 'rolls_units' && s.ratebook) {
      const bags = Math.max(1, Math.round(Number(raw || 0)))
      const rolls = s.numRollsNum
      const kpu = s.derivedKpu
      if (bags > 0 && rolls > 0 && kpu != null && kpu > 0) {
        setNumUnits(String(rolls * bags))
        setTotalKg(formatKgDisplay(rolls * bags * kpu))
        setWeightPerRoll(roundTo2Decimals(String(bags * kpu)))
      }
    }
    if (s.finishMode === 'Rolls' && !s.isContinuousLength && s.qtyType === 'units' && s.ratebook) {
      const bags = Math.max(1, Math.round(Number(raw || 0)))
      const kpu = s.derivedKpu
      if (bags > 0 && uProducts > 0 && kpu != null && kpu > 0) {
        const rolls = Math.max(1, Math.ceil(uProducts / bags))
        setNumRolls(String(rolls))
        setWeightPerRoll(roundTo2Decimals(String(bags * kpu)))
        setTotalKg(formatKgDisplay(uProducts * kpu))
      }
    }
  }, QTY_FIELD_DEBOUNCE_MS)

  const debouncedBagsPerCartonCascade = useDebouncedCallback(() => {
    const raw = lastBagsPerCartonRawRef.current
    const s = qtyCascadeCtxRef.current
    const bpc = raw.trim() !== '' ? Math.max(1, Math.round(Number(raw))) : 0
    const ku = s.derivedKpu
    if (s.finishMode === 'Cartons' && s.qtyType === 'units' && s.cartonQtyMode === '1000' && s.ratebook) {
      if (bpc > 0 && ku != null && ku > 0) {
        setWeightPerRoll(formatKgDisplay(bpc * ku))
      }
      if (bpc > 0 && numUnitsForCascadeRef.current > 0) {
        setNumCartons(String(Math.max(1, Math.ceil(numUnitsForCascadeRef.current / bpc))))
      }
    }
    if (
      s.finishMode === 'Cartons' &&
      s.qtyType === 'units' &&
      s.cartonQtyMode === 'ctn' &&
      s.ratebook &&
      bpc > 0 &&
      ku != null &&
      ku > 0
    ) {
      const wKg = bpc * ku
      setWeightPerRoll(formatKgDisplay(wKg))
      if (s.numCartonsNum > 0) {
        setTotalKg(formatKgDisplay(s.numCartonsNum * wKg))
        setNumUnits(String(s.numCartonsNum * bpc))
      }
    }
  }, QTY_FIELD_DEBOUNCE_MS)

  const qtyTypeTransitionSnapshot = useMemo(() => {
    let totalKgFromUi: number | null = null
    if (totalKgEditable) {
      if (totalKg.trim() !== '' && Number.isFinite(totalKgNum) && totalKgNum > 0) totalKgFromUi = totalKgNum
    } else if (
      haveDriverForTotalKg &&
      totalKgDisplay != null &&
      Number.isFinite(Number(totalKgDisplay)) &&
      Number(totalKgDisplay) > 0
    ) {
      totalKgFromUi = Number(totalKgDisplay)
    } else if (totalKg.trim() !== '' && Number.isFinite(totalKgNum) && totalKgNum > 0) {
      totalKgFromUi = totalKgNum
    }

    let weightPerRollFromUi: number | null = null
    if (
      finishMode === 'Cartons' &&
      effectiveQtyType === 'units' &&
      (cartonQtyMode === 'ctn' || cartonQtyMode === '1000')
    ) {
      const ku = derivedForDisplay?.kgPerUnit
      if (bagsPerCartonNum > 0 && ku != null && Number.isFinite(Number(ku)) && Number(ku) > 0) {
        weightPerRollFromUi = bagsPerCartonNum * Number(ku)
      }
    }
    if (weightPerRollEditable) {
      if (weightPerRollFromUi == null && weightPerRollNum > 0) weightPerRollFromUi = weightPerRollNum
    } else if (weightPerRollFromUi == null) {
      if (
        weightPerRollDisplay != null &&
        Number.isFinite(Number(weightPerRollDisplay)) &&
        Number(weightPerRollDisplay) > 0
      ) {
        weightPerRollFromUi = Number(weightPerRollDisplay)
      } else if (weightPerRollNum > 0) {
        weightPerRollFromUi = weightPerRollNum
      }
    }

    let rollsFromUi: number | null = null
    if (finishMode === 'Rolls') {
      if (rollsEditable && numRollsNum > 0) rollsFromUi = numRollsNum
      else if (rollsDisplay != null && Number.isFinite(Number(rollsDisplay)) && Number(rollsDisplay) > 0) {
        rollsFromUi = Math.round(Number(rollsDisplay))
      } else if (effectiveQtyType === 'kg') {
        const qr = quickInputs?.quantity?.rolls != null ? Number(quickInputs.quantity.rolls) : NaN
        if (Number.isFinite(qr) && qr > 0) rollsFromUi = Math.round(qr)
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
    if (effectiveQtyType === 'rolls_units' && unitsPerRollNum > 0) unitsPerRollFromUi = unitsPerRollNum
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
    effectiveQtyType,
    unitsPerRollNum,
    productsPerRollDerived,
    isContinuousLength,
    metersPerRollNum,
    bagsPerCartonNum,
    derivedForDisplay?.kgPerUnit,
    quickInputs?.quantity?.rolls,
    weightPerRoll,
  ])

  qtyTypeCarrySnapRef.current = qtyTypeTransitionSnapshot

  const applyQuantityCarryForNewQtyType = useCallback(
    (nextQtyType: QtyType, nextCartonQtyMode?: '1000' | 'ctn') => {
      const snap = qtyTypeCarrySnapRef.current

      let rollsCarry = snap.rollsFromUi != null && snap.rollsFromUi > 0 ? snap.rollsFromUi : null
      let totalKgCarry = snap.totalKgFromUi != null && snap.totalKgFromUi > 0 ? snap.totalKgFromUi : null

      if (finishMode === 'Rolls' && !(rollsCarry != null && rollsCarry > 0)) {
        const qr = quickInputs?.quantity?.rolls != null ? Number(quickInputs.quantity.rolls) : NaN
        if (Number.isFinite(qr) && qr > 0) rollsCarry = Math.round(qr)
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
        if (
          (finishMode === 'Rolls' || finishMode === 'Cartons') &&
          snap.weightPerRollFromUi != null &&
          snap.weightPerRollFromUi > 0
        ) {
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
    },
    [finishMode, isContinuousLength, quickInputs?.quantity?.rolls, derivedForDisplay?.derivedTotalKg, weightPerRoll],
  )

  useEffect(() => {
    if (effectiveQtyType === 'kg') {
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
    if (effectiveQtyType === 'units') {
      if ((numUnits == null || String(numUnits).trim() === '') && unitsDisplay != null && Number.isFinite(Number(unitsDisplay))) {
        setNumUnits(String(Math.round(Number(unitsDisplay))))
      }
      return
    }
    if (effectiveQtyType === 'rolls_units') {
      if (
        (numRolls == null || String(numRolls).trim() === '') &&
        rollsDisplay != null &&
        Number.isFinite(Number(rollsDisplay))
      ) {
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
    if (effectiveQtyType === 'total_rolls') {
      if (
        (numRolls == null || String(numRolls).trim() === '') &&
        rollsDisplay != null &&
        Number.isFinite(Number(rollsDisplay))
      ) {
        setNumRolls(String(Math.max(0, Math.round(Number(rollsDisplay)))))
      }
      if (!isContinuousLength) {
        if (
          (weightPerRoll == null || String(weightPerRoll).trim() === '') &&
          weightPerRollDisplay != null &&
          Number.isFinite(Number(weightPerRollDisplay))
        ) {
          setWeightPerRoll(formatKgDisplay(Number(weightPerRollDisplay)))
        }
      }
    }
  }, [
    effectiveQtyType,
    totalKg,
    numUnits,
    numRolls,
    unitsPerRoll,
    weightPerRoll,
    isContinuousLength,
    totalKgDisplay,
    unitsDisplay,
    rollsDisplay,
    productsPerRollDerived,
    weightPerRollDisplay,
  ])

  useEffect(() => {
    if (effectiveQtyType === 'units' || effectiveQtyType === 'rolls_units') return
    if (derivedForDisplay?.units == null) return
    const fromKgOrRollsMode =
      (effectiveQtyType === 'kg' && totalKgNum > 0) ||
      (effectiveQtyType === 'total_rolls' &&
        numRollsNum > 0 &&
        (isContinuousLength ? metersPerRollNum > 0 : weightPerRollNum > 0))
    const fromContinuousRolls =
      isContinuousLength &&
      finishMode === 'Rolls' &&
      derivedForDisplay.rolls != null &&
      Number(derivedForDisplay.rolls) > 0
    if (!(fromKgOrRollsMode || fromContinuousRolls)) return
    const computed = Math.round(Number(derivedForDisplay.units))
    const nextU = Number.isFinite(computed) && computed >= 0 ? String(computed) : ''
    if (numUnits === nextU) return
    setNumUnits(nextU)
  }, [
    effectiveQtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    metersPerRollNum,
    finishMode,
    isContinuousLength,
    derivedForDisplay?.units,
    derivedForDisplay?.rolls,
    numUnits,
  ])

  useEffect(() => {
    if (effectiveQtyType !== 'rolls_units') return
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
  }, [effectiveQtyType, weightPerRoll, numRollsNum, derivedForDisplay?.derivedTotalKg])

  useEffect(() => {
    if (effectiveQtyType !== 'total_rolls') return
    if (isContinuousLength) return
    if (!(numRollsNum > 0 && weightPerRollNum > 0)) return
    const dkg = derivedForDisplay?.derivedTotalKg
    const next =
      dkg != null && Number.isFinite(Number(dkg)) && Number(dkg) > 0
        ? formatKgDisplay(Number(dkg))
        : formatKgDisplay(numRollsNum * weightPerRollNum)
    if (!kgDisplayStringsCloseEnough(totalKgStrRef.current, next)) setTotalKg(next)
  }, [effectiveQtyType, isContinuousLength, numRollsNum, weightPerRollNum, derivedForDisplay?.derivedTotalKg])

  useEffect(() => {
    if (effectiveQtyType !== 'units' || finishMode !== 'Rolls' || isContinuousLength) {
      prevDiscreteUnitsRollsKpuRef.current = undefined
      return
    }
    if (numUnitsNum <= 0) return
    const kpu = derivedForDisplay?.kgPerUnit
    if (kpu == null || !Number.isFinite(Number(kpu)) || Number(kpu) <= 0) return
    const kpuNum = Number(kpu)
    const prevKpu = prevDiscreteUnitsRollsKpuRef.current
    const kpuChanged = prevKpu === undefined || prevKpu !== kpuNum
    if (!kpuChanged) return
    prevDiscreteUnitsRollsKpuRef.current = kpuNum

    const nextTotal = formatKgDisplay(numUnitsNum * kpuNum)
    if (totalKg !== nextTotal) setTotalKg(nextTotal)

    if (unitsPerRollNum > 0) {
      const rolls = Math.max(1, Math.ceil(numUnitsNum / unitsPerRollNum))
      if (numRolls !== String(rolls)) setNumRolls(String(rolls))
      const nextWpr = roundTo2Decimals(String(unitsPerRollNum * kpuNum))
      if (weightPerRoll !== nextWpr) setWeightPerRoll(nextWpr)
    }
  }, [effectiveQtyType, finishMode, isContinuousLength, numUnitsNum, unitsPerRollNum, derivedForDisplay?.kgPerUnit])

  useEffect(() => {
    if (effectiveQtyType !== 'rolls_units') return
    const w = derivedForDisplay?.billedKgPerRoll ?? derivedForDisplay?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) {
      setWeightPerRoll(roundTo2Decimals(String(w)))
    }
  }, [effectiveQtyType, derivedForDisplay?.billedKgPerRoll, derivedForDisplay?.kgPerRoll])

  const hydrate = useCallback((h: SpecLinkedQuantityHydrate) => {
    if (h.qtyType != null) setQtyType(h.qtyType)
    if (h.cartonQtyMode != null) setCartonQtyMode(h.cartonQtyMode)
    if (h.totalKg !== undefined) setTotalKg(h.totalKg)
    if (h.numRolls !== undefined) setNumRolls(h.numRolls)
    if (h.weightPerRoll !== undefined) setWeightPerRoll(h.weightPerRoll)
    if (h.numUnits !== undefined) setNumUnits(h.numUnits)
    if (h.unitsPerRoll !== undefined) setUnitsPerRoll(h.unitsPerRoll)
    if (h.metersPerRoll !== undefined) setMetersPerRoll(h.metersPerRoll)
    if (h.numCartons !== undefined) setNumCartons(h.numCartons)
  }, [])

  const resetNewDraft = useCallback(() => {
    setQtyType('kg')
    setCartonQtyMode('1000')
    setTotalKg('')
    setNumRolls('1')
    setWeightPerRoll('')
    setNumUnits('')
    setNumCartons('')
    setUnitsPerRoll('')
    setMetersPerRoll('')
  }, [])

  return {
    hydrate,
    resetNewDraft,
    qtyType,
    setQtyType,
    effectiveQtyType,
    cartonQtyMode,
    setCartonQtyMode,
    qtyMode,
    totalKg,
    setTotalKg,
    numRolls,
    setNumRolls,
    weightPerRoll,
    setWeightPerRoll,
    numUnits,
    setNumUnits,
    numCartons,
    setNumCartons,
    unitsPerRoll,
    setUnitsPerRoll,
    metersPerRoll,
    setMetersPerRoll,
    finishMode,
    isContinuousLength,
    productType,
    productUnitLabel,
    productTypeIsBag,
    bagsPerCartonNum,
    ratebook,
    derivedForDisplay,
    quickInputs,
    totalKgDisplay,
    rollsDisplay,
    weightPerRollDisplay,
    unitsDisplay,
    productsPerRollDerived,
    cartonCountForDisplay,
    cartonWeightKgForDisplay,
    totalKgEditable,
    unitsEditable,
    rollsEditable,
    weightPerRollEditable,
    haveDriverForTotalKg,
    haveDriverForWeightPerRoll,
    totalMetersReadonly,
    applyQuantityCarryForNewQtyType,
    debouncedTotalProductsCascade,
    debouncedUnitsPerRollCascade,
    debouncedBagsPerCartonCascade,
    lastNumUnitsRawRef,
    lastUnitsPerRollRawRef,
    lastBagsPerCartonRawRef,
    continuousRollCountForTotalKgSync,
    formatKgDisplay,
    roundTo2Decimals,
  }
}

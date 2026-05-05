import type { QtyType } from '../../utils/quantityRollFields'
import {
  mapProductTypeToMaterialsRetailGroup,
  resolveMaterialsRetailBand,
  type MaterialsMoqDenomKg,
  type QuoteRatebook,
} from '../../utils/quoteCalculator'

/** Round **up** to a fixed number of significant figures (e.g. 11,691 → 11,700 for 3 s.f.). Used for MOQ product counts so pricing matches the quote table. */
export function roundUpToSignificantFigures(n: number, significantFigures: number): number {
  if (!Number.isFinite(n) || n <= 0) return n
  const exp = Math.floor(Math.log10(n))
  const scale = 10 ** (exp - significantFigures + 1)
  return Math.ceil(n / scale) * scale
}

/** Round to a fixed number of significant figures (nearest), e.g. 7.9999 → 8.000, 7.9994 → 7.999 at 4 s.f. */
export function roundToSignificantFigures(n: number, significantFigures: number): number {
  if (!Number.isFinite(n) || n === 0) return n
  const sign = n < 0 ? -1 : 1
  const abs = Math.abs(n)
  const exp = Math.floor(Math.log10(abs))
  const scale = 10 ** (exp - significantFigures + 1)
  const shifted = abs / scale
  const roundedShifted = Math.round(shifted + Number.EPSILON * Math.sign(shifted))
  return sign * roundedShifted * scale
}

/** Round to a fixed number of decimal places (e.g. $/ROLL: 102.555 → 102.56). Uses `Number#toFixed` rounding. */
export function roundToDecimalPlaces(n: number, decimalPlaces: number): number {
  if (!Number.isFinite(n)) return n
  return Number(n.toFixed(decimalPlaces))
}

/** Integer product count covering MOQ mass: ceil to kg, then round up to 3 significant figures (matches quote table). */
export function moqDiscreteProductCountCoveringMoq(moqKg: number, kgEach: number): number {
  const raw = Math.max(1, Math.ceil(moqKg / kgEach))
  return Math.max(1, Math.round(roundUpToSignificantFigures(raw, 3)))
}

/** Resolve band MOQ mass (kg) from width + ratebook + print selection (same basis as MOQ hint lines). */
export function resolveBandMoqKgFromQuoteForm(args: {
  widthMmNum: number
  ratebook: QuoteRatebook | null
  productType: string
  flagPrinted: boolean
  printMethod: string
  numColours: string
  desiredNumColours: string
}): number | null {
  const { widthMmNum, ratebook, productType, flagPrinted, printMethod, numColours, desiredNumColours } = args
  if (!(widthMmNum > 0) || !ratebook) return null
  if (!mapProductTypeToMaterialsRetailGroup(productType)) return null
  const res = resolveMaterialsRetailBand(ratebook, productType, widthMmNum)
  if (!res.band) return null
  const hasPrintingSelection = flagPrinted && printMethod !== 'None' && Number(numColours || desiredNumColours || 0) > 0
  const plain = res.band.moq_plain_kg != null ? Number(res.band.moq_plain_kg) : null
  const printed = res.band.moq_printed_kg != null ? Number(res.band.moq_printed_kg) : null
  const plainOk = plain != null && Number.isFinite(plain) && plain > 0
  const printedOk = printed != null && Number.isFinite(printed) && printed > 0
  if (hasPrintingSelection) {
    if (printedOk && printed != null) return printed
    if (plainOk && plain != null) return plain
    return null
  }
  if (plainOk && plain != null) return plain
  if (printedOk && printed != null) return printed
  return null
}

/**
 * Build `quantity` for `calcPayload` when pricing at materials MOQ only (no user job quantity).
 * Uses the same conversions as the Min QTY email column.
 */
export function synthesizeMoqQuantity(args: {
  moqKg: number
  denom: MaterialsMoqDenomKg
  qtyType: QtyType
  finishMode: 'Rolls' | 'Cartons'
  cartonQtyMode: '1000' | 'ctn'
  bagsPerCartonNum: number
  weightPerRollNum: number
  metersPerRollNum: number
  isContinuousLength: boolean
  baseLengthMm: number
  unitsPerRollNum: number
}): Record<string, number> | null {
  const {
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
  } = args
  if (!(moqKg > 0) || !Number.isFinite(moqKg)) return null

  if (qtyType === 'kg') {
    const q: Record<string, number> = { total_kg: moqKg }
    if (finishMode === 'Rolls' && weightPerRollNum > 0) {
      q.rolls = Math.max(1, Math.round(moqKg / weightPerRollNum))
    }
    return q
  }

  if (qtyType === 'units') {
    if (finishMode === 'Cartons' && cartonQtyMode === 'ctn') {
      const kgPerCarton = denom.kgPerCarton
      if (!(kgPerCarton != null && kgPerCarton > 0)) return null
      const cartons = Math.max(1, Math.ceil(moqKg / kgPerCarton))
      const bpc = Math.max(1, bagsPerCartonNum || 1)
      const units = cartons * bpc
      const q: Record<string, number> = { units }
      const perCartonKg = weightPerRollNum
      if (perCartonKg > 0) q.total_kg = cartons * perCartonKg
      return q
    }
    const kgPerU = denom.kgPerProduct
    if (!(kgPerU != null && kgPerU > 0)) return null
    const units = moqDiscreteProductCountCoveringMoq(moqKg, kgPerU)
    const q: Record<string, number> = { units }
    if (baseLengthMm > 0 && !(isContinuousLength && finishMode === 'Rolls')) {
      q.total_m = (units * baseLengthMm) / 1000
    }
    if (isContinuousLength && finishMode === 'Rolls') {
      q.rolls = units
      if (metersPerRollNum > 0) q.total_m = units * metersPerRollNum
      else {
        const perRollKg = weightPerRollNum
        if (perRollKg > 0) q.total_kg = units * perRollKg
      }
    } else if (finishMode === 'Cartons') {
      const bpc = Math.max(1, bagsPerCartonNum || 1)
      const perCartonKg = weightPerRollNum
      if (perCartonKg > 0) {
        const cartons = Math.max(1, Math.ceil(units / bpc))
        q.total_kg = cartons * perCartonKg
      }
    }
    return q
  }

  if (qtyType === 'total_rolls') {
    const kgPerRoll =
      denom.kgPerRoll != null && denom.kgPerRoll > 0
        ? denom.kgPerRoll
        : weightPerRollNum
    if (!(kgPerRoll != null && kgPerRoll > 0)) return null
    const rolls = Math.max(1, Math.ceil(moqKg / kgPerRoll))
    if (isContinuousLength) {
      if (!(metersPerRollNum > 0)) return null
      return { rolls, total_m: rolls * metersPerRollNum }
    }
    return { rolls, total_kg: rolls * kgPerRoll }
  }

  if (qtyType === 'rolls_units') {
    const kgPerProduct = denom.kgPerProduct
    if (!(kgPerProduct != null && kgPerProduct > 0)) return null
    if (!(unitsPerRollNum > 0)) return null
    const upr = unitsPerRollNum
    // In explicit Rolls×Units mode, roll mass must follow user-entered units/roll.
    const massPerRoll = upr * kgPerProduct > 0 ? upr * kgPerProduct : null
    if (!(massPerRoll != null && massPerRoll > 0)) return null
    const rolls = Math.max(1, Math.ceil(moqKg / massPerRoll))
    const units = rolls * upr
    const q: Record<string, number> = { rolls, units }
    if (baseLengthMm > 0) q.total_m = (units * baseLengthMm) / 1000
    return q
  }

  return null
}

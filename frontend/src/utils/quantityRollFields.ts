/**
 * Shared quantity / roll field rules (Quotes page + Job Sheet editor).
 * Mirrors behaviour documented in QuotesPage calcPayload and field editability.
 */

export type QtyType = 'units' | 'units_per_1000' | 'kg' | 'total_rolls' | 'rolls_units'
export type FinishMode = 'Rolls' | 'Cartons'

/** Build the `quantity` object passed to QuickQuoteInputs / computeDerivedGeometryAndTotals. */
export function buildQuantityObjectForCalculator(
  qtyType: QtyType,
  finishMode: FinishMode,
  totalKgNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  numUnitsNum: number,
  baseLengthMm: number,
  unitsPerRollNum: number = 0,
  opts?: {
    /** When true, total units on a continuous web imply one roll (or one carton mass slice) per counted unit. */
    continuousLength?: boolean
    bagsPerCarton?: number
    /** Fallback kg/roll (or kg/carton when Cartons) from ratebook when weight field is empty. */
    rollWeightAvgKg?: number
  },
): { units?: number; total_kg?: number; total_m?: number; rolls?: number } {
  const qty: { units?: number; total_kg?: number; total_m?: number; rolls?: number } = {}
  if (qtyType === 'units' || qtyType === 'units_per_1000') qty.units = numUnitsNum
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
  if (qtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0) {
    qty.total_kg = numRollsNum * weightPerRollNum
    qty.rolls = numRollsNum
  } else if (finishMode === 'Rolls' && qtyType !== 'kg' && qtyType !== 'rolls_units' && numRollsNum > 0) {
    qty.rolls = numRollsNum
  }

  if ((qtyType === 'units' || qtyType === 'units_per_1000') && numUnitsNum > 0 && baseLengthMm > 0) {
    qty.total_m = (numUnitsNum * baseLengthMm) / 1000
  }

  if (opts?.continuousLength && (qtyType === 'units' || qtyType === 'units_per_1000') && numUnitsNum > 0) {
    if (finishMode === 'Rolls') {
      qty.rolls = numUnitsNum
      const perRollKg =
        weightPerRollNum > 0
          ? weightPerRollNum
          : opts.rollWeightAvgKg != null && opts.rollWeightAvgKg > 0
            ? opts.rollWeightAvgKg
            : 0
      if (perRollKg > 0) {
        qty.total_kg = numUnitsNum * perRollKg
      }
    } else if (finishMode === 'Cartons') {
      const bpc = opts.bagsPerCarton != null && opts.bagsPerCarton > 0 ? Math.max(1, Math.round(opts.bagsPerCarton)) : 0
      if (bpc > 0) {
        const cartons = Math.ceil(numUnitsNum / bpc)
        const perCartonKg =
          weightPerRollNum > 0
            ? weightPerRollNum
            : opts.rollWeightAvgKg != null && opts.rollWeightAvgKg > 0
              ? opts.rollWeightAvgKg
              : 0
        if (perCartonKg > 0) {
          qty.total_kg = cartons * perCartonKg
        }
      }
    }
  }
  return qty
}

export function getFieldEditability(finishMode: FinishMode, qtyType: QtyType) {
  const totalKgEditable = qtyType === 'kg'
  const unitsEditable = qtyType === 'units' || qtyType === 'units_per_1000'
  const rollsEditable = finishMode === 'Rolls' && (qtyType === 'total_rolls' || qtyType === 'rolls_units')
  const weightPerRollEditable =
    finishMode === 'Rolls' &&
    (qtyType === 'total_rolls' || qtyType === 'units' || qtyType === 'units_per_1000' || qtyType === 'kg')
  /** Cartons: rolls are internal for scheduling — user always sets count; weight/roll is derived from total kg. */
  const cartonsRollCountEditable = finishMode === 'Cartons'
  return {
    totalKgEditable,
    unitsEditable,
    rollsEditable,
    weightPerRollEditable,
    cartonsRollCountEditable,
  }
}

export type DerivedDisplay = {
  derivedTotalKg: number | null
  units: number | null
  kgPerRoll: number | null
  /** When set (e.g. core billing), matches quote preview / `computeQuickQuotePreview().kg_per_roll`. */
  billedKgPerRoll?: number | null
} | null

/** Display helpers (same rules as QuotesPage rollsDisplay / totalKgDisplay). */
export function computeRollsDisplay(
  finishMode: FinishMode,
  qtyType: QtyType,
  totalKgNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  derived: DerivedDisplay,
): number | null {
  if (finishMode === 'Rolls') {
    if (qtyType === 'kg' && totalKgNum > 0 && weightPerRollNum > 0) {
      return Math.round(totalKgNum / weightPerRollNum)
    }
    if ((qtyType === 'units' || qtyType === 'units_per_1000') && derived?.derivedTotalKg != null && weightPerRollNum > 0) {
      return Math.round(derived.derivedTotalKg / weightPerRollNum)
    }
    return numRollsNum
  }
  return null
}

export function computeTotalKgDisplay(
  qtyType: QtyType,
  totalKgNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  _numUnitsNum: number,
  derived: DerivedDisplay,
): number | null {
  if (qtyType === 'kg') return totalKgNum
  if (qtyType === 'units' || qtyType === 'units_per_1000' || qtyType === 'rolls_units') return derived?.derivedTotalKg ?? null
  if (qtyType === 'total_rolls') {
    return numRollsNum > 0 && weightPerRollNum > 0 ? numRollsNum * weightPerRollNum : null
  }
  return null
}

export function computeWeightPerRollDisplay(
  qtyType: QtyType,
  finishMode: FinishMode,
  numRollsNum: number,
  weightPerRollNum: number,
  derived: DerivedDisplay,
): number | null {
  if (qtyType === 'total_rolls') {
    const w = derived?.billedKgPerRoll ?? derived?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) return Number(w)
    return weightPerRollNum > 0 ? weightPerRollNum : null
  }
  if (finishMode === 'Rolls' && numRollsNum > 0) {
    const w = derived?.billedKgPerRoll ?? derived?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) return Number(w)
  }
  return null
}

/** Map job sheet persisted fields → order line quantity_value / quantity_unit. */
export function getOrderQuantityFromJobSheetFields(
  qtyType: QtyType,
  quantityValueFallback: number,
  totalKgNum: number,
  numUnitsNum: number,
  numRollsNum: number,
  finishMode: FinishMode = 'Rolls',
  bagsPerCarton: number | null | undefined = null,
): { quantity_value: number; quantity_unit: 'kg' | 'rolls' | 'cartons' | '1000' } {
  const fb = quantityValueFallback > 0 ? quantityValueFallback : 1
  if (qtyType === 'units_per_1000') {
    const abs =
      numUnitsNum > 0
        ? numUnitsNum
        : quantityValueFallback > 0
          ? Math.max(0, Math.round(quantityValueFallback * 1000))
          : 0
    const thousands = abs / 1000
    return { quantity_value: thousands > 0 ? thousands : fb, quantity_unit: '1000' }
  }
  if (qtyType === 'kg') {
    return { quantity_value: totalKgNum > 0 ? totalKgNum : fb, quantity_unit: 'kg' }
  }
  if (qtyType === 'total_rolls') {
    return { quantity_value: numRollsNum > 0 ? numRollsNum : fb, quantity_unit: 'rolls' }
  }
  if (qtyType === 'rolls_units') {
    return { quantity_value: numRollsNum > 0 ? numRollsNum : fb, quantity_unit: 'rolls' }
  }
  // units (product count): cartons finish → carton count when BPC known; rolls finish → bill in kg
  if (finishMode === 'Cartons') {
    const bpc = Math.max(0, Math.round(Number(bagsPerCarton) || 0))
    if (bpc > 0 && numUnitsNum > 0) {
      return {
        quantity_value: Math.max(1, Math.ceil(numUnitsNum / bpc)),
        quantity_unit: 'cartons',
      }
    }
    if (totalKgNum > 0) return { quantity_value: totalKgNum, quantity_unit: 'kg' }
    return { quantity_value: numUnitsNum > 0 ? numUnitsNum : fb, quantity_unit: 'kg' }
  }
  // Rolls + total units (product count): order line uses ×1000; same numeric rule as legacy `units_per_1000`.
  if (qtyType === 'units' && numUnitsNum > 0) {
    return { quantity_value: numUnitsNum / 1000, quantity_unit: '1000' }
  }
  if (totalKgNum > 0) return { quantity_value: totalKgNum, quantity_unit: 'kg' }
  return { quantity_value: numUnitsNum > 0 ? numUnitsNum : fb, quantity_unit: 'kg' }
}

/** Enforce qtyType when finish mode is Cartons (cannot use roll-based modes — those are for Rolls finish). */
export function coerceQtyTypeForFinishMode(
  finishMode: FinishMode,
  qtyType: QtyType,
  /** When true, rolls × units-per-roll is undefined (no fixed product length). */
  continuousLength = false,
): QtyType {
  if (finishMode !== 'Rolls' && (qtyType === 'total_rolls' || qtyType === 'rolls_units')) return 'kg'
  if (continuousLength && qtyType === 'rolls_units') return 'kg'
  return qtyType
}

/**
 * Weight per roll for Cartons from total kg and roll count (internal scheduling).
 */
export function cartonsWeightPerRollKg(totalKg: number, numRolls: number): number | null {
  if (!(totalKg > 0) || !(numRolls > 0)) return null
  return totalKg / numRolls
}

/**
 * Persisted roll count for scheduling (min 1). Uses same rules as Quotes display rolls.
 */
export function resolveNumRollsForPersistence(
  finishMode: FinishMode,
  qtyType: QtyType,
  totalKgNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  derived: DerivedDisplay,
): number {
  const rollsDisp = computeRollsDisplay(finishMode, qtyType, totalKgNum, numRollsNum, weightPerRollNum, derived)
  if (finishMode === 'Cartons') return Math.max(1, Math.round(numRollsNum))
  if (rollsDisp != null && Number.isFinite(rollsDisp)) return Math.max(1, Math.round(rollsDisp))
  return Math.max(1, Math.round(numRollsNum) || 1)
}

/** Persisted weight per roll (kg) when applicable; Cartons always derived from total kg. */
export function resolveWeightPerRollForPersistence(
  finishMode: FinishMode,
  qtyType: QtyType,
  totalKgNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  derived: DerivedDisplay,
): number | null {
  if (finishMode === 'Cartons') {
    const w = cartonsWeightPerRollKg(totalKgNum, numRollsNum)
    return w != null && w > 0 ? w : null
  }
  if (qtyType === 'total_rolls') {
    const w = derived?.billedKgPerRoll ?? derived?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) return Number(w)
    return weightPerRollNum > 0 ? weightPerRollNum : null
  }
  const w = computeWeightPerRollDisplay(qtyType, finishMode, numRollsNum, weightPerRollNum, derived)
  return w != null && w > 0 ? w : null
}

export function validateJobSheetQuantityInputs(
  finishMode: FinishMode,
  qtyType: QtyType,
  totalKgNum: number,
  numUnitsNum: number,
  numRollsNum: number,
  weightPerRollNum: number,
  /** When qtyType is `rolls_units`, units per roll (e.g. bags per roll). */
  unitsPerRollNum: number = 0,
): string | null {
  if (!(numRollsNum >= 1)) return 'Number of rolls must be at least 1 (required for scheduling).'
  if (finishMode === 'Cartons') {
    if (!(totalKgNum > 0)) return 'Total KG is required to derive weight per roll for scheduling.'
    return null
  }
  if ((qtyType === 'units' || qtyType === 'units_per_1000') && !(numUnitsNum > 0))
    return 'Enter the number of units.'
  if (qtyType === 'kg') {
    if (!(totalKgNum > 0)) return 'Enter total KG.'
    if (finishMode === 'Rolls' && !(weightPerRollNum > 0)) return 'Weight per roll is required for Rolls finish.'
  }
  if (qtyType === 'total_rolls') {
    if (!(numRollsNum > 0) || !(weightPerRollNum > 0)) return 'No. of rolls and weight per roll are required.'
  }
  if (qtyType === 'rolls_units') {
    if (!(numRollsNum > 0)) return 'Enter the number of rolls.'
    if (!(unitsPerRollNum > 0)) return 'Enter units per roll.'
  }
  return null
}

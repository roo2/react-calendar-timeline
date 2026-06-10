/**
 * Reconstruct quantity numbers from persisted job sheet + product spec (print preview, derived totals).
 * Mirrors the hydrate path in `JobSheetEditor` without React state.
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import {
  coerceQtyTypeForFinishMode,
  getOrderQuantityFromJobSheetFields,
  resolvedProductUnitsForOrder,
  type FinishMode,
  type QtyType,
} from './quantityRollFields'
import type { SpecQuantitySlice } from './specToQuoteInputs'
import { orderQtyPrefsFromJobSheetAndSpec, persistedQtyTypeFromPrefs } from './specOrderDefaults'

function parseQtyStrings(js: Record<string, unknown> | null | undefined, spec: SpecPayload): SpecQuantitySlice {
  const isImportDraft = Boolean(js?.is_import_draft)
  const prefs = orderQtyPrefsFromJobSheetAndSpec(js, spec)
  const rawQu = String(prefs.quantity_unit || js?.quantity_unit || '').toLowerCase()
  const rawQt = persistedQtyTypeFromPrefs(prefs, String(js?.quantity_unit || ''))

  let workingSpec = spec
  if (isImportDraft && (rawQu === 'rolls' || String(rawQt || '') === 'total_rolls')) {
    workingSpec = {
      ...spec,
      identity: { ...spec.identity, finish_mode: 'Rolls' },
    }
  }

  const fm: FinishMode = workingSpec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const pt = String(workingSpec.identity?.product_type || 'Bag')
  const lenRaw = String(workingSpec.dimensions?.length_units || '')
  const continuousLength =
    pt === 'Tube' || lenRaw === 'Continuous' || lenRaw.toLowerCase() === 'continuous'

  let qt: QtyType
  if (isImportDraft) {
    qt = continuousLength && rawQt === 'rolls_units' ? 'kg' : rawQt
  } else {
    qt = coerceQtyTypeForFinishMode(fm, rawQt, continuousLength)
  }
  let qtResolved: QtyType = qt
  if (isImportDraft && rawQu === 'rolls' && qtResolved === 'total_rolls') {
    qtResolved = 'rolls_units'
  }

  const nrStored = js?.num_rolls != null ? Math.max(1, Number(js.num_rolls)) : 1
  const wpr =
    prefs.weight_per_roll_kg != null && Number.isFinite(Number(prefs.weight_per_roll_kg))
      ? String(prefs.weight_per_roll_kg)
      : js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
        ? String(js.weight_per_roll_kg)
        : ''
  const quRawLower = String(js?.quantity_unit || '').toLowerCase()

  let totalKgH = ''
  let numRollsH = String(nrStored)
  let weightPerRollH = wpr
  let numUnitsH = ''
  let unitsPerRollH = ''
  const metersPerRollH = ''

  if (qtResolved === 'kg') {
    totalKgH = String(js?.quantity_value ?? '')
    // Rolls + KG still saves discrete product count for web-length geometry (roll-weight billing gauge).
    if (js?.num_product_units != null && Number.isFinite(Number(js.num_product_units))) {
      numUnitsH = String(Math.max(0, Math.round(Number(js.num_product_units))))
    } else {
      numUnitsH = ''
    }
    unitsPerRollH = ''
    numRollsH = String(nrStored)
    weightPerRollH = wpr
  } else if (qtResolved === 'units') {
    if (quRawLower === 'cartons' && js?.num_product_units != null) {
      numUnitsH = String(js.num_product_units)
    } else if (quRawLower === '1000' && js?.num_product_units != null) {
      numUnitsH = String(Math.max(0, Math.round(Number(js.num_product_units))))
    } else {
      numUnitsH = String(js?.num_product_units ?? js?.quantity_value ?? '')
    }
    totalKgH = ''
    unitsPerRollH = ''
    numRollsH = String(nrStored)
    weightPerRollH = wpr
  } else if (qtResolved === 'rolls_units') {
    numRollsH = String(nrStored)
    totalKgH = ''
    numUnitsH = ''
    const npu = js?.num_product_units != null ? Number(js.num_product_units) : NaN
    unitsPerRollH =
      Number.isFinite(npu) && npu > 0 && nrStored > 0 ? String(Math.max(1, Math.round(npu / nrStored))) : ''
    weightPerRollH = wpr
  } else {
    unitsPerRollH = ''
    numRollsH = String(js?.num_rolls ?? js?.quantity_value ?? nrStored)
    weightPerRollH = wpr
    totalKgH = ''
    numUnitsH = ''
  }

  const num = (s: string) => {
    const x = Number(s)
    return Number.isFinite(x) ? x : 0
  }

  const metersPerRoll = metersPerRollH.trim() !== '' ? num(metersPerRollH) : undefined
  const upr = unitsPerRollH.trim() !== '' ? Math.max(0, Math.round(num(unitsPerRollH))) : undefined

  return {
    qtyType: qtResolved,
    totalKg: num(totalKgH),
    numUnits: Math.max(0, Math.round(num(numUnitsH))),
    numRolls: Math.max(0, Math.round(num(numRollsH))),
    weightPerRoll: num(weightPerRollH),
    unitsPerRoll: upr,
    metersPerRoll: metersPerRoll != null && metersPerRoll > 0 ? metersPerRoll : undefined,
  }
}

/**
 * Fill gaps in persisted job sheet quantity before calculator/print (weight/roll, bags/roll).
 * Roll-weight billing target gauge needs billed weight/roll and a consistent roll count.
 */
export function enrichSpecQuantitySliceForPrint(
  slice: SpecQuantitySlice,
  js: Record<string, unknown> | null | undefined,
  spec: SpecPayload,
): SpecQuantitySlice {
  const prefs = orderQtyPrefsFromJobSheetAndSpec(js, spec)
  let numUnits = slice.numUnits
  if (!(numUnits > 0) && js?.num_product_units != null && Number.isFinite(Number(js.num_product_units))) {
    numUnits = Math.max(0, Math.round(Number(js.num_product_units)))
  }

  let weightPerRoll = slice.weightPerRoll
  if (!(weightPerRoll > 0) && prefs.weight_per_roll_kg != null && prefs.weight_per_roll_kg > 0) {
    weightPerRoll = prefs.weight_per_roll_kg
  }
  if (!(weightPerRoll > 0)) {
    const jsWpr = js?.weight_per_roll_kg != null ? Number(js.weight_per_roll_kg) : NaN
    if (Number.isFinite(jsWpr) && jsWpr > 0) weightPerRoll = jsWpr
  }

  let unitsPerRoll = slice.unitsPerRoll
  if ((unitsPerRoll == null || unitsPerRoll <= 0) && numUnits > 0) {
    const npu =
      js?.num_product_units != null && Number.isFinite(Number(js.num_product_units))
        ? Math.max(0, Math.round(Number(js.num_product_units)))
        : numUnits
    const nr =
      slice.numRolls > 0
        ? slice.numRolls
        : js?.num_rolls != null && Number.isFinite(Number(js.num_rolls))
          ? Math.max(1, Math.round(Number(js.num_rolls)))
          : 0
    if (npu > 0 && nr > 0) unitsPerRoll = Math.max(1, Math.round(npu / nr))
  }

  let numRolls = slice.numRolls
  if (slice.qtyType === 'units' && slice.numUnits > 0 && unitsPerRoll != null && unitsPerRoll > 0) {
    numRolls = Math.max(1, Math.ceil(slice.numUnits / unitsPerRoll))
  } else if (!(numRolls > 0) && js?.num_rolls != null && Number.isFinite(Number(js.num_rolls))) {
    numRolls = Math.max(1, Math.round(Number(js.num_rolls)))
  }

  if (!(weightPerRoll > 0) && slice.qtyType === 'kg' && slice.totalKg > 0 && numRolls > 0) {
    weightPerRoll = slice.totalKg / numRolls
  }

  return {
    ...slice,
    numUnits,
    weightPerRoll,
    unitsPerRoll: unitsPerRoll != null && unitsPerRoll > 0 ? unitsPerRoll : slice.unitsPerRoll,
    numRolls,
  }
}

export function buildSpecQuantitySliceFromPersistedJobSheet(
  js: Record<string, unknown> | null | undefined,
  spec: SpecPayload,
): SpecQuantitySlice {
  return enrichSpecQuantitySliceForPrint(parseQtyStrings(js, spec), js, spec)
}

/**
 * API-shaped job sheet row from live editor quantity state, for {@link jobSheetOrderQuantityLabel} / quote qty helpers.
 * Mirrors the quantity fields persisted on save (see job sheet editor `onSave`).
 */
export function buildLiveJobSheetRowForOrderQuantityLabel(opts: {
  effectiveQtyType: QtyType
  finishMode: FinishMode
  totalKgForScheduling: number
  numUnitsNum: number
  numRollsPersisted: number
  derivedProductUnits: number | null | undefined
  quantityValueFallback: number
  bagsPerCarton: number | null | undefined
  /** When set, matches job sheet editor carton ``1000`` vs ``CTN`` radio for Cartons finish. */
  cartonQtyMode?: '1000' | 'ctn'
  numCartonsNum?: number
  isImportDraft?: boolean
}): Record<string, unknown> {
  const oq = getOrderQuantityFromJobSheetFields(
    opts.effectiveQtyType,
    opts.quantityValueFallback,
    opts.totalKgForScheduling,
    opts.numUnitsNum,
    opts.numRollsPersisted,
    opts.finishMode,
    opts.bagsPerCarton,
    opts.finishMode === 'Cartons' ? opts.cartonQtyMode : undefined,
    opts.numCartonsNum ?? 0,
  )
  const numPuResolved = resolvedProductUnitsForOrder(
    opts.numUnitsNum,
    opts.numCartonsNum ?? 0,
    opts.bagsPerCarton,
  )
  const numPu =
    opts.effectiveQtyType === 'units' || opts.finishMode === 'Cartons'
      ? numPuResolved > 0
        ? numPuResolved
        : opts.derivedProductUnits != null && Number.isFinite(Number(opts.derivedProductUnits))
          ? Math.round(Number(opts.derivedProductUnits))
          : null
      : opts.derivedProductUnits != null && Number.isFinite(Number(opts.derivedProductUnits))
        ? Math.round(Number(opts.derivedProductUnits))
        : null
  const row: Record<string, unknown> = {
    qty_type: opts.effectiveQtyType,
    quantity_unit: oq.quantity_unit,
    quantity_value: oq.quantity_value,
    num_product_units: numPu,
    num_rolls: opts.numRollsPersisted,
  }
  if (opts.totalKgForScheduling > 0) row.total_kg = opts.totalKgForScheduling
  if (opts.isImportDraft) row.is_import_draft = true
  return row
}

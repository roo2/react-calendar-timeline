/**
 * Reconstruct quantity numbers from persisted job sheet + product spec (print preview, derived totals).
 * Mirrors the hydrate path in `JobSheetEditor` without React state.
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import {
  coerceQtyTypeForFinishMode,
  getOrderQuantityFromJobSheetFields,
  qtyTypeFromPersisted,
  type FinishMode,
  type QtyType,
} from './quantityRollFields'
import type { SpecQuantitySlice } from './specToQuoteInputs'

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
  if (x === '1000') return 'units'
  if (x === 'cartons' || x === 'bags' || x === 'meters') return 'units'
  return 'units'
}

function parseQtyStrings(js: Record<string, unknown> | null | undefined, spec: SpecPayload): SpecQuantitySlice {
  const isImportDraft = Boolean(js?.is_import_draft)
  const rawQu = String(js?.quantity_unit || '').toLowerCase()
  const rawQt =
    js?.qty_type != null && String(js.qty_type).trim()
      ? qtyTypeFromPersisted(String(js.qty_type))
      : inferQtyTypeFromUnit(String(js?.quantity_unit || ''))

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
    js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
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
    numUnitsH = ''
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

export function buildSpecQuantitySliceFromPersistedJobSheet(
  js: Record<string, unknown> | null | undefined,
  spec: SpecPayload,
): SpecQuantitySlice {
  return parseQtyStrings(js, spec)
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
  )
  const numPu =
    opts.effectiveQtyType === 'units'
      ? opts.numUnitsNum
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

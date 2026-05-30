import type { ProductListItem } from '../store/slices/productsSlice'
import {
  jobSheetQtyTypeForOrderUnit,
  orderQuantityUnitFromJobSheetQtyType,
} from './quantityRollFields'

export type OrderQuantityUnit = 'kg' | 'rolls' | 'cartons' | '1000' | 'ea' | 'meters'

export type ProductLastOrderDefaults = {
  quantity_value?: number | null
  quantity_unit?: string | null
  qty_type?: string | null
  weight_per_roll_kg?: number | null
  rate?: number | null
}

function finishModeForProduct(p: ProductListItem): 'Rolls' | 'Cartons' | null {
  const fm = p.finish_mode
  if (fm === 'Cartons') return 'Cartons'
  if (fm === 'Rolls') return 'Rolls'
  return null
}

function unitChoices(finish: 'Rolls' | 'Cartons' | null | undefined): OrderQuantityUnit[] {
  const f = finish === 'Cartons' ? 'Cartons' : 'Rolls'
  if (f === 'Cartons') return ['cartons', '1000']
  return ['kg', 'rolls', '1000']
}

function normalizeQuantityUnitFromApi(
  raw: string | undefined,
  finish: 'Rolls' | 'Cartons' | null,
): OrderQuantityUnit {
  const x = String(raw || 'kg').toLowerCase()
  if (x === 'ea' || x === 'each') return 'ea'
  if (x === 'rolls') return 'rolls'
  if (x === 'cartons') return 'cartons'
  if (x === '1000') return '1000'
  if (x === 'bags' && finish === 'Cartons') return 'cartons'
  return 'kg'
}

/**
 * Defaults when adding a product to an order: last job sheet for this customer, else product.default_qty_type, else kg.
 */
export function buildOrderLineDefaultsFromProduct(p: ProductListItem): {
  quantity_unit: OrderQuantityUnit
  quantity_value: string
  rate: string
  qty_type?: string
  weight_per_roll_kg?: number
} {
  const fm = finishModeForProduct(p)
  const finishForQty: 'Rolls' | 'Cartons' = fm === 'Cartons' ? 'Cartons' : 'Rolls'
  const allowed = unitChoices(fm)
  const specDefaults = p.order_defaults
  const last = p.last_order_defaults as ProductLastOrderDefaults | null | undefined
  const specWpr =
    specDefaults?.weight_per_roll_kg != null &&
    Number.isFinite(Number(specDefaults.weight_per_roll_kg)) &&
    Number(specDefaults.weight_per_roll_kg) > 0
      ? Number(specDefaults.weight_per_roll_kg)
      : null
  const lastWpr =
    last?.weight_per_roll_kg != null &&
    Number.isFinite(Number(last.weight_per_roll_kg)) &&
    Number(last.weight_per_roll_kg) > 0
      ? Number(last.weight_per_roll_kg)
      : null
  const weight_per_roll_kg = specWpr ?? lastWpr ?? undefined

  if (last) {
    const lastQt = (last.qty_type || '').trim()
    let unit =
      (lastQt ? orderQuantityUnitFromJobSheetQtyType(lastQt, finishForQty) : null) ??
      normalizeQuantityUnitFromApi(last.quantity_unit ?? undefined, fm)
    if (!allowed.includes(unit)) unit = allowed[0]
    const qv =
      last.quantity_value != null && Number.isFinite(Number(last.quantity_value)) && Number(last.quantity_value) > 0
        ? String(last.quantity_value)
        : '1'
    const rate = last.rate != null && Number.isFinite(Number(last.rate)) && Number(last.rate) >= 0 ? String(last.rate) : ''
    const qt = jobSheetQtyTypeForOrderUnit(unit, lastQt || undefined)
    return { quantity_unit: unit, quantity_value: qv, rate, ...(qt ? { qty_type: qt } : {}), ...(weight_per_roll_kg ? { weight_per_roll_kg } : {}) }
  }

  const dqt = (specDefaults?.qty_type || p.default_qty_type || '').trim()
  if (dqt) {
    const fromType = orderQuantityUnitFromJobSheetQtyType(dqt, finishForQty)
    const unit = fromType && allowed.includes(fromType) ? fromType : allowed[0]
    const qt = jobSheetQtyTypeForOrderUnit(unit, dqt)
    return { quantity_unit: unit, quantity_value: '1', rate: '', ...(qt ? { qty_type: qt } : {}), ...(weight_per_roll_kg ? { weight_per_roll_kg } : {}) }
  }

  return { quantity_unit: allowed[0] ?? 'kg', quantity_value: '1', rate: '', ...(weight_per_roll_kg ? { weight_per_roll_kg } : {}) }
}

import type { ProductListItem } from '../store/slices/productsSlice'

export type OrderQuantityUnit = 'kg' | 'rolls' | 'cartons' | '1000' | 'ea' | 'meters'

export type ProductLastOrderDefaults = {
  quantity_value?: number | null
  quantity_unit?: string | null
  qty_type?: string | null
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
  if (f === 'Cartons') return ['kg', 'cartons', '1000']
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

function quantityUnitFromQtyType(
  qtyType: string | undefined,
  finish: 'Rolls' | 'Cartons' | null,
): OrderQuantityUnit | null {
  const qt = String(qtyType || '').trim().toLowerCase()
  if (qt === 'kg') return 'kg'
  if (qt === 'total_rolls') return 'rolls'
  if (qt === 'units' || qt === 'rolls_units') return finish === 'Cartons' ? 'cartons' : '1000'
  return null
}

/**
 * Defaults when adding a product to an order: last job sheet for this customer, else product.default_qty_type, else kg.
 */
export function buildOrderLineDefaultsFromProduct(p: ProductListItem): {
  quantity_unit: OrderQuantityUnit
  quantity_value: string
  rate: string
} {
  const fm = finishModeForProduct(p)
  const allowed = unitChoices(fm)
  const last = p.last_order_defaults as ProductLastOrderDefaults | null | undefined

  if (last) {
    let unit = normalizeQuantityUnitFromApi(last.quantity_unit ?? undefined, fm)
    if (!allowed.includes(unit)) unit = allowed[0]
    const qv =
      last.quantity_value != null && Number.isFinite(Number(last.quantity_value)) && Number(last.quantity_value) > 0
        ? String(last.quantity_value)
        : '1'
    const rate = last.rate != null && Number.isFinite(Number(last.rate)) && Number(last.rate) >= 0 ? String(last.rate) : ''
    return { quantity_unit: unit, quantity_value: qv, rate }
  }

  const dqt = (p.default_qty_type || '').trim()
  if (dqt) {
    const fromType = quantityUnitFromQtyType(dqt, fm)
    const unit = fromType && allowed.includes(fromType) ? fromType : allowed[0]
    return { quantity_unit: unit, quantity_value: '1', rate: '' }
  }

  return { quantity_unit: allowed[0] ?? 'kg', quantity_value: '1', rate: '' }
}

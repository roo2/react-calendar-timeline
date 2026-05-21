import type { SpecPayload } from '../components/SpecPayloadForm'

/** Read rolls/cartons to stock from job sheet row, with legacy fallback from spec conversion. */
export function qtyToStockFromJobSheetAndSpec(
  js: Record<string, unknown> | null | undefined,
  spec: SpecPayload | null | undefined,
): number | null {
  const rawJs = js?.qty_to_stock
  if (rawJs != null && Number.isFinite(Number(rawJs))) {
    const n = Math.max(0, Math.round(Number(rawJs)))
    return n
  }
  const rr = (spec as { run_requirements?: { conversion?: { qty_to_stock?: unknown } } } | null | undefined)
    ?.run_requirements
  const rawSpec = rr?.conversion?.qty_to_stock
  if (rawSpec != null && Number.isFinite(Number(rawSpec))) {
    return Math.max(0, Math.round(Number(rawSpec)))
  }
  return null
}

export function formatQtyToStockForInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return ''
  return String(Math.max(0, Math.round(Number(value))))
}

export function qtyToStockExceedsOrderTotal(
  qtyToStock: number | null | undefined,
  orderTotalUnits: number | null | undefined,
): boolean {
  if (
    qtyToStock == null ||
    orderTotalUnits == null ||
    !Number.isFinite(Number(orderTotalUnits)) ||
    Number(orderTotalUnits) <= 0
  ) {
    return false
  }
  return qtyToStock > Math.round(Number(orderTotalUnits))
}

export function parseQtyToStockInput(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.max(0, Math.round(n))
}

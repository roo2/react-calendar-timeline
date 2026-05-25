import type { SpecPayload } from '../components/SpecPayloadForm'
import {
  DEFAULT_OVERPRODUCTION_HANDLING,
  isCustomerOverproductionHandling,
  normalizeCustomerOverproductionHandling,
  type CustomerOverproductionHandling,
} from './customerOverproductionHandling'
import type { FinishMode, QtyType } from './quantityRollFields'
import { getOrderQuantityFromJobSheetFields, qtyTypeFromPersisted } from './quantityRollFields'

export type SpecOrderDefaults = {
  qty_type?: string | null
  quantity_unit?: string | null
  weight_per_roll_kg?: number | null
  customer_facing_description?: string | null
  customer_overproduction_handling?: CustomerOverproductionHandling | null
}

export function getSpecOrderDefaults(spec: SpecPayload | null | undefined): SpecOrderDefaults {
  const od = (spec as { order_defaults?: SpecOrderDefaults } | null | undefined)?.order_defaults
  if (!od || typeof od !== 'object') return {}
  return {
    qty_type: od.qty_type != null && String(od.qty_type).trim() ? String(od.qty_type).trim() : null,
    quantity_unit:
      od.quantity_unit != null && String(od.quantity_unit).trim() ? String(od.quantity_unit).trim() : null,
    weight_per_roll_kg:
      od.weight_per_roll_kg != null && Number.isFinite(Number(od.weight_per_roll_kg))
        ? Number(od.weight_per_roll_kg)
        : null,
    customer_facing_description:
      od.customer_facing_description != null && String(od.customer_facing_description).trim()
        ? String(od.customer_facing_description)
        : null,
    customer_overproduction_handling: isCustomerOverproductionHandling(od.customer_overproduction_handling)
      ? od.customer_overproduction_handling
      : null,
  }
}

export function customerOverproductionFromSpec(
  spec: SpecPayload | null | undefined,
  finishMode: FinishMode,
): CustomerOverproductionHandling {
  const raw = getSpecOrderDefaults(spec).customer_overproduction_handling
  return normalizeCustomerOverproductionHandling(raw ?? DEFAULT_OVERPRODUCTION_HANDLING, finishMode)
}

export function mergeOrderDefaultsIntoSpec(spec: SpecPayload, patch: SpecOrderDefaults): SpecPayload {
  const prev = getSpecOrderDefaults(spec)
  return {
    ...spec,
    order_defaults: {
      ...prev,
      ...patch,
    },
  }
}

/** Product-level qty prefs: spec `order_defaults` first, then legacy job sheet columns. */
export function orderQtyPrefsFromJobSheetAndSpec(
  js: Record<string, unknown> | null | undefined,
  spec: SpecPayload,
): {
  qty_type: string | null
  quantity_unit: string | null
  weight_per_roll_kg: number | null
  customer_facing_description: string | null
  customer_overproduction_handling: CustomerOverproductionHandling | null
} {
  const od = getSpecOrderDefaults(spec)
  const jsQt = js?.qty_type != null && String(js.qty_type).trim() ? String(js.qty_type).trim() : null
  const jsQu = js?.quantity_unit != null && String(js.quantity_unit).trim() ? String(js.quantity_unit).trim() : null
  const jsWpr =
    js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
      ? Number(js.weight_per_roll_kg)
      : null
  const jsCfd =
    js?.customer_facing_description != null && String(js.customer_facing_description).trim()
      ? String(js.customer_facing_description).trim()
      : null
  return {
    qty_type: od.qty_type ?? jsQt,
    quantity_unit: od.quantity_unit ?? jsQu,
    weight_per_roll_kg: od.weight_per_roll_kg ?? jsWpr,
    customer_facing_description: od.customer_facing_description ?? jsCfd,
    customer_overproduction_handling: od.customer_overproduction_handling ?? null,
  }
}

export function buildOrderDefaultsFromEditor(opts: {
  effectiveQtyType: QtyType
  finishMode: FinishMode
  weightPerRollNum: number
  customerFacingDescription: string
  bagsPerCarton?: number | null
  cartonQtyMode?: '1000' | 'ctn'
  customerOverproductionHandling?: CustomerOverproductionHandling | null
}): SpecOrderDefaults {
  const oq = getOrderQuantityFromJobSheetFields(
    opts.effectiveQtyType,
    1,
    0,
    0,
    1,
    opts.finishMode,
    opts.bagsPerCarton ?? null,
    opts.finishMode === 'Cartons' ? opts.cartonQtyMode : undefined,
    0,
  )
  const wpr = opts.weightPerRollNum > 0 && Number.isFinite(opts.weightPerRollNum) ? opts.weightPerRollNum : null
  const cfd = String(opts.customerFacingDescription ?? '').trim()
  const oph = normalizeCustomerOverproductionHandling(
    opts.customerOverproductionHandling ?? DEFAULT_OVERPRODUCTION_HANDLING,
    opts.finishMode,
  )
  return {
    qty_type: opts.effectiveQtyType,
    quantity_unit: oq.quantity_unit,
    weight_per_roll_kg: wpr,
    customer_facing_description: cfd || null,
    customer_overproduction_handling: oph,
  }
}

export function orderDefaultsEqual(a: SpecOrderDefaults, b: SpecOrderDefaults): boolean {
  return (
    String(a.qty_type ?? '') === String(b.qty_type ?? '') &&
    String(a.quantity_unit ?? '') === String(b.quantity_unit ?? '') &&
    (a.weight_per_roll_kg ?? null) === (b.weight_per_roll_kg ?? null) &&
    String(a.customer_facing_description ?? '').trim() === String(b.customer_facing_description ?? '').trim()
  )
}

/** Raw value for form fields — do not trim (trimming breaks spaces while typing). */
export function customerFacingDescriptionFromSpec(spec: SpecPayload | null | undefined): string {
  const v = getSpecOrderDefaults(spec).customer_facing_description
  return v != null ? String(v) : ''
}

export function persistedQtyTypeFromPrefs(
  prefs: { qty_type: string | null; quantity_unit: string | null },
  fallbackUnit?: string,
): QtyType {
  if (prefs.qty_type) return qtyTypeFromPersisted(prefs.qty_type)
  const u = String(prefs.quantity_unit || fallbackUnit || '').toLowerCase()
  if (u === 'rolls') return 'total_rolls'
  if (u === 'kg') return 'kg'
  if (u === '1000') return 'units'
  if (u === 'cartons' || u === 'bags' || u === 'meters') return 'units'
  return 'units'
}

/** Extrusion roll count for QC table (cartons: kg ÷ roll weight; rolls: scheduling roll count). */
export function extrusionRollCountForPrint(opts: {
  finishMode: FinishMode
  totalKg: number | null
  weightPerRollKg: number | null
  schedulingRollCount: number | null
}): number {
  const sched = opts.schedulingRollCount != null && opts.schedulingRollCount > 0 ? opts.schedulingRollCount : null
  if (opts.finishMode === 'Cartons') {
    const tk = opts.totalKg != null && opts.totalKg > 0 ? opts.totalKg : null
    const wpr = opts.weightPerRollKg != null && opts.weightPerRollKg > 0 ? opts.weightPerRollKg : null
    if (tk != null && wpr != null) return Math.max(1, Math.ceil(tk / wpr))
    return sched ?? 5
  }
  return sched != null && sched > 0 ? sched : 5
}

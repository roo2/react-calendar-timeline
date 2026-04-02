/**
 * Maps quote form payload (payloadForSave / initialData.payload) to product SpecPayload
 * and to order item quantity for "Convert to order".
 */

import type { SpecPayload } from '../components/SpecPayloadForm'

export type QuotePayload = {
  product_type?: string
  geometry?: string
  base_width_mm?: number | null
  base_length_mm?: number | null
  thickness_um?: number | null
  gusset_mm?: number | null
  ufilm_left_width_mm?: number | null
  ufilm_right_width_mm?: number | null
  length_units?: 'mm' | 'M' | 'm' | 'continuous' | 'Continuous'
  continuous_roll?: boolean
  trim_pct?: number | null
  width_tolerance_mm?: number | null
  blend?: Array<{ resin_code: string; pct: number }>
  resin_code?: string | null
  colour_components?: Array<{ colour_code?: string; strength_pct?: number | null }>
  additives?: Array<{ additive_code: string; pct?: number | null }>
  print_method?: string
  num_colours?: number | null
  finish_mode?: 'Rolls' | 'Cartons'
  core_type?: string | null
  roll_weight_billing?: string | null
  bags_per_carton?: number | null
  carton_option_slug?: string | null
  pallet_type?: string
  inline_perforation?: boolean
  inline_seal?: boolean
  hole_punched?: boolean
  run_up?: number | null
  qtyType?: 'kg' | 'units' | 'total_rolls' | 'rolls_units'
  /** When qtyType is rolls_units: products (e.g. bags) per roll. */
  unitsPerRoll?: string | number
  totalKg?: string | number
  numUnits?: string | number
  numRolls?: string | number
  weightPerRoll?: string | number
  /** Snapshot from last save: calculator total kg (excluded from spec edit-detection). */
  quoted_totals_kg?: number | null
  /** Snapshot from last save: suggested total price (excluded from spec edit-detection). */
  quoted_total_price?: number | null
  /** Free-text quote notes (not part of product spec). */
  notes?: string | null
  [k: string]: unknown
}

function runUpToSpec(runUp: number | null | undefined): 'none' | '2up' | '4up' | '6up' {
  if (runUp == null) return 'none'
  if (runUp === 2) return '2up'
  if (runUp === 4) return '4up'
  if (runUp === 6) return '6up'
  return 'none'
}

function rollWeightBillingToCorePolicy(
  v: string | null | undefined
): 'Include' | 'Half' | 'Exclude' {
  if (v === 'core_half_off') return 'Half'
  if (v === 'core_off') return 'Exclude'
  return 'Include'
}

/** Normalize blend so percentages sum to 100 for backend validation. */
function normalizeBlend(
  blend: QuotePayload['blend']
): Array<{ resin_code: string; pct: number }> {
  if (!Array.isArray(blend) || blend.length === 0) {
    return [{ resin_code: 'LDPE', pct: 100 }]
  }
  const total = blend.reduce((s, c) => s + (Number(c.pct) || 0), 0)
  if (total <= 0) return [{ resin_code: 'LDPE', pct: 100 }]
  if (Math.abs(total - 100) < 0.01) return blend.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))
  const scale = 100 / total
  return blend.map((c) => ({
    resin_code: c.resin_code,
    pct: Math.round(c.pct * scale * 100) / 100,
  }))
}

/**
 * Build a full SpecPayload from the saved quote payload (or current quote form state).
 * Uses defaults for required fields when quote values are missing.
 */
function quotePayloadUsesContinuousLength(p: QuotePayload): boolean {
  const pt = String(p.product_type || '')
  if (pt === 'Tube') return true
  if (p.continuous_roll) return true
  const lu = String(p.length_units || '').toLowerCase()
  return lu === 'continuous'
}

function quoteLengthUnitsToSpec(p: QuotePayload, continuous: boolean): 'mm' | 'M' | 'Continuous' {
  if (continuous) return 'Continuous'
  const lu = String(p.length_units || 'mm').toLowerCase()
  if (lu === 'm') return 'M'
  return 'mm'
}

export function buildSpecFromQuotePayload(payload: QuotePayload): SpecPayload {
  const p = payload as QuotePayload
  const baseWidthMm = Math.max(1, Number(p.base_width_mm) || 1)
  const thicknessUm = Math.max(1, Number(p.thickness_um) || 1)
  const continuousLength = quotePayloadUsesContinuousLength(p)
  const baseLengthMm =
    continuousLength && p.finish_mode === 'Rolls'
      ? null
      : p.finish_mode === 'Rolls'
        ? (p.base_length_mm != null ? Number(p.base_length_mm) : null) ?? null
        : Math.max(1, Number(p.base_length_mm) || 1)
  const geometry =
    (p.geometry as 'Flat' | 'Gusset' | 'BottomGusset' | 'CentreFold') || 'Flat'
  const gussetMm =
    p.gusset_mm != null && Number(p.gusset_mm) > 0 ? Math.round(Number(p.gusset_mm)) : null
  const ufilmLeft =
    p.ufilm_left_width_mm != null && Number(p.ufilm_left_width_mm) > 0
      ? Math.round(Number(p.ufilm_left_width_mm))
      : null
  const ufilmRight =
    p.ufilm_right_width_mm != null && Number(p.ufilm_right_width_mm) > 0
      ? Math.round(Number(p.ufilm_right_width_mm))
      : null

  const blend = normalizeBlend(p.blend)
  const colourComponents = (p.colour_components || []).map((c) => ({
    colour_code: (c.colour_code || '').trim() || null,
    strength_pct: c.strength_pct != null ? Number(c.strength_pct) : null,
  }))
  const additives = (p.additives || [])
    .filter((a) => (a.additive_code || '').trim())
    .map((a) => ({
      additive_code: (a.additive_code || '').trim(),
      pct: Number(a.pct) || 0,
    }))

  const finishMode = p.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const packMode = finishMode
  const coreType = (p.core_type as '7mm' | '13mm' | 'PVC' | 'None') || '7mm'
  const corePolicy = rollWeightBillingToCorePolicy(p.roll_weight_billing)
  const bagsPerCarton =
    finishMode === 'Cartons'
      ? (p.bags_per_carton != null ? Number(p.bags_per_carton) : null) ?? 1
      : null
  const palletType = (p.pallet_type as 'Chep' | 'Plain' | 'Resin' | 'None') || 'Chep'

  const printMethod = (p.print_method as 'None' | 'Inline' | 'Uteco') || 'None'
  const numColours =
    printMethod !== 'None' ? Math.max(0, Math.round(Number(p.num_colours) || 0)) : null

  return {
    identity: {
      product_type: (p.product_type as any) || 'Bag',
      finish_mode: finishMode,
      trim_pct: p.trim_pct != null ? Number(p.trim_pct) : null,
      roll_weight_billing: p.roll_weight_billing || 'core_off',
      industry_flags: [],
      notes: null,
    },
    dimensions: {
      base_width_mm: baseWidthMm,
      width_tolerance_mm:
        p.width_tolerance_mm != null && Number.isFinite(Number(p.width_tolerance_mm))
          ? Number(p.width_tolerance_mm)
          : null,
      base_length_mm: baseLengthMm ?? undefined,
      thickness_um: thicknessUm,
      geometry,
      gusset_mm: gussetMm ?? undefined,
      ufilm_left_width_mm: ufilmLeft ?? undefined,
      ufilm_right_width_mm: ufilmRight ?? undefined,
      length_units: quoteLengthUnitsToSpec(p, continuousLength),
    },
    formulation: {
      blend_type: 'LD',
      blend,
      colour: null,
      colour_components: colourComponents,
      additives,
    },
    printing: {
      method: printMethod,
      num_colours: numColours ?? null,
      print_description: null,
      ink_codes: [],
      plate_codes: [],
      side: null,
      artwork_refs: [],
      front_ink_plate: [],
      back_ink_plate: [],
      cylinder_size_mm: null,
    },
    quality_expectations: {
      flags: [],
      known_issues: null,
    },
    run_requirements: {
      preferred_extruders: [],
      preferred_printer: null,
      preferred_converter: null,
      run_up: runUpToSpec(p.run_up ?? null),
      slit: 'none',
      treat_inside_outside: 'none',
      inline_perforation: !!p.inline_perforation,
      hole_punched: !!p.hole_punched,
      inline_seal: !!p.inline_seal,
      notes: null,
    },
    packaging: {
      pack_mode: packMode,
      core_type: coreType,
      core_policy: corePolicy,
      bags_per_carton: bagsPerCarton ?? null,
      carton_option_slug: p.carton_option_slug ?? null,
      pallet_type: palletType,
      notes: null,
    },
    tool_requirements: [],
  }
}

export type OrderQuantity = {
  quantity_value: number
  quantity_unit: 'kg' | 'rolls' | 'bags' | 'meters'
}

/**
 * Derive order item quantity from quote payload (qtyType, totalKg, numUnits, numRolls, unitsPerRoll).
 */
export function getOrderQuantityFromQuotePayload(payload: QuotePayload): OrderQuantity {
  const p = payload
  const qtyType = p.qtyType || 'kg'
  const totalKg = Number(p.totalKg) || 0
  const numUnits = Math.round(Number(p.numUnits) || 0)
  const numRolls = Math.round(Number(p.numRolls) || 0)
  const unitsPerRoll = Math.round(Number(p.unitsPerRoll) || 0)

  if (qtyType === 'kg') {
    return {
      quantity_value: totalKg > 0 ? totalKg : 1,
      quantity_unit: 'kg',
    }
  }
  if (qtyType === 'total_rolls') {
    return {
      quantity_value: numRolls > 0 ? numRolls : 1,
      quantity_unit: 'rolls',
    }
  }
  if (qtyType === 'rolls_units') {
    const total = numRolls > 0 && unitsPerRoll > 0 ? numRolls * unitsPerRoll : 0
    return {
      quantity_value: total > 0 ? total : 1,
      quantity_unit: 'bags',
    }
  }
  // units (bags / U-Films / etc.)
  return {
    quantity_value: numUnits > 0 ? numUnits : 1,
    quantity_unit: 'bags',
  }
}

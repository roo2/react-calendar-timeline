/**
 * Build QuickQuoteInputs from a product SpecPayload + quantity slice (for Job Sheet / shared tooling).
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import {
  getDefaultResinCodeFromRatebook,
  getRollWeightAvgKg,
  type QuickQuoteInputs,
  type QuoteRatebook,
} from './quoteCalculator'
import { buildQuantityObjectForCalculator, type FinishMode, type QtyType } from './quantityRollFields'
import { productTypeCanHaveGusset } from './specCompat'

function dimensionsAreContinuous(dim: any, productType: string): boolean {
  const lu = String(dim?.length_units || '')
  if (lu === 'Continuous' || lu.toLowerCase() === 'continuous') return true
  return productType === 'Tube'
}

function baseLengthMmFromDimensions(dim: any, productType: string): number {
  if (dimensionsAreContinuous(dim, productType)) return 0
  const raw = Number(dim?.base_length_mm || 0)
  // `base_length_mm` is always stored in millimetres (SpecPayloadForm converts M→mm on input).
  // Do not scale again when `length_units` is M — that would double-count vs the form and blow up
  // rolls_units total_m / kg (e.g. Sleeve + M + Rolls × sleeves per roll).
  return Math.round(raw)
}

function runUpToNumber(runUp: string | undefined): number | null {
  if (!runUp || runUp === 'none') return 1
  if (runUp === '2up') return 2
  if (runUp === '4up') return 4
  if (runUp === '6up') return 6
  return 1
}

function mapPrintMethod(m: string | undefined): 'None' | 'Inline' | 'Uteco' {
  if (m === 'Inline') return 'Inline'
  if (m === 'Uteco') return 'Uteco'
  return 'None'
}

function mapRollBilling(
  v: string | undefined,
): 'core_included' | 'core_off' | 'core_half_off' | null {
  if (v === 'core_half_off') return 'core_half_off'
  if (v === 'core_off') return 'core_off'
  if (v === 'core_included') return 'core_included'
  return 'core_off'
}

export type SpecQuantitySlice = {
  qtyType: QtyType
  totalKg: number
  numUnits: number
  numRolls: number
  weightPerRoll: number
  /** For qtyType rolls_units: discrete units per roll (e.g. bags per roll). */
  unitsPerRoll?: number
}

/**
 * Convert SpecPayload + quantity numbers into QuickQuoteInputs for computeDerivedGeometryAndTotals.
 */
export function buildQuickQuoteInputsFromSpec(
  spec: SpecPayload,
  quantity: SpecQuantitySlice,
  opts?: { extruderCode?: string | null; ratebook?: QuoteRatebook | null },
): QuickQuoteInputs {
  const id = (spec as any).identity || {}
  const dim = (spec as any).dimensions || {}
  const form = (spec as any).formulation || {}
  const print = (spec as any).printing || {}
  const pack = (spec as any).packaging || {}
  const run = (spec as any).run_requirements || {}

  const productType = id.product_type || 'Bag'
  const canHaveGusset = productTypeCanHaveGusset(productType)
  const flagGusset = dim.geometry === 'Gusset' && canHaveGusset
  const derivedGeometry: 'Flat' | 'Gusset' = flagGusset ? 'Gusset' : 'Flat'

  const finishMode: FinishMode = id.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const continuousRoll = dimensionsAreContinuous(dim, productType)
  const baseLengthMm = baseLengthMmFromDimensions(dim, productType)
  /** Continuous products use 0 here for fixed-length fields, but quantity still needs mm for `total_m` (CSV/job tools). */
  const rawLenMm = Math.round(Number(dim?.base_length_mm || 0))
  const lengthMmForQuantity = continuousRoll && rawLenMm > 0 ? rawLenMm : baseLengthMm
  const widthMmNum = Math.round(Number(dim.base_width_mm || 0))
  const ufilmLeftWidthMmNum = Math.round(Number(dim.ufilm_left_width_mm || 0))
  const ufilmRightWidthMmNum = Math.round(Number(dim.ufilm_right_width_mm || 0))
  const thicknessUmNum = Math.round(Number(dim.thickness_um || 0))
  const gussetReturnMmNum = Math.round(Number(dim.gusset_mm || 0))
  const isUFilm = productType === 'U-Film'

  const showRunUp = !isUFilm && (productType === 'Sheet' || productType === 'Centerfold')
  const runUp = showRunUp ? runUpToNumber(run.run_up) : 1

  const blend = Array.isArray(form.blend)
    ? form.blend.map((c: any) => ({ resin_code: String(c.resin_code || '').trim(), pct: Number(c.pct) || 0 }))
    : []

  const colourComponents = Array.isArray(form.colour_components)
    ? form.colour_components
        .map((c: any) => ({
          colour_code: String(c.colour_code || '').trim(),
          strength_pct: c.strength_pct != null ? Number(c.strength_pct) : null,
        }))
        .filter((c: any) => c.colour_code && c.strength_pct != null && Number(c.strength_pct) > 0)
    : []

  const additives = Array.isArray(form.additives)
    ? form.additives
        .filter((a: any) => (a.additive_code || '').trim())
        .map((a: any) => ({
          additive_code: String(a.additive_code || '').trim(),
          pct: a.pct != null ? Number(a.pct) : null,
        }))
    : []

  const printMethod = mapPrintMethod(print.method)
  const numColours = printMethod !== 'None' ? Math.max(0, Math.round(Number(print.num_colours || 0))) : 0

  const trimPct = id.trim_pct != null && id.trim_pct !== '' ? Number(id.trim_pct) : null

  const bagsPerCartonNum =
    finishMode === 'Cartons' && pack.bags_per_carton != null ? Math.round(Number(pack.bags_per_carton || 0)) : 0

  const qty = buildQuantityObjectForCalculator(
    quantity.qtyType,
    finishMode,
    quantity.totalKg,
    quantity.numRolls,
    quantity.weightPerRoll,
    quantity.numUnits,
    lengthMmForQuantity,
    quantity.unitsPerRoll ?? 0,
    {
      continuousLength: continuousRoll,
      bagsPerCarton: bagsPerCartonNum > 0 ? bagsPerCartonNum : undefined,
      /** Matches QuotesPage calcPayload when weight/roll is blank (Tube on continuous web). */
      rollWeightAvgKg: getRollWeightAvgKg(opts?.ratebook ?? null),
    },
  )

  return {
    override_price_per_kg: null,
    product_type: productType,
    geometry: derivedGeometry,
    base_width_mm: widthMmNum,
    run_up: showRunUp ? runUp : null,
    ufilm_left_width_mm: isUFilm ? ufilmLeftWidthMmNum : null,
    ufilm_right_width_mm: isUFilm ? ufilmRightWidthMmNum : null,
    thickness_um: thicknessUmNum,
    base_length_mm: baseLengthMm,
    continuous_roll: continuousRoll,
    inline_perforation: !!run.inline_perforation,
    inline_seal: !!run.inline_seal,
    hole_punched: !!run.hole_punched,
    gusset_mm: canHaveGusset && flagGusset ? gussetReturnMmNum : null,
    trim_pct: trimPct,
    resin_blend_code: form.blend_type != null ? String(form.blend_type) : null,
    print_method: printMethod,
    num_colours: numColours,
    finish_mode: finishMode,
    bags_per_carton: finishMode === 'Cartons' ? (pack.bags_per_carton != null ? Number(pack.bags_per_carton) : null) : null,
    core_type: pack.core_type != null ? String(pack.core_type) : '13mm',
    roll_weight_billing: finishMode === 'Rolls' ? mapRollBilling(id.roll_weight_billing) : null,
    extruder_code: opts?.extruderCode ?? null,
    colour_components: colourComponents,
    additives,
    blend: blend.length ? blend : undefined,
    resin_code: blend.length ? null : getDefaultResinCodeFromRatebook(opts?.ratebook ?? null),
    quantity: qty,
    nominal_weight_per_roll_kg:
      finishMode === 'Rolls' && Number.isFinite(quantity.weightPerRoll) && quantity.weightPerRoll > 0
        ? quantity.weightPerRoll
        : null,
  }
}

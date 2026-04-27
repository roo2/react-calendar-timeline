import type { QtyType } from './quantityRollFields'

export type MaterialsRetailBand = {
  id?: number
  product_group: 'tube' | 'centerfold' | 'sheet' | 'u_film' | 'bag' | string
  width_min_mm: number
  width_max_mm: number
  moq_plain_kg: number | null
  retail_price_per_kg: number | null
  moq_printed_kg: number | null
}

export type QuoteRatebook = {
  resins: Record<string, { price_per_kg: number; density: number }>
  additives_price_per_kg: Record<string, number>
  colours: Record<string, { price_per_kg: number }>
  cores: Record<string, { cost_per_meter: number; kg_per_meter: number }>
  /** Width-band retail material $/kg + MOQs (replaces legacy single add-on). */
  materials_retail_bands?: MaterialsRetailBand[]
  /**
   * Markups on incremental formulation **cost** (job $) → extra sell line under Materials.
   * Each value is a decimal rate (e.g. 0.25 → add 25% of that incremental cost to the quote).
   */
  quote_formulation_margins?: {
    colours_markup?: number
    additives_markup?: number
    custom_resin_blend_markup?: number
  }
  extruders?: Array<{
    extruder_code: string
    model: string | null
    decision_width_mm: number | null
    average_kg_hr: number | null
    cost_per_hr: number | null
  }>
  printing_pricing_tiers?: Array<{
    method: 'inline' | 'uteco'
    max_print_width_mm: number
    num_colours: number
    min_meters: number
    min_charge: number | null
    setup_cost: number
    setup_price: number | null
    cost_per_1000m: number
    price_per_1000m: number
    meters_per_min?: number | null
  }>
  printing_rates: Record<
    string,
    { method: string; cost_per_1000m: number; setup_cost: number; setup_minutes: number; minimum_charge: number; duplex_supported: boolean }
  >
  conversion_speeds?: Array<{
    min_gauge_um: number
    max_gauge_um: number
    min_length_mm: number
    max_length_mm: number
    bags_per_minute: number
  }>
  conversion_factors?: Record<string, number>
  waste_adders: Array<{ condition: string; waste_minutes: number }>
  extrusion_waste_factors?: Array<{ slug: string; minutes: number }>
  extrusion_throughput_kg_per_hr: number
  /** Pallet estimation for quotes */
  packing_factor_rolls?: number
  packing_factor_cartons?: number
  pallet_volume_m3?: number
}

export type QuickQuoteInputs = {
  /** When set (>0), total job price = this × billed kg (overrides sum of retail components). */
  override_price_per_kg?: number | null
  product_type: string
  geometry: 'Flat' | 'Gusset'
  base_width_mm: number
  run_up?: number | null
  ufilm_left_width_mm?: number | null
  ufilm_right_width_mm?: number | null
  thickness_um: number
  base_length_mm: number
  continuous_roll: boolean
  inline_perforation?: boolean
  inline_seal?: boolean
  hole_punched?: boolean
  gusset_mm: number | null
  trim_pct: number | null
  resin_blend_code?: string | null
  print_method: 'None' | 'Inline' | 'Uteco'
  num_colours: number
  finish_mode: 'Rolls' | 'Cartons'
  bags_per_carton?: number | null
  core_type: string | null
  roll_weight_billing?: 'core_included' | 'core_off' | 'core_half_off' | null
  extruder_code?: string | null
  opaque?: boolean
  colour_components?: Array<{ colour_code: string; strength_pct: number | null }>
  additives?: Array<{ additive_code: string; pct: number | null }>
  blend?: Array<{ resin_code: string; pct: number }>
  resin_code?: string | null
  quantity: { units?: number; total_kg?: number; total_m?: number; rolls?: number }
  /**
   * How quantity was entered on the Quotes page (MOQ hint only; optional elsewhere).
   */
  qty_entry_type?: QtyType | null
  /**
   * Rolls + continuous length: nominal billed kg per roll from the quote form.
   * Used when resolving reference mass per "product" if `quantity.total_kg` is missing or not yet wired.
   */
  nominal_weight_per_roll_kg?: number | null
}

export type MaterialsMoqMinimumHint =
  | { kind: 'units'; nounPlural: string; minimumTotal: number }
  | { kind: 'kg'; minimumTotalKg: number }
  | { kind: 'rolls'; minimumTotalRolls: number }

export type QuotePreview = {
  kg_per_unit: number | null
  units_per_roll: number | null
  /** Roll count for the job when finish mode is Rolls (for per-roll summary). */
  rolls: number | null
  totals_kg: number | null
  totals_units: number | null
  totals_m: number | null
  kg_per_roll: number | null
  m_per_roll: number | null
  cost_per_kg: number | null
  /** Effective sell-side $/kg (final job price ÷ billed kg; equals override when set). */
  price_per_kg: number | null
  extrusion_hours: number | null
  extrusion_waste_minutes: number
  /** Productive plastic (derived) plus kg run to waste during extrusion downtime (ratebook waste adders + extrusion waste minutes × throughput). */
  total_extruded_kg: number | null
  conversion_minutes_total?: number | null
  conversion_minutes_run?: number | null
  conversion_minutes_roll_changes?: number | null
  cartons?: number | null
  kg_per_carton?: number | null
  printing_unavailable_reason?: string | null
  /** Single-line MOQ hint for the current plain/printed selection (product width band). */
  materials_moq_summary_line?: string | null
  materials_moq_warning?: string | null
  /** When below materials MOQ: minimum total for the selected qty type (rolls / units / kg). */
  materials_moq_minimum_hint?: MaterialsMoqMinimumHint | null
  cost_breakdown: {
    material_cost: number
    /** Incremental material cost for colours + additives + non-LD resin uplift (subset of material_cost). */
    formulation_line_cost: number
    extrusion_cost: number
    printing_cost: number
    conversion_cost: number
    core_cost: number
    waste_cost: number
  }
  price_breakdown: {
    material_price: number
    /** Sell-side pass-through: incremental formulation cost × configured markups (not included in material_price). */
    formulation_line_price: number
    extrusion_price: number
    printing_price: number
    conversion_price: number
    core_price: number
    waste_price: number
  }
  /** Sell-side only: delta when `override_price_per_kg` is set (target job price − summed retail). */
  adjustments_price: number | null
  /** True when a positive `override_price_per_kg` is applied (shows Adjustments row in preview). */
  price_override_active: boolean
  total_cost: number
  /** Sum of retail component prices (before per-kg override). */
  total_price_retail: number
  /** (final_price − total_cost) / final_price when final_price > 0; negative when selling below cost; upper cap ~100%. */
  margin: number
  final_price: number
  unit_price: number | null
}

function printingTierMoney(
  tier: NonNullable<QuoteRatebook['printing_pricing_tiers']>[number],
  webLengthM: number,
  pm: 'inline' | 'uteco',
  side: 'cost' | 'price',
): number {
  const t = tier as Record<string, unknown>
  const setupCost = Number(t.setup_cost ?? 0)
  const setupPrice = Number(t.setup_price ?? t.setup_fee ?? 0)
  const costPer1000 = Number(t.cost_per_1000m ?? 0)
  const pricePer1000 = Number(t.price_per_1000m ?? t.cost_per_1000m ?? 0)
  const setup = side === 'cost' ? setupCost : setupPrice
  const per1000 = side === 'cost' ? costPer1000 : pricePer1000
  const ratePart = (webLengthM / 1000) * per1000
  if (pm === 'inline') {
    const minCharge = side === 'price' ? Number(tier.min_charge ?? 0) : 0
    return setup + Math.max(minCharge, ratePart)
  }
  return setup + ratePart
}

export function computePrinting(
  inputs: QuickQuoteInputs,
  ratebook: QuoteRatebook,
): { printing_cost: number; printing_price: number; printing_unavailable_reason: string | null } {
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  const runUpM = printingWebLengthMultiplierFromRunUp(inputs)
  const webLengthM = d.webLengthM * runUpM
  if (!(webLengthM > 0)) return { printing_cost: 0, printing_price: 0, printing_unavailable_reason: null }

  const pm = inputs.print_method === 'Inline' ? 'inline' : inputs.print_method === 'Uteco' ? 'uteco' : 'none'
  let printingCost = 0
  let printingPrice = 0
  let printingUnavailableReason: string | null = null

  if (pm !== 'none') {
    const printWidthMm = Number(inputs.base_width_mm || 0)
    const numColours = Math.max(0, Math.round(Number(inputs.num_colours || 0)))

    if (!Number.isFinite(numColours) || numColours < 1) {
      // printing disabled
    } else if (!Number.isFinite(printWidthMm) || printWidthMm <= 0) {
      printingUnavailableReason = 'Printing unavailable: base width is required'
    } else if (pm === 'inline' && printWidthMm > 1000 && numColours > 1) {
      printingUnavailableReason = 'Printing unavailable: Inline over 1000mm supports single colour only'
    } else {
      const tiers = Array.isArray(ratebook.printing_pricing_tiers) ? ratebook.printing_pricing_tiers : []
      const tier = tiers
        .filter((t) => t.method === pm && t.num_colours === numColours && t.max_print_width_mm >= printWidthMm)
        .sort((a, b) => a.max_print_width_mm - b.max_print_width_mm)[0]

      if (!tier) {
        printingUnavailableReason =
          pm === 'uteco' && printWidthMm > 1200
            ? 'Printing unavailable: Uteco max print width is 1200mm'
            : pm === 'inline' && printWidthMm > 1400
              ? 'Printing unavailable: Inline max print width is 1400mm'
              : 'Printing unavailable: no pricing tier configured for this width/colour'
      } else {
        printingCost = printingTierMoney(tier, webLengthM, pm, 'cost')
        printingPrice = printingTierMoney(tier, webLengthM, pm, 'price')
        const minM = Number(tier.min_meters || 0)
        if (minM > 0 && webLengthM < minM) {
          printingUnavailableReason = `Printing unavailable: below minimum length (${minM}m)`
        }
      }
    }
  }

  return { printing_cost: printingCost, printing_price: printingPrice, printing_unavailable_reason: printingUnavailableReason }
}

export function computePrintingUnavailableReason(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): string | null {
  return computePrinting(inputs, ratebook).printing_unavailable_reason
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function roundMoney(n: number): number {
  // 2dp half-up-ish with float guard
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const DEFAULT_FORMULATION_MARKUP = 0.25

function readFormulationMargins(ratebook: QuoteRatebook): {
  colours_markup: number
  additives_markup: number
  custom_resin_blend_markup: number
} {
  const m = ratebook.quote_formulation_margins
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    colours_markup: num(m?.colours_markup, DEFAULT_FORMULATION_MARKUP),
    additives_markup: num(m?.additives_markup, DEFAULT_FORMULATION_MARKUP),
    custom_resin_blend_markup: num(m?.custom_resin_blend_markup, DEFAULT_FORMULATION_MARKUP),
  }
}

function productUnitsNounPluralForMoq(productType: string): string {
  const pt = String(productType || '').trim()
  if (pt === 'Bag') return 'bags'
  if (pt === 'U-Film') return 'U-films'
  if (pt === 'Centerfold') return 'centerfolds'
  if (pt === 'Sleeve') return 'sleeves'
  return `${pt}s`.toLowerCase()
}

/**
 * Minimum **total** quantity (same basis as the MOQ kg comparison) for the Quotes qty type,
 * so users know how far to turn the dial they are using.
 */
function computeMaterialsMoqMinimumHint(
  inputs: QuickQuoteInputs,
  compareKgForMoq: number,
  moqEffective: number,
  units: number | null,
  rolls: number | null,
): MaterialsMoqMinimumHint | null {
  const qt = inputs.qty_entry_type
  if (!qt || !(moqEffective > 0) || !(compareKgForMoq > 0)) return null

  if (qt === 'kg') {
    return { kind: 'kg', minimumTotalKg: roundMoney(moqEffective) }
  }

  if (qt === 'units') {
    const u = units != null && units > 0 ? units : null
    if (!u) return null
    const kgEach = compareKgForMoq / u
    if (!(kgEach > 0) || !Number.isFinite(kgEach)) return null
    const minTotal = Math.ceil((moqEffective - 1e-9) / kgEach)
    if (!Number.isFinite(minTotal) || minTotal < 1) return null
    return { kind: 'units', nounPlural: productUnitsNounPluralForMoq(inputs.product_type), minimumTotal: minTotal }
  }

  if (qt === 'total_rolls' || qt === 'rolls_units') {
    const r = rolls != null && rolls > 0 ? rolls : null
    if (!r) return null
    const kgPerRoll = compareKgForMoq / r
    if (!(kgPerRoll > 0) || !Number.isFinite(kgPerRoll)) return null
    const minRolls = Math.ceil((moqEffective - 1e-9) / kgPerRoll)
    if (!Number.isFinite(minRolls) || minRolls < 1) return null
    return { kind: 'rolls', minimumTotalRolls: minRolls }
  }

  return null
}

function mmToM(mm: number): number {
  return mm / 1000
}

function umToM(um: number): number {
  return um / 1_000_000
}

function blendDensity(blend: Array<{ resin_code: string; pct: number; density: number }>): number {
  if (!blend.length) return 920
  const total = blend.reduce((acc, r) => acc + Number(r.pct || 0), 0)
  if (Math.abs(total - 100) > 0.01) {
    // Best-effort: normalize
    return blend.reduce((acc, r) => acc + Number(r.density || 920) * (Number(r.pct || 0) / Math.max(total || 1, 1)), 0)
  }
  return blend.reduce((acc, r) => acc + Number(r.density || 920) * (Number(r.pct || 0) / 100), 0)
}

function computeLayflatMm(spec: {
  product_type: string
  geometry: string
  base_width_mm: number
  run_up?: number | null
  gusset_mm: number | null
  ufilm_left_width_mm?: number | null
  ufilm_right_width_mm?: number | null
}): number {
  const pt = String(spec.product_type || '')
  const geom = String(spec.geometry || '').toLowerCase()
  const w = Number(spec.base_width_mm || 0)
  const g = Number(spec.gusset_mm || 0)
  const ru = Number(spec.run_up || 0)
  // Mirror SpecPayloadForm rules:
  // - Centerfold layflat = 0.5 * base width
  // - U-Film layflat = middle width + left + right
  // Quote-only override:
  // - Sheet/Centerfold with Run Up: 2 up = 1x width, 4 up = 2x width, 6 up = 3x width (layflat = product_width * run_up / 2)
  if ((pt === 'Sheet' || pt === 'Centerfold') && Number.isFinite(ru) && ru > 0) return w * (ru / 2)
  if (pt === 'Centerfold' || geom === 'centrefold' || geom === 'centre_fold' || geom === 'centerfold') return 0.5 * w
  if (pt === 'U-Film') {
    const l = Number(spec.ufilm_left_width_mm || 0)
    const r = Number(spec.ufilm_right_width_mm || 0)
    return w + l + r
  }
  // For gusset, treat gusset_mm as the total additional layflat width.
  // e.g. width 200 + gusset 100 => layflat 300.
  if (geom === 'gusset') return w + g
  return w
}

/**
 * Sheet/Centerfold run-up: one extruded metre is slit into `run_up` lanes along the tube,
 * so printed web length (min charge / min metres / per-1000m) scales with extruded metres × run_up.
 */
function printingWebLengthMultiplierFromRunUp(inputs: QuickQuoteInputs): number {
  const pt = String(inputs.product_type || '')
  if (pt !== 'Sheet' && pt !== 'Centerfold') return 1
  const ru = Number(inputs.run_up ?? 0)
  if (!Number.isFinite(ru) || ru <= 0) return 1
  return ru
}

export function computeLayflatWidthMm(spec: {
  product_type: string
  geometry: string
  base_width_mm: number
  run_up?: number | null
  gusset_mm: number | null
  ufilm_left_width_mm?: number | null
  ufilm_right_width_mm?: number | null
}): number {
  return computeLayflatMm(spec)
}

/**
 * For continuous-length products (tube on roll, etc.), treat one "product length" as the web length
 * that carries one roll's (or one carton's) billed mass: refKg / kgPerLinearM. Used instead of a
 * nominal 1m stub so kg/product, printing, and conversion speed buckets match physical rolls/cartons.
 */
function referenceMassKgForContinuousProduct(
  inputs: QuickQuoteInputs,
  totalKgReq: number | null,
  totalMReq: number | null,
  rolls: number | null,
  unitsIn: number | null,
  kgPerLinearM: number,
): number | null {
  const rollsN = rolls != null && rolls > 0 ? rolls : null
  const nominalWpr = toNum(inputs.nominal_weight_per_roll_kg)
  if (inputs.finish_mode === 'Rolls') {
    if (totalKgReq != null && totalKgReq > 0 && rollsN != null) return totalKgReq / rollsN
    // One product per roll: rolls and units match; use form weight/roll when job total_kg is absent.
    if (
      inputs.continuous_roll &&
      nominalWpr != null &&
      nominalWpr > 0 &&
      rollsN != null &&
      unitsIn != null &&
      unitsIn > 0 &&
      rollsN === unitsIn
    ) {
      return nominalWpr
    }
    if (totalMReq != null && totalMReq > 0 && rollsN != null && kgPerLinearM > 0) {
      const tk = totalMReq * kgPerLinearM
      return tk > 0 ? tk / rollsN : null
    }
    return null
  }
  if (inputs.finish_mode === 'Cartons') {
    const bpc = inputs.bags_per_carton != null ? Math.max(0, Math.round(Number(inputs.bags_per_carton || 0))) : 0
    if (totalKgReq != null && totalKgReq > 0 && unitsIn != null && unitsIn > 0 && bpc > 0) {
      const cartons = Math.max(1, Math.ceil(unitsIn / bpc))
      return totalKgReq / cartons
    }
    return null
  }
  return null
}

function pickConversionSpeed(
  ratebook: QuoteRatebook,
  gaugeUm: number,
  lengthMm: number,
): (NonNullable<typeof ratebook.conversion_speeds>[number]) | null {
  const g = Number(gaugeUm || 0)
  const l = Number(lengthMm || 0)
  const rows = Array.isArray(ratebook.conversion_speeds) ? ratebook.conversion_speeds : []
  return (
    rows.find((r) => g >= r.min_gauge_um && g <= r.max_gauge_um && l >= r.min_length_mm && l <= r.max_length_mm) ||
    rows[0] ||
    null
  )
}

function convFactor(ratebook: QuoteRatebook, slug: string, fallback = 0): number {
  const v = (ratebook as any)?.conversion_factors?.[slug]
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function mapProductTypeToMaterialsRetailGroup(productType: string): NonNullable<MaterialsRetailBand['product_group']> | null {
  const pt = String(productType || '').trim()
  if (pt === 'Tube' || pt === 'Sleeve') return 'tube'
  if (pt === 'Centerfold') return 'centerfold'
  if (pt === 'Sheet') return 'sheet'
  if (pt === 'U-Film') return 'u_film'
  if (pt === 'Bag') return 'bag'
  return null
}

export type MaterialsRetailBandResolution = {
  band: MaterialsRetailBand | null
  /** `exact` = width within a row; otherwise closest row was used (see UI warning). */
  match: 'exact' | 'below_range' | 'above_range' | 'gap' | 'none'
}

/**
 * Resolve the materials retail band for product width (mm).
 * If width is outside all configured ranges for that product group, returns the **closest** band
 * (`below_range` / `above_range` / `gap`) so pricing/MOQ still have a defined row.
 */
export function resolveMaterialsRetailBand(
  ratebook: QuoteRatebook,
  productType: string,
  productWidthMm: number,
): MaterialsRetailBandResolution {
  const group = mapProductTypeToMaterialsRetailGroup(productType)
  if (!group) return { band: null, match: 'none' }
  const w = Math.round(Number(productWidthMm || 0))
  if (!Number.isFinite(w) || w < 0) return { band: null, match: 'none' }
  const bands = (Array.isArray(ratebook.materials_retail_bands) ? ratebook.materials_retail_bands : []).filter(
    (b) => String(b.product_group) === group,
  )
  if (bands.length === 0) return { band: null, match: 'none' }

  const rows = bands
    .map((b) => ({
      ...b,
      width_min_mm: Number(b.width_min_mm),
      width_max_mm: Number(b.width_max_mm),
    }))
    .sort((a, b) => a.width_min_mm - b.width_min_mm || a.width_max_mm - b.width_max_mm)

  const exact = rows.find((b) => w >= b.width_min_mm && w <= b.width_max_mm)
  if (exact) return { band: exact as MaterialsRetailBand, match: 'exact' }

  const first = rows[0]
  const last = rows[rows.length - 1]
  if (w < first.width_min_mm) return { band: first as MaterialsRetailBand, match: 'below_range' }
  if (w > last.width_max_mm) return { band: last as MaterialsRetailBand, match: 'above_range' }

  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (w > a.width_max_mm && w < b.width_min_mm) {
      const distA = w - a.width_max_mm
      const distB = b.width_min_mm - w
      const chosen = (distA <= distB ? a : b) as MaterialsRetailBand
      return { band: chosen, match: 'gap' }
    }
  }

  return { band: last as MaterialsRetailBand, match: 'above_range' }
}

export function buildMaterialsBandMatchWarning(
  productType: string,
  productWidthMm: number,
  res: MaterialsRetailBandResolution,
): string | null {
  if (!res.band || res.match === 'exact' || res.match === 'none') return null
  const pt = String(productType || '').trim() || 'This product'
  const w = Math.round(Number(productWidthMm || 0))
  const b = res.band
  const bandRange = `${b.width_min_mm}–${b.width_max_mm}mm`
  if (res.match === 'below_range') {
    return `No materials retail band matches ${pt} at ${w}mm (below configured widths). Using closest band ${bandRange} for pricing and minimum order quantity.`
  }
  if (res.match === 'above_range') {
    return `No materials retail band matches ${pt} at ${w}mm (above configured widths). Using closest band ${bandRange} for pricing and minimum order quantity.`
  }
  return `No materials retail band matches ${pt} at ${w}mm (between configured width ranges). Using closest band ${bandRange} for pricing and minimum order quantity.`
}

/** Returns the materials band for this width (exact match, or closest row if outside configured ranges). */
export function pickMaterialsRetailBand(
  ratebook: QuoteRatebook,
  productType: string,
  productWidthMm: number,
): MaterialsRetailBand | null {
  return resolveMaterialsRetailBand(ratebook, productType, productWidthMm).band
}

function materialsMoqEffectiveKg(band: MaterialsRetailBand | null, hasPrinting: boolean): number | null {
  if (!band) return null
  const plain = band.moq_plain_kg != null ? Number(band.moq_plain_kg) : null
  const printed = band.moq_printed_kg != null ? Number(band.moq_printed_kg) : null
  const pOk = plain != null && Number.isFinite(plain) && plain > 0
  const prOk = printed != null && Number.isFinite(printed) && printed > 0
  if (hasPrinting) {
    if (prOk) return printed
    if (pOk) return plain
    return null
  }
  if (pOk) return plain
  if (prOk) return printed
  return null
}

/** One-line label + kg for the MOQ that applies to how the quote is set up (printed vs plain). */
function buildMaterialsMoqSummaryLine(band: MaterialsRetailBand | null, hasPrinting: boolean): string | null {
  if (!band) return null
  const plain = band.moq_plain_kg != null && Number.isFinite(Number(band.moq_plain_kg)) ? Number(band.moq_plain_kg) : null
  const printed = band.moq_printed_kg != null && Number.isFinite(Number(band.moq_printed_kg)) ? Number(band.moq_printed_kg) : null
  const pOk = plain != null && plain > 0
  const prOk = printed != null && printed > 0
  if (hasPrinting) {
    if (prOk && printed != null) return `Minimum order quantity (printed): ${roundMoney(printed)}kg`
    if (pOk && plain != null) return `Minimum order quantity (plain): ${roundMoney(plain)}kg`
    return null
  }
  if (pOk && plain != null) return `Minimum order quantity (plain): ${roundMoney(plain)}kg`
  if (prOk && printed != null) return `Minimum order quantity (printed): ${roundMoney(printed)}kg`
  return null
}

/** Conversion factor `roll_weight_avg` (kg) — admin Conversion → Production Factors (e.g. Average Roll Weight). */
export function getRollWeightAvgKg(ratebook: QuoteRatebook | null | undefined): number {
  if (!ratebook) return 0
  return convFactor(ratebook, 'roll_weight_avg', 0)
}

/**
 * When a spec has no `formulation.blend`, quotes use a single resin code for density + $/kg.
 * Prefer `LDPE` if present on the ratebook; otherwise the first listed resin (matches Quotes bootstrap fallback).
 * Avoids hard-coding `LDPE` when it is missing — that previously forced default density (~920 kg/m³) and $0 price.
 */
export function getDefaultResinCodeFromRatebook(ratebook: QuoteRatebook | null | undefined): string {
  const map = ratebook?.resins
  if (!map || typeof map !== 'object') return 'LDPE'
  const keys = Object.keys(map)
  if (keys.length === 0) return 'LDPE'
  const hit = keys.find((k) => String(k).toUpperCase() === 'LDPE')
  return hit || keys[0] || 'LDPE'
}

/** Returns blend density in kg/m³ for pallet volume calculation (volume_m3 = totals_kg / density). */
export function getBlendDensityKgPerM3(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): number {
  const blendIn =
    Array.isArray(inputs.blend) && inputs.blend.length
      ? inputs.blend
      : inputs.resin_code
        ? [{ resin_code: inputs.resin_code, pct: 100 }]
        : []
  const blend = blendIn
    .map((c) => {
      const code = String((c as any).resin_code || '').trim()
      const pct = Number((c as any).pct || 0)
      const r = ratebook.resins?.[code]
      const density = r?.density != null ? Number(r.density) * 1_000_000 : 920
      return { resin_code: code, pct, density }
    })
    .filter((c) => c.resin_code && c.pct > 0)
  return blend.length > 0 ? blendDensity(blend) : 920
}

export function computeDerivedGeometryAndTotals(inputs: QuickQuoteInputs, ratebook: QuoteRatebook) {
  const unitsIn = typeof inputs.quantity.units === 'number' && inputs.quantity.units > 0 ? Math.round(inputs.quantity.units) : null
  const totalKgN = toNum((inputs.quantity as any).total_kg)
  const totalMN = toNum((inputs.quantity as any).total_m)
  const rollsN = toNum((inputs.quantity as any).rolls)
  const totalKgReq = totalKgN != null && totalKgN > 0 ? totalKgN : null
  const totalMReq = totalMN != null && totalMN > 0 ? totalMN : null
  const rolls = rollsN != null && rollsN > 0 ? Math.round(rollsN) : null

  const layflatMm = computeLayflatMm({
    product_type: inputs.product_type,
    geometry: inputs.geometry,
    base_width_mm: inputs.base_width_mm,
    run_up: (inputs as any).run_up ?? null,
    gusset_mm: inputs.gusset_mm,
    ufilm_left_width_mm: inputs.ufilm_left_width_mm,
    ufilm_right_width_mm: inputs.ufilm_right_width_mm,
  })

  const unitLengthMm = inputs.continuous_roll ? null : Number(inputs.base_length_mm || 0)

  // Build blend with densities
  const blendIn =
    Array.isArray(inputs.blend) && inputs.blend.length ? inputs.blend : inputs.resin_code ? [{ resin_code: inputs.resin_code, pct: 100 }] : []
  const blend = blendIn
    .map((c) => {
      const code = String((c as any).resin_code || '').trim()
      const pct = Number((c as any).pct || 0)
      const r = ratebook.resins?.[code]
      // NOTE: resin density in DB/API is stored as kg/cm^3 (e.g. LDPE ~ 0.00092).
      // Convert to kg/m^3: 1 cm^3 = 1e-6 m^3 => multiply by 1e6.
      const density = r?.density != null ? Number(r.density) * 1_000_000 : 920
      return { resin_code: code, pct, density }
    })
    .filter((c) => c.resin_code && c.pct > 0)

  const density = blendDensity(blend)
  const thicknessM = umToM(Number(inputs.thickness_um || 0))
  const kgPerM2 = density * thicknessM
  const kgPerLinearM = kgPerM2 * mmToM(layflatMm)

  // Continuous length: one "unit" of product length = web length that holds one roll/carton billed mass
  // (e.g. 20kg roll → metres = 20 / kgPerLinearM), not a fixed 1m stub.
  let effectiveLenM: number
  if (inputs.continuous_roll) {
    const refKg = referenceMassKgForContinuousProduct(inputs, totalKgReq, totalMReq, rolls, unitsIn, kgPerLinearM)
    if (refKg != null && refKg > 0 && kgPerLinearM > 0) {
      effectiveLenM = refKg / kgPerLinearM
    } else {
      effectiveLenM = 1
    }
  } else {
    effectiveLenM = mmToM(unitLengthMm || 0)
  }
  const areaPerUnitM2 = effectiveLenM * mmToM(layflatMm)
  const kgPerUnit = areaPerUnitM2 * kgPerM2

  // If quoting by total KG in Rolls mode, adjust "plastic produced" by core billing.
  // The input total_kg is treated as the billed weight; plastic weight is reduced by core weight
  // when billing includes the core (fully or partially).
  let totalKgReqPlastic: number | null = totalKgReq
  if (
    inputs.finish_mode === 'Rolls' &&
    totalKgReq != null &&
    inputs.core_type &&
    rolls != null &&
    rolls > 0 &&
    layflatMm > 0 &&
    inputs.roll_weight_billing &&
    inputs.roll_weight_billing !== 'core_off'
  ) {
    const core = ratebook.cores?.[inputs.core_type]
    if (core && Number(core.kg_per_meter || 0) > 0) {
      const coreMeters = rolls * mmToM(layflatMm)
      const coreKg = coreMeters * Number(core.kg_per_meter || 0)
      const frac = inputs.roll_weight_billing === 'core_half_off' ? 0.5 : 1
      totalKgReqPlastic = Math.max(0, totalKgReq - frac * coreKg)
    }
  }

  const trimPct = inputs.trim_pct != null && Number.isFinite(Number(inputs.trim_pct)) ? Number(inputs.trim_pct) : null
  const trimFactor = trimPct != null && trimPct > 0 ? clamp(1 - trimPct / 100, 0.01, 1) : null

  // Trim % is yield loss: effective plastic = nominal × (1 − trim%/100). Same for bag counts (by mass) and kg/m/rolls.
  let derivedTotalKg: number
  let derivedTotalM: number
  let trimmedTotalKg: number

  if (unitsIn != null && kgPerUnit > 0) {
    const usableKg = kgPerUnit * unitsIn
    trimmedTotalKg = trimFactor != null ? usableKg * trimFactor : usableKg
    derivedTotalKg = trimmedTotalKg
    derivedTotalM = kgPerLinearM > 0 ? trimmedTotalKg / kgPerLinearM : 0
  } else {
    derivedTotalKg =
      totalKgReqPlastic != null
        ? totalKgReqPlastic
        : totalMReq != null && kgPerLinearM > 0
          ? totalMReq * kgPerLinearM
          : 0
    derivedTotalM = totalMReq != null ? totalMReq : derivedTotalKg > 0 && kgPerLinearM > 0 ? derivedTotalKg / kgPerLinearM : 0
    trimmedTotalKg = derivedTotalKg
    if (trimFactor != null && derivedTotalM > 0) {
      derivedTotalM = derivedTotalM * trimFactor
      trimmedTotalKg = trimmedTotalKg * trimFactor
    }
  }

  const webLengthM = derivedTotalM

  // Derive units from total kg whenever we have kgPerUnit (so "No. of product_type" can be shown for any finish mode).
  // Continuous roll on Rolls: countable unit is the roll (total products = number of rolls).
  const units =
    unitsIn != null
      ? unitsIn
      : inputs.continuous_roll && inputs.finish_mode === 'Rolls' && rolls != null && rolls > 0
        ? rolls
        : !inputs.continuous_roll && kgPerUnit > 0 && trimmedTotalKg > 0
          ? Math.max(0, Math.round(trimmedTotalKg / kgPerUnit))
          : null

  const canComputeRollStats = rolls != null && rolls > 0 && kgPerLinearM > 0 && trimmedTotalKg > 0 && derivedTotalM > 0
  const kgPerRoll = canComputeRollStats ? trimmedTotalKg / rolls : null
  const mPerRoll = canComputeRollStats ? derivedTotalM / rolls : null

  // Billed / scale weight (e.g. rolls with core included): customer total_kg includes core; plastic mass is lower.
  // Costs use trimmedTotalKg (plastic); quotes should show and price per kg using billedTotalsKg.
  let billedTotalsKg: number
  if (unitsIn != null && kgPerUnit > 0) {
    billedTotalsKg = trimmedTotalKg
  } else if (totalKgReq != null && totalKgReq > 0 && totalKgReqPlastic != null && totalKgReqPlastic > 0) {
    billedTotalsKg = totalKgReq * (trimmedTotalKg / totalKgReqPlastic)
  } else {
    billedTotalsKg = trimmedTotalKg
  }
  const billedKgPerRoll = rolls != null && rolls > 0 && billedTotalsKg > 0 ? billedTotalsKg / rolls : null

  return {
    units,
    rolls,
    layflatMm,
    blend,
    density,
    kgPerM2,
    kgPerUnit,
    kgPerLinearM,
    /** Metres of web used to model one "product" when `continuous_roll` (one roll/carton mass). */
    effectiveProductLengthM: effectiveLenM,
    derivedTotalKg: trimmedTotalKg,
    billedTotalsKg,
    derivedTotalM,
    webLengthM,
    kgPerRoll,
    billedKgPerRoll,
    mPerRoll,
  }
}

export type AppliedExtrusionWasteFactor = {
  slug: string
  minutes: number
}

/**
 * Waste minutes for extrusion cost and material waste.
 * - simple_job: base time, always applies first.
 * - gusset (and any future non-parallel slugs): stack after simple.
 * - non_standard_resin_or_colour vs complex_set_up_print_or_perforation: only the longer counts
 *   (resin/colour change overlaps in time with print/perforation setup on the line).
 * Example: simple 20 + non-standard 10 → 30; add complex 15 → 20 + max(10,15) = 35.
 */
function computeExtrusionWasteMinutes(applied: AppliedExtrusionWasteFactor[]): number {
  const m = (slug: string) => Math.max(0, Number(applied.find((f) => f.slug === slug)?.minutes ?? 0) || 0)
  const simpleJob = m('simple_job')
  let sequentialExtra = 0
  let nonStandard = 0
  let complex = 0
  for (const f of applied) {
    const slug = String(f.slug || '')
    const mins = Math.max(0, Number(f.minutes || 0) || 0)
    if (slug === 'simple_job') continue
    if (slug === 'non_standard_resin_or_colour') {
      nonStandard = mins
      continue
    }
    if (slug === 'complex_set_up_print_or_perforation') {
      complex = mins
      continue
    }
    sequentialExtra += mins
  }
  return simpleJob + sequentialExtra + Math.max(nonStandard, complex)
}

function buildExtrusionWasteCfg(ratebook: QuoteRatebook): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of Array.isArray(ratebook.extrusion_waste_factors) ? ratebook.extrusion_waste_factors : []) {
    const slug = String((w as any)?.slug || '').trim()
    const mins = Number((w as any)?.minutes || 0)
    if (slug) m.set(slug, Math.max(0, mins))
  }
  return m
}

export function computeAppliedExtrusionWasteFactors(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): AppliedExtrusionWasteFactor[] {
  const cfg = buildExtrusionWasteCfg(ratebook)

  // Waste factor logic (minutes from DB). See computeExtrusionWasteMinutes:
  // simple_job + gusset + max(non_standard_resin_or_colour, complex_set_up_print_or_perforation).
  // - simple_job: always applies
  // - gusset: gusseted geometry (stacks after simple)
  // - non_standard_resin_or_colour: colour / additives / non-LD blend (overlaps with complex setup time)
  // - complex_set_up_print_or_perforation: printing OR conversion flags that complicate setup
  const hasAnyColour =
    Array.isArray(inputs.colour_components) && inputs.colour_components.some((c) => (Number(c?.strength_pct || 0) || 0) > 0)
  const hasGusset = String(inputs.geometry || '').toLowerCase() === 'gusset' && Number(inputs.gusset_mm || 0) > 0
  const hasAnyAdditives = Array.isArray(inputs.additives) && inputs.additives.some((a) => (Number(a?.pct || 0) || 0) > 0)
  const blendCode = (inputs.resin_blend_code || '').trim()
  const isNonStandardBlend = blendCode !== '' && blendCode !== 'LD'
  const isNonStandardResinOrColour = hasAnyColour || hasAnyAdditives || isNonStandardBlend
  const hasPrinting = String(inputs.print_method || 'None') !== 'None' && Number(inputs.num_colours || 0) > 0
  const hasAnyComplexConversion = !!inputs.inline_perforation || !!inputs.inline_seal || !!inputs.hole_punched
  const hasComplexSetup = hasPrinting || hasAnyComplexConversion

  const out: AppliedExtrusionWasteFactor[] = []

  // Always applies
  out.push({ slug: 'simple_job', minutes: cfg.get('simple_job') || 0 })

  if (hasGusset) out.push({ slug: 'gusset', minutes: cfg.get('gusset') || 0 })
  if (hasComplexSetup) {
    out.push({
      slug: 'complex_set_up_print_or_perforation',
      minutes: cfg.get('complex_set_up_print_or_perforation') || 0,
    })
  }
  if (isNonStandardResinOrColour) {
    const combined =
      cfg.get('non_standard_resin_or_colour') ??
      Math.max(cfg.get('non_standard_resin') || 0, cfg.get('colour_not_clear') || 0)
    out.push({ slug: 'non_standard_resin_or_colour', minutes: combined || 0 })
  }

  return out
}

export function computeRollMetrics(
  inputs: QuickQuoteInputs,
  ratebook: QuoteRatebook,
): Pick<QuotePreview, 'kg_per_roll' | 'm_per_roll' | 'units_per_roll'> {
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  const unitsPerRoll =
    d.rolls != null && d.rolls > 0 && d.units != null && d.units > 0 ? d.units / d.rolls : null
  return {
    kg_per_roll: d.billedKgPerRoll ?? d.kgPerRoll,
    m_per_roll: d.mPerRoll,
    units_per_roll: unitsPerRoll,
  }
}

export function computeQuickQuotePreview(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): QuotePreview {
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  const units = d.units
  const rolls = d.rolls
  const layflatMm = d.layflatMm
  const blend = d.blend
  const kgPerUnit = d.kgPerUnit
  const derivedTotalKg = d.derivedTotalKg
  const kgPerRoll = d.kgPerRoll
  const mPerRoll = d.mPerRoll

  // Material cost per kg
  // Batching rule:
  // - Resin blend totals 100%
  // - Colours/additives are added on top (e.g. +2% additive => 102% total)
  // So effective $/kg of compound is normalized by (1 + extras).
  const resinBaseCostPerKg =
    blend.length === 0
      ? 0
      : blend.reduce((acc, c) => {
          const price = Number(ratebook.resins?.[c.resin_code]?.price_per_kg ?? 0)
          return acc + price * (c.pct / 100)
        }, 0)

  const colourRows = (Array.isArray(inputs.colour_components) ? inputs.colour_components : [])
    .map((c) => ({
      code: String(c?.colour_code || '').trim(),
      strengthPct: c?.strength_pct != null ? Number(c.strength_pct) : null,
    }))
    .filter((c) => c.code && c.strengthPct != null && Number(c.strengthPct) > 0)

  const { colourNumerator, colourExtraFrac } = colourRows.reduce(
    (acc, c) => {
      const price = Number(ratebook.colours?.[c.code]?.price_per_kg ?? 0)
      const strengthFrac = Number(c.strengthPct || 0) / 100
      const extraFrac = strengthFrac
      return {
        colourNumerator: acc.colourNumerator + price * extraFrac,
        colourExtraFrac: acc.colourExtraFrac + extraFrac,
      }
    },
    { colourNumerator: 0, colourExtraFrac: 0 },
  )

  const additiveRows = (Array.isArray(inputs.additives) ? inputs.additives : [])
    .map((a) => ({ code: String(a?.additive_code || '').trim(), pct: a?.pct != null ? Number(a.pct) : null }))
    .filter((a) => a.code && a.pct != null && Number(a.pct) > 0)

  const { additivesNumerator, additivesExtraFrac } = additiveRows.reduce(
    (acc, a) => {
      const price = Number(ratebook.additives_price_per_kg?.[a.code] ?? 0)
      const pctFrac = Number(a.pct || 0) / 100
      return {
        additivesNumerator: acc.additivesNumerator + price * pctFrac,
        additivesExtraFrac: acc.additivesExtraFrac + pctFrac,
      }
    },
    { additivesNumerator: 0, additivesExtraFrac: 0 },
  )

  const denom = 1 + colourExtraFrac + additivesExtraFrac
  const materialCostPerKg = denom > 0 ? (resinBaseCostPerKg + colourNumerator + additivesNumerator) / denom : 0
  const materialCost = materialCostPerKg * derivedTotalKg

  const blendCodeForFormulation = (inputs.resin_blend_code || '').trim()
  const isNonStandardResinBlend = blendCodeForFormulation !== '' && blendCodeForFormulation !== 'LD'
  const ldBaselineResinCode = getDefaultResinCodeFromRatebook(ratebook)
  const ldBaselineCostPerKg = Number(ratebook.resins?.[ldBaselineResinCode]?.price_per_kg ?? 0)
  const colourPortionPerKg = denom > 0 ? colourNumerator / denom : 0
  const additivePortionPerKg = denom > 0 ? additivesNumerator / denom : 0
  const resinExtraPerKg =
    isNonStandardResinBlend && denom > 0 ? Math.max(0, resinBaseCostPerKg - ldBaselineCostPerKg) / denom : 0
  const formulationLineCost = (colourPortionPerKg + additivePortionPerKg + resinExtraPerKg) * derivedTotalKg
  const fm = readFormulationMargins(ratebook)
  const formulationLinePrice =
    colourPortionPerKg * derivedTotalKg * (1 + fm.colours_markup) +
    additivePortionPerKg * derivedTotalKg * (1 + fm.additives_markup) +
    resinExtraPerKg * derivedTotalKg * (1 + fm.custom_resin_blend_markup)
  const formulationLineCostR = roundMoney(formulationLineCost)
  const formulationLinePriceR = roundMoney(formulationLinePrice)

  const hasPrintingForMaterials = String(inputs.print_method || 'None') !== 'None' && Math.max(0, Math.round(Number(inputs.num_colours || 0))) > 0
  const materialsResolution = resolveMaterialsRetailBand(ratebook, inputs.product_type, Number(inputs.base_width_mm || 0))
  const materialsBand = materialsResolution.band
  const tableRetailPerKg =
    materialsBand?.retail_price_per_kg != null && Number.isFinite(Number(materialsBand.retail_price_per_kg))
      ? Number(materialsBand.retail_price_per_kg)
      : null
  const materialRetailPerKg =
    tableRetailPerKg != null && tableRetailPerKg > 0 ? tableRetailPerKg : materialCostPerKg
  const materialPrice = materialRetailPerKg * derivedTotalKg

  const moqEffective = materialsMoqEffectiveKg(materialsBand, hasPrintingForMaterials)
  const compareKgForMoq = d.billedTotalsKg > 0 ? d.billedTotalsKg : d.derivedTotalKg
  const materialsMoqBelow =
    !!(
      materialsBand &&
      moqEffective != null &&
      moqEffective > 0 &&
      compareKgForMoq > 0 &&
      compareKgForMoq + 1e-9 < moqEffective
    )
  const materialsMoqWarning = materialsMoqBelow
    ? `Below minimum order quantity: job is ${roundMoney(compareKgForMoq)}kg but this width needs at least ${roundMoney(moqEffective)}kg${
        hasPrintingForMaterials ? ' (printed)' : ' (plain)'
      }.`
    : null
  const materialsMoqMinimumHint = materialsMoqBelow
    ? computeMaterialsMoqMinimumHint(inputs, compareKgForMoq, moqEffective, units, rolls)
    : null

  const materialsMoqSummaryLine = buildMaterialsMoqSummaryLine(materialsBand, hasPrintingForMaterials)

  const appliedExtrusionWasteFactors = computeAppliedExtrusionWasteFactors(inputs, ratebook)
  const extrusionExtraMinutes = computeExtrusionWasteMinutes(appliedExtrusionWasteFactors)

  // Extrusion cost (runtime only, estimate):
  // hours = plastic_kg / average_kg_hr
  // cost = hours * cost_per_hr
  let extrusionHours: number | null = null
  let extrusionCost = 0
  if (inputs.extruder_code && Array.isArray(ratebook.extruders) && derivedTotalKg > 0) {
    const ex = ratebook.extruders.find((e) => String(e?.extruder_code || '') === String(inputs.extruder_code || ''))
    const avg = ex?.average_kg_hr != null ? Number(ex.average_kg_hr) : null
    const cph = ex?.cost_per_hr != null ? Number(ex.cost_per_hr) : null
    if (avg != null && avg > 0 && cph != null && cph >= 0) {
      const baseHours = derivedTotalKg / avg
      const extraHours = extrusionExtraMinutes > 0 ? extrusionExtraMinutes / 60 : 0
      extrusionHours = baseHours + extraHours
      extrusionCost = extrusionHours * cph
    }
  }

  const {
    printing_cost: printingCost,
    printing_price: printingPrice,
    printing_unavailable_reason: printingUnavailableReason,
  } = computePrinting(inputs, ratebook)

  // Conversion (only for cartons)
  let conversionCost = 0
  let conversionPrice = 0
  let conversionRunMinutes: number | null = null
  let conversionRollChangeMinutes: number | null = null
  let conversionTotalMinutes: number | null = null
  let cartons: number | null = null
  let kgPerCarton: number | null = null
  let cartonCostTotal: number | null = null
  if (inputs.finish_mode === 'Cartons' && units != null) {
    const effLenM = d.effectiveProductLengthM
    const lengthMmForConv =
      inputs.continuous_roll && effLenM != null && effLenM > 0
        ? Math.max(1, Math.round(effLenM * 1000))
        : Number(inputs.base_length_mm || 0)
    const speed = pickConversionSpeed(ratebook, Number(inputs.thickness_um || 0), lengthMmForConv)
    const bpm = speed ? Number(speed.bags_per_minute || 0) : 0
    conversionRunMinutes = bpm > 0 ? units / bpm : null

    const rollAvgKg = convFactor(ratebook, 'roll_weight_avg', 0)
    const rollChangeMins = convFactor(ratebook, 'roll_change_minutes', 0)
    const rollChanges = rollAvgKg > 0 && derivedTotalKg > 0 ? Math.ceil(derivedTotalKg / rollAvgKg) : 0
    conversionRollChangeMinutes = rollChanges > 0 && rollChangeMins > 0 ? rollChanges * rollChangeMins : 0

    conversionTotalMinutes =
      (conversionRunMinutes != null ? conversionRunMinutes : 0) + (conversionRollChangeMinutes != null ? conversionRollChangeMinutes : 0)

    const costPerHr = convFactor(ratebook, 'conversion_cost_per_hr', 0)
    const pricePerHr = convFactor(ratebook, 'conversion_price_per_hr', 0)
    const billHr = pricePerHr > 0 ? pricePerHr : costPerHr
    const runningCost = costPerHr > 0 ? (conversionTotalMinutes / 60) * costPerHr : 0
    const runningPrice = billHr > 0 ? (conversionTotalMinutes / 60) * billHr : 0

    const bagsPerCarton = inputs.bags_per_carton != null ? Math.round(Number(inputs.bags_per_carton || 0)) : 0
    cartons = bagsPerCarton > 0 ? Math.ceil(units / bagsPerCarton) : null
    kgPerCarton = bagsPerCarton > 0 && kgPerUnit > 0 ? kgPerUnit * bagsPerCarton : null
    const cartonCost = convFactor(ratebook, 'carton_cost', 0)
    cartonCostTotal = cartons != null && cartons > 0 && cartonCost >= 0 ? cartons * cartonCost : 0

    conversionCost = runningCost + (cartonCostTotal || 0)
    conversionPrice = runningPrice + (cartonCostTotal || 0)
  }

  // Core cost (only for rolls):
  // cores are cut to film width, so meters of core used = rolls * width_m.
  let coreCost = 0
  if (inputs.finish_mode === 'Rolls' && inputs.core_type && rolls != null && rolls > 0 && layflatMm > 0) {
    const c = ratebook.cores?.[inputs.core_type]
    if (c) {
      const coreMeters = rolls * mmToM(layflatMm)
      coreCost = Number(c.cost_per_meter || 0) * coreMeters
    }
  }

  // Waste
  // Waste represents *material wasted* during extrusion.
  // Extrusion waste factors add BOTH:
  // - time (handled above via extrusionExtraMinutes -> extrusionHours)
  // - wasted material (handled here via extrusionWasteKg -> wasteCost)
  const throughput =
    inputs.extruder_code && Array.isArray(ratebook.extruders)
      ? Number(ratebook.extruders.find((e) => String(e?.extruder_code || '') === String(inputs.extruder_code || ''))?.average_kg_hr || 0)
      : Number(ratebook.extrusion_throughput_kg_per_hr || 0)
  const baseWasteAdderMinutes = (Array.isArray(ratebook.waste_adders) ? ratebook.waste_adders : []).reduce(
    (acc, w) => acc + Number(w?.waste_minutes || 0),
    0,
  )
  const wasteMinutes = baseWasteAdderMinutes + extrusionExtraMinutes
  const extrusionWasteKg =
    wasteMinutes > 0 && throughput > 0 ? (wasteMinutes / 60) * throughput : 0
  let wasteCost = 0
  if (extrusionWasteKg > 0 && materialCostPerKg > 0) {
    wasteCost = extrusionWasteKg * materialCostPerKg
  }
  // Sell-side: no separate retail line for waste (material uplift policy); cost side still has wasteCost.
  const wastePrice = 0
  const totalExtrudedKg = derivedTotalKg + extrusionWasteKg

  // Sell-side: extrusion and core are not separate retail lines — extrusion is reflected in material $/kg uplift.
  const extrusionPrice = 0
  const corePrice = 0

  const totalCost = materialCost + extrusionCost + printingCost + conversionCost + coreCost + wasteCost
  const totalPriceRetail =
    materialPrice +
    formulationLinePriceR +
    printingPrice +
    conversionPrice +
    extrusionPrice +
    corePrice +
    wastePrice

  const billedTotalsKg = d.billedTotalsKg > 0 ? d.billedTotalsKg : derivedTotalKg
  const overridePk = toNum(inputs.override_price_per_kg)
  const priceOverrideActive = overridePk != null && overridePk > 0 && billedTotalsKg > 0
  const targetJobPrice = priceOverrideActive ? overridePk * billedTotalsKg : totalPriceRetail
  const adjustmentsPrice = priceOverrideActive ? roundMoney(targetJobPrice - totalPriceRetail) : null
  const finalPrice = priceOverrideActive ? roundMoney(targetJobPrice) : totalPriceRetail
  // Margin = (price − cost) / price; allow negative when selling below cost. Cap upper only (pathological >100%).
  const rawMargin = finalPrice > 0 && Number.isFinite(finalPrice) ? (finalPrice - totalCost) / finalPrice : 0
  const marginPct = Number.isFinite(rawMargin) ? Math.min(0.999999, rawMargin) : 0
  const unitPrice = units != null && units > 0 ? finalPrice / units : null
  const costPerKg = billedTotalsKg > 0 ? totalCost / billedTotalsKg : null
  const pricePerKgOut = billedTotalsKg > 0 ? finalPrice / billedTotalsKg : null
  const unitsPerRoll =
    rolls != null && rolls > 0 && units != null && units > 0 ? units / rolls : null

  const kgPerUnitPreview =
    inputs.continuous_roll && units != null && units > 0 && billedTotalsKg > 0
      ? roundMoney(billedTotalsKg / units)
      : inputs.continuous_roll
        ? null
        : kgPerUnit

  return {
    // Geometric kg/product for fixed length; for continuous roll, derive from billed job kg ÷ counted units (e.g. one roll per unit).
    kg_per_unit: kgPerUnitPreview,
    units_per_roll: unitsPerRoll,
    rolls: rolls != null && rolls > 0 ? rolls : null,
    totals_kg: billedTotalsKg,
    totals_units: units,
    totals_m: d.derivedTotalM > 0 ? roundMoney(d.derivedTotalM) : null,
    kg_per_roll: d.billedKgPerRoll ?? kgPerRoll,
    m_per_roll: mPerRoll,
    cost_per_kg: costPerKg != null ? roundMoney(costPerKg) : null,
    price_per_kg: pricePerKgOut != null ? roundMoney(pricePerKgOut) : null,
    extrusion_hours: extrusionHours,
    extrusion_waste_minutes: Math.max(0, Math.round(extrusionExtraMinutes)),
    total_extruded_kg: totalExtrudedKg > 0 ? roundMoney(totalExtrudedKg) : null,
    conversion_minutes_total: conversionTotalMinutes,
    conversion_minutes_run: conversionRunMinutes,
    conversion_minutes_roll_changes: conversionRollChangeMinutes,
    cartons,
    kg_per_carton: kgPerCarton,
    printing_unavailable_reason: printingUnavailableReason,
    materials_moq_summary_line: materialsMoqSummaryLine,
    materials_moq_warning: materialsMoqWarning,
    materials_moq_minimum_hint: materialsMoqMinimumHint,
    cost_breakdown: {
      material_cost: roundMoney(materialCost),
      formulation_line_cost: formulationLineCostR,
      extrusion_cost: roundMoney(extrusionCost),
      printing_cost: roundMoney(printingCost),
      conversion_cost: roundMoney(conversionCost),
      core_cost: roundMoney(coreCost),
      waste_cost: roundMoney(wasteCost),
    },
    price_breakdown: {
      material_price: roundMoney(materialPrice),
      formulation_line_price: formulationLinePriceR,
      extrusion_price: roundMoney(extrusionPrice),
      printing_price: roundMoney(printingPrice),
      conversion_price: roundMoney(conversionPrice),
      core_price: roundMoney(corePrice),
      waste_price: roundMoney(wastePrice),
    },
    adjustments_price: adjustmentsPrice,
    price_override_active: priceOverrideActive,
    total_cost: roundMoney(totalCost),
    total_price_retail: roundMoney(totalPriceRetail),
    margin: marginPct,
    final_price: roundMoney(finalPrice),
    unit_price: unitPrice != null ? roundMoney(unitPrice) : null,
  }
}


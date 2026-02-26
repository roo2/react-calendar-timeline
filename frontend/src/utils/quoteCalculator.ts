export type QuoteRatebook = {
  resins: Record<string, { price_per_kg: number; density: number }>
  additives_price_per_kg: Record<string, number>
  colours: Record<string, { price_per_kg: number }>
  cores: Record<string, { cost_per_meter: number; kg_per_meter: number }>
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
    setup_fee: number | null
    cost_per_1000m: number
  }>
  printing_rates: Record<
    string,
    { method: string; cost_per_1000m: number; setup_cost: number; setup_minutes: number; minimum_charge: number; duplex_supported: boolean }
  >
  conversion_rates: Array<{
    min_gauge_um: number
    max_gauge_um: number
    min_length_mm: number
    max_length_mm: number
    bags_per_hour: number
    setup_minutes: number
  }>
  waste_adders: Array<{ condition: string; waste_minutes: number }>
  extrusion_waste_factors?: Array<{ slug: string; minutes: number }>
  extrusion_throughput_kg_per_hr: number
}

export type QuickQuoteInputs = {
  requested_margin: number
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
  core_type: string | null
  roll_weight_billing?: 'core_included' | 'core_off' | 'core_half_off' | null
  extruder_code?: string | null
  opaque?: boolean
  colour_components?: Array<{ colour_code: string; strength_pct: number | null }>
  additives?: Array<{ additive_code: string; pct: number | null }>
  blend?: Array<{ resin_code: string; pct: number }>
  resin_code?: string | null
  quantity: { units?: number; total_kg?: number; total_m?: number; rolls?: number }
}

export type QuotePreview = {
  kg_per_unit: number | null
  units_per_roll: number | null
  totals_kg: number | null
  totals_units: number | null
  yield_m_per_kg: number | null
  kg_per_roll: number | null
  m_per_roll: number | null
  cost_per_kg: number | null
  extrusion_hours: number | null
  extrusion_waste_minutes: number
  printing_unavailable_reason?: string | null
  cost_breakdown: {
    material_cost: number
    extrusion_cost: number
    printing_cost: number
    conversion_cost: number
    core_cost: number
    waste_cost: number
  }
  total_cost: number
  margin: number
  final_price: number
  unit_price: number | null
}

export function computePrinting(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): { printing_cost: number; printing_unavailable_reason: string | null } {
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  const webLengthM = d.webLengthM
  if (!(webLengthM > 0)) return { printing_cost: 0, printing_unavailable_reason: null }

  const pm = inputs.print_method === 'Inline' ? 'inline' : inputs.print_method === 'Uteco' ? 'uteco' : 'none'
  let printingCost = 0
  let printingUnavailableReason: string | null = null

  if (pm !== 'none') {
    const printWidthMm = Number(inputs.base_width_mm || 0)
    const numColours = Math.max(0, Math.round(Number(inputs.num_colours || 0)))

    // numColours === 0 is treated as "printing disabled" (no error; cost is 0).
    if (!Number.isFinite(numColours) || numColours < 1) {
      // no-op
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
      } else if (webLengthM < Number(tier.min_meters || 0)) {
        printingUnavailableReason = `Printing unavailable: below minimum length (${Number(tier.min_meters || 0)}m)`
      } else {
        const rateCost = (webLengthM / 1000) * Number(tier.cost_per_1000m || 0)
        if (pm === 'inline') {
          const minCharge = Number(tier.min_charge ?? 0)
          printingCost = Math.max(minCharge, rateCost)
        } else {
          const setupFee = Number(tier.setup_fee ?? 0)
          printingCost = setupFee + rateCost
        }
      }
    }
  }

  return { printing_cost: printingCost, printing_unavailable_reason: printingUnavailableReason }
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
  // - Sheet/Centerfold can use Run Up, where layflat = product_width * run_up
  if ((pt === 'Sheet' || pt === 'Centerfold') && Number.isFinite(ru) && ru > 0) return w * ru
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

function pickConversionRate(ratebook: QuoteRatebook, gaugeUm: number, lengthMm: number): (typeof ratebook.conversion_rates)[number] | null {
  const g = Number(gaugeUm || 0)
  const l = Number(lengthMm || 0)
  const rows = Array.isArray(ratebook.conversion_rates) ? ratebook.conversion_rates : []
  return (
    rows.find((r) => g >= r.min_gauge_um && g <= r.max_gauge_um && l >= r.min_length_mm && l <= r.max_length_mm) ||
    rows[0] ||
    null
  )
}

function computeDerivedGeometryAndTotals(inputs: QuickQuoteInputs, ratebook: QuoteRatebook) {
  const units = typeof inputs.quantity.units === 'number' && inputs.quantity.units > 0 ? Math.round(inputs.quantity.units) : null
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
  const effectiveLenM = inputs.continuous_roll ? 1 : mmToM(unitLengthMm || 0)
  const areaPerUnitM2 = effectiveLenM * mmToM(layflatMm)

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
  const kgPerUnit = areaPerUnitM2 * kgPerM2

  // Yield: meters per kg (m/kg), based on kg per linear meter of film.
  // kg_per_m = kg_per_m2 * width_m
  const kgPerLinearM = kgPerM2 * mmToM(layflatMm)
  const yieldMPerKg = kgPerLinearM > 0 ? 1 / kgPerLinearM : null

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

  const derivedTotalKg =
    totalKgReqPlastic != null
      ? totalKgReqPlastic
      : totalMReq != null && kgPerLinearM > 0
        ? totalMReq * kgPerLinearM
        : units != null
          ? kgPerUnit * units
          : 0
  let derivedTotalM = totalMReq != null ? totalMReq : derivedTotalKg > 0 && kgPerLinearM > 0 ? derivedTotalKg / kgPerLinearM : 0
  let trimmedTotalKg = derivedTotalKg

  // Trim reduces the job length (and therefore material) irrespective of how the length was derived.
  // Example: 5% trim of 10000m => 9500m.
  const trimPct = inputs.trim_pct != null && Number.isFinite(Number(inputs.trim_pct)) ? Number(inputs.trim_pct) : null
  if (trimPct != null && trimPct > 0 && derivedTotalM > 0) {
    const trimFactor = clamp(1 - trimPct / 100, 0, 1)
    derivedTotalM = derivedTotalM * trimFactor
    trimmedTotalKg = trimmedTotalKg * trimFactor
  }

  const webLengthM = derivedTotalM

  const canComputeRollStats = rolls != null && rolls > 0 && kgPerLinearM > 0 && trimmedTotalKg > 0 && derivedTotalM > 0
  const kgPerRoll = canComputeRollStats ? trimmedTotalKg / rolls : null
  const mPerRoll = canComputeRollStats ? derivedTotalM / rolls : null

  return {
    units,
    rolls,
    layflatMm,
    blend,
    density,
    kgPerM2,
    kgPerUnit,
    kgPerLinearM,
    yieldMPerKg,
    derivedTotalKg: trimmedTotalKg,
    derivedTotalM,
    webLengthM,
    kgPerRoll,
    mPerRoll,
  }
}

export type AppliedExtrusionWasteFactor = {
  slug: string
  minutes: number
}

function computeExtrusionWasteMinutes(applied: AppliedExtrusionWasteFactor[]): number {
  const base = applied.find((f) => f.slug === 'simple_job')?.minutes ?? 0
  const parallel = applied
    .filter((f) => f.slug !== 'simple_job')
    .reduce((acc, f) => Math.max(acc, Number(f.minutes || 0)), 0)
  return Math.max(0, Number(base || 0)) + Math.max(0, Number(parallel || 0))
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

  // Custom waste factor logic (minutes configurable in DB):
  // - simple_job: always applies
  // - gusset: gusseted geometry
  // - non_standard_resin_or_colour: any colour OR additives OR resin blend other than default
   // - complex_set_up_print_or_perforation: printing OR any conversion flags that complicate setup
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

export function computeRollMetrics(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): Pick<QuotePreview, 'kg_per_roll' | 'm_per_roll'> {
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  return { kg_per_roll: d.kgPerRoll, m_per_roll: d.mPerRoll }
}

export function computeQuickQuotePreview(inputs: QuickQuoteInputs, ratebook: QuoteRatebook): QuotePreview {
  const margin = clamp(Number(inputs.requested_margin || 0), 0, 0.999)
  const d = computeDerivedGeometryAndTotals(inputs, ratebook)
  const units = d.units
  const rolls = d.rolls
  const layflatMm = d.layflatMm
  const blend = d.blend
  const kgPerUnit = d.kgPerUnit
  const yieldMPerKg = d.yieldMPerKg
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

  const { printing_cost: printingCost, printing_unavailable_reason: printingUnavailableReason } = computePrinting(inputs, ratebook)

  // Conversion (only for cartons)
  let conversionCost = 0
  if (inputs.finish_mode === 'Cartons' && units != null) {
    const conv = pickConversionRate(ratebook, Number(inputs.thickness_um || 0), Number(inputs.base_length_mm || 0))
    if (conv) {
      const bpm = Number(conv.bags_per_hour || 0) / 60
      const minutes = (units / Math.max(bpm || 1e-9, 1e-9)) + Number(conv.setup_minutes || 0)
      conversionCost = minutes * 1
    }
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
  // - wasted material (handled here via wasteKg -> wasteCost)
  const baseWasteAdderMinutes = (Array.isArray(ratebook.waste_adders) ? ratebook.waste_adders : []).reduce(
    (acc, w) => acc + Number(w?.waste_minutes || 0),
    0,
  )
  const wasteMinutes = baseWasteAdderMinutes + extrusionExtraMinutes
  let wasteCost = 0
  const throughput =
    inputs.extruder_code && Array.isArray(ratebook.extruders)
      ? Number(ratebook.extruders.find((e) => String(e?.extruder_code || '') === String(inputs.extruder_code || ''))?.average_kg_hr || 0)
      : Number(ratebook.extrusion_throughput_kg_per_hr || 0)
  if (wasteMinutes > 0 && throughput > 0 && materialCostPerKg > 0) {
    const wasteKg = (wasteMinutes / 60) * throughput
    wasteCost = wasteKg * materialCostPerKg
  }

  const totalCost = materialCost + extrusionCost + printingCost + conversionCost + coreCost + wasteCost
  const finalPrice = margin < 1 ? totalCost / (1 - margin) : totalCost
  const unitPrice = units != null ? finalPrice / units : null
  const costPerKg = derivedTotalKg > 0 ? totalCost / derivedTotalKg : null

  return {
    // This is a geometric/material property (for discrete products), not dependent on the quote quantity type.
    // Keep it available even when quoting by KG/meters/rolls, so the UI can show "kg / 1000 products".
    kg_per_unit: inputs.continuous_roll ? null : kgPerUnit,
    units_per_roll: null,
    totals_kg: derivedTotalKg,
    totals_units: units,
    // Do not clamp/round yield; let the UI format it.
    yield_m_per_kg: yieldMPerKg,
    kg_per_roll: kgPerRoll,
    m_per_roll: mPerRoll,
    cost_per_kg: costPerKg != null ? roundMoney(costPerKg) : null,
    extrusion_hours: extrusionHours,
    extrusion_waste_minutes: Math.max(0, Math.round(extrusionExtraMinutes)),
    printing_unavailable_reason: printingUnavailableReason,
    cost_breakdown: {
      material_cost: roundMoney(materialCost),
      extrusion_cost: roundMoney(extrusionCost),
      printing_cost: roundMoney(printingCost),
      conversion_cost: roundMoney(conversionCost),
      core_cost: roundMoney(coreCost),
      waste_cost: roundMoney(wasteCost),
    },
    total_cost: roundMoney(totalCost),
    margin,
    final_price: roundMoney(finalPrice),
    unit_price: unitPrice != null ? roundMoney(unitPrice) : null,
  }
}


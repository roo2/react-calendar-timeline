import type { SpecPayload } from '../components/SpecPayloadForm'
import {
  computeDerivedGeometryAndTotals,
  computeQuickQuotePreview,
  type QuickQuoteInputs,
  type QuoteRatebook,
} from './quoteCalculator'

function nn(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** Approximate inner mandrel radius (m) for winding OD estimate from core type label (not a caliper measurement). */
function coreInnerRadiusMForWoundRoll(coreType: string | null | undefined): number {
  const t = String(coreType || '').trim().toLowerCase()
  if (t === '7mm') return 0.0254 // ~2" ID
  if (t === '13mm') return 0.0381 // ~3" ID (common blown-film default in this app)
  if (t === 'pvc') return 0.0381
  if (t === 'none' || t === '') return 0.0254
  return 0.0381
}

/**
 * Cylinder envelope πR²W for a wound roll: R from core radius + annulus area ≈ web_length × thickness.
 * Floors per-roll volume when `kg/density` is unrealistically small (e.g. roll-count / nominal weight mismatch).
 */
export function rollCylinderEnvelopeM3FromWebRoll(opts: {
  mPerRoll: number | null | undefined
  layflatMassMm: number | null | undefined
  thicknessUm: number | null | undefined
  coreType: string | null | undefined
}): number | null {
  const L = opts.mPerRoll != null ? Number(opts.mPerRoll) : NaN
  const Wmm = opts.layflatMassMm != null ? Number(opts.layflatMassMm) : NaN
  const tum = opts.thicknessUm != null ? Number(opts.thicknessUm) : NaN
  if (!(L > 0) || !(L < 1_000_000)) return null
  if (!(Wmm > 0) || !(Wmm < 100_000)) return null
  if (!(tum > 0) || !(tum < 5_000_000)) return null
  const t = tum / 1_000_000
  const r = coreInnerRadiusMForWoundRoll(opts.coreType)
  const inner = r * r + (L * t) / Math.PI
  if (!(inner > 0)) return null
  const R = Math.sqrt(inner)
  const W = Wmm / 1000
  const v = Math.PI * R * R * W
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Rough guide: usable pallet volume = pallet_volume_m³ × packing factor (admin settings);
 * each unit (roll or carton) occupies mass ÷ blend density. Not a true 3D packing fit.
 *
 * Rolls: effective per-roll volume is max(solid polymer kg ÷ density, optional winding cylinder floor)
 * so bad quantity splits cannot imply "thousands of featherweight rolls" from polymer volume alone.
 */
export function estimateUnitsPerPalletVolumeHeuristic(opts: {
  ratebook: QuoteRatebook | null | undefined
  finishMode: 'rolls' | 'cartons'
  /** kg per finished roll (Rolls mode). */
  kgPerRoll: number | null | undefined
  /** kg per finished carton (Cartons mode), e.g. bags_per_carton × kg per bag. */
  kgPerCarton: number | null | undefined
  /** Blend density (kg/m³) from geometry + resin mix. */
  densityKgPerM3: number | null | undefined
  /** Rolls only: floor per-roll volume (m³), e.g. cylinder envelope from web length × thickness. */
  minPartVolumeM3PerRoll?: number | null | undefined
}): number | null {
  const rb = opts.ratebook
  const vol = rb?.pallet_volume_m3 != null ? Number(rb.pallet_volume_m3) : NaN
  const pfRaw =
    opts.finishMode === 'cartons' ? rb?.packing_factor_cartons : rb?.packing_factor_rolls
  const pf = pfRaw != null ? Number(pfRaw) : NaN
  if (!Number.isFinite(vol) || vol <= 0) return null
  if (!Number.isFinite(pf) || pf <= 0 || pf > 1) return null
  const density = opts.densityKgPerM3 != null ? Number(opts.densityKgPerM3) : NaN
  if (!Number.isFinite(density) || density <= 0) return null

  const kgOne =
    opts.finishMode === 'cartons'
      ? opts.kgPerCarton != null && Number.isFinite(Number(opts.kgPerCarton)) && Number(opts.kgPerCarton) > 0
        ? Number(opts.kgPerCarton)
        : null
      : opts.kgPerRoll != null && Number.isFinite(Number(opts.kgPerRoll)) && Number(opts.kgPerRoll) > 0
        ? Number(opts.kgPerRoll)
        : null
  if (kgOne == null) return null

  const solidVolM3 = kgOne / density
  if (!Number.isFinite(solidVolM3) || solidVolM3 <= 0) return null
  const floorRaw = opts.minPartVolumeM3PerRoll != null ? Number(opts.minPartVolumeM3PerRoll) : NaN
  const floor =
    opts.finishMode === 'rolls' && Number.isFinite(floorRaw) && floorRaw > 0 ? floorRaw : null
  const partVolM3 = floor != null ? Math.max(solidVolM3, floor) : solidVolM3
  if (!Number.isFinite(partVolM3) || partVolM3 <= 0) return null
  const usable = vol * pf
  const est = Math.floor(usable / partVolM3)
  return est > 0 ? est : null
}

/** Whole pallets needed to ship `orderUnits` when each pallet holds `unitsPerPallet` units. */
export function palletsRequiredCeil(orderUnits: number, unitsPerPallet: number | null | undefined): number | null {
  const o = Math.round(Number(orderUnits))
  const u = unitsPerPallet != null && Number.isFinite(Number(unitsPerPallet)) ? Math.round(Number(unitsPerPallet)) : null
  if (u == null || u <= 0) return null
  if (!Number.isFinite(o) || o <= 0) return null
  return Math.max(1, Math.ceil(o / u))
}

/**
 * Same volume heuristic as quotes, driven by live spec + quote inputs (job sheet editor).
 * For on-screen guidance only — not shown on the printed job sheet.
 */
export function estimateUnitsPerPalletVolumeFromLiveSpec(opts: {
  ratebook: QuoteRatebook | null | undefined
  spec: SpecPayload
  quickInputs: QuickQuoteInputs | null | undefined
  extruderCode: string | null | undefined
}): number | null {
  const { ratebook: rb, spec, quickInputs, extruderCode } = opts
  if (!rb || !quickInputs) return null
  let geoDerived: ReturnType<typeof computeDerivedGeometryAndTotals> | null = null
  let quotePreview: ReturnType<typeof computeQuickQuotePreview> | null = null
  try {
    geoDerived = computeDerivedGeometryAndTotals(quickInputs, rb)
    const ext = extruderCode != null && String(extruderCode).trim() !== '' ? String(extruderCode).trim() : ''
    if (ext) quotePreview = computeQuickQuotePreview(quickInputs, rb)
  } catch {
    return null
  }
  const finishNorm = String(spec.identity?.finish_mode ?? '').trim().toLowerCase()
  const packaging = spec.packaging || {}
  const kgPerRollDerived =
    geoDerived?.kgPerRoll != null && Number(geoDerived.kgPerRoll) > 0 && Number.isFinite(Number(geoDerived.kgPerRoll))
      ? Number(geoDerived.kgPerRoll)
      : quotePreview?.kg_per_roll != null &&
          Number(quotePreview.kg_per_roll) > 0 &&
          Number.isFinite(Number(quotePreview.kg_per_roll))
        ? Number(quotePreview.kg_per_roll)
        : null
  const nominalKr =
    quickInputs.nominal_weight_per_roll_kg != null &&
    Number.isFinite(Number(quickInputs.nominal_weight_per_roll_kg)) &&
    Number(quickInputs.nominal_weight_per_roll_kg) > 0
      ? Number(quickInputs.nominal_weight_per_roll_kg)
      : null
  const kgPerRollEst =
    finishNorm === 'cartons'
      ? null
      : kgPerRollDerived != null && nominalKr != null
        ? Math.max(kgPerRollDerived, nominalKr)
        : kgPerRollDerived ?? nominalKr
  const bpcForPallet = nn(packaging?.bags_per_carton)
  const kgPerCartonEst =
    finishNorm === 'cartons' &&
    bpcForPallet != null &&
    bpcForPallet > 0 &&
    geoDerived?.kgPerUnit != null &&
    Number(geoDerived.kgPerUnit) > 0 &&
    Number.isFinite(Number(geoDerived.kgPerUnit))
      ? bpcForPallet * Number(geoDerived.kgPerUnit)
      : null
  const densityForPallet =
    geoDerived?.density != null && Number(geoDerived.density) > 0 && Number.isFinite(Number(geoDerived.density))
      ? Number(geoDerived.density)
      : null
  const minPartVolRolls =
    finishNorm !== 'cartons' && geoDerived
      ? rollCylinderEnvelopeM3FromWebRoll({
          mPerRoll: geoDerived.mPerRoll,
          layflatMassMm: geoDerived.layflatMassMm,
          thicknessUm: quickInputs.thickness_um,
          coreType: packaging.core_type ?? quickInputs.core_type,
        })
      : null
  return estimateUnitsPerPalletVolumeHeuristic({
    ratebook: rb,
    finishMode: finishNorm === 'cartons' ? 'cartons' : 'rolls',
    kgPerRoll: finishNorm === 'cartons' ? null : kgPerRollEst,
    kgPerCarton: finishNorm === 'cartons' ? kgPerCartonEst : null,
    densityKgPerM3: densityForPallet,
    minPartVolumeM3PerRoll: finishNorm === 'cartons' ? null : minPartVolRolls,
  })
}

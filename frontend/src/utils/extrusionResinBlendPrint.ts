/**
 * Extrusion job sheet: resin / colour / additive blend mass breakdown for print.
 *
 * Formulation percentages can sum above 100% (colours and additives on top of a 100% resin
 * blend). Productive plastic kg matches the quote calculator's `derivedTotalKg` (trim;
 * roll-weight billing subtracts core mass for `core_included` / `core_half_off` while
 * `totals_kg` stays billed). Extrusion waste (downtime + default order %) is
 * allocated proportionally; total column = productive + waste share = extruded mass.
 */

import { fmtQtyNumber } from './quoteFormat'
import type { RollWeightBillingSlug } from './specToQuoteInputs'

/** Decimal places for all numeric values on the extrusion specifications print block. */
export const EXTRUSION_PRINT_QTY_DP = 1

export function formatExtrusionQty(n: number): string {
  return fmtQtyNumber(n, EXTRUSION_PRINT_QTY_DP)
}

export type ExtrusionResinBlendComponent = {
  key: string
  label: string
  pct: number
  bgHex?: string | null
  textColor?: string | null
}

export type ExtrusionResinBlendPrintRow = ExtrusionResinBlendComponent & {
  kg: number | null
  wasteKg: number | null
  totalKg: number | null
}

export type ExtrusionResinBlendPrintTable = {
  caption: string
  variant: 'ld' | 'preset' | 'custom'
  rows: ExtrusionResinBlendPrintRow[]
  totalPct: number
  totalProductiveKg: number | null
  totalWasteKg: number | null
  totalExtrudedKg: number | null
}

function roundKg(n: number): number {
  if (!Number.isFinite(n)) return 0
  const factor = 10 ** EXTRUSION_PRINT_QTY_DP
  return Math.round(n * factor) / factor
}

export function formatBlendPct(pct: number): string {
  if (!Number.isFinite(pct)) return '-'
  const isWhole = Math.abs(pct - Math.round(pct)) < 1e-6
  if (isWhole) return `${Math.round(pct).toLocaleString('en-US')}%`
  return `${fmtQtyNumber(pct, EXTRUSION_PRINT_QTY_DP)}%`
}

/** Core mass deducted from resin blend KG (matches quote `derivedTotalKg` adjustment). */
/**
 * Roll weight shown on the job sheet (always includes full core mass per roll).
 * `kgPerRoll` is quote preview kg/roll (plastic or billed, per roll-weight billing).
 */
export function kgPerRollWithCoreWeight(
  kgPerRoll: number | null,
  opts: {
    billingSlug: RollWeightBillingSlug
    totalCoreKg: number | null
    rollCount: number
  },
): number | null {
  if (kgPerRoll == null || !Number.isFinite(kgPerRoll) || kgPerRoll <= 0) return null
  const rolls = opts.rollCount > 0 ? opts.rollCount : 0
  if (rolls <= 0) return kgPerRoll
  if (opts.totalCoreKg == null || !Number.isFinite(opts.totalCoreKg) || opts.totalCoreKg <= 0) {
    return kgPerRoll
  }
  const corePerRoll = opts.totalCoreKg / rolls
  const addCoreFrac =
    opts.billingSlug === 'core_included' ? 0 : opts.billingSlug === 'core_half_off' ? 0.5 : 1
  const factor = 10 ** EXTRUSION_PRINT_QTY_DP
  return Math.round((kgPerRoll + corePerRoll * addCoreFrac) * factor) / factor
}

export function coreKgIncludedForRollWeightBilling(
  billingSlug: RollWeightBillingSlug,
  coreLengthM: number | null,
  kgPerMeter: number | null,
): { includedKg: number; totalCoreKg: number } | null {
  if (billingSlug === 'core_off') return null
  if (coreLengthM == null || coreLengthM <= 0 || !Number.isFinite(coreLengthM)) return null
  if (kgPerMeter == null || kgPerMeter <= 0 || !Number.isFinite(kgPerMeter)) return null
  const totalCoreKg = coreLengthM * kgPerMeter
  const frac = billingSlug === 'core_half_off' ? 0.5 : 1
  const factor = 10 ** EXTRUSION_PRINT_QTY_DP
  return {
    totalCoreKg: Math.round(totalCoreKg * factor) / factor,
    includedKg: Math.round(totalCoreKg * frac * factor) / factor,
  }
}

/** KG of core mass included in billed / resin-blend plastic totals (0 when `core_off`). */
export function coreWeightIncludedKgForBilling(
  billingSlug: RollWeightBillingSlug,
  coreLengthM: number | null,
  kgPerMeter: number | null,
): number | null {
  if (billingSlug === 'core_off') return null
  const weights = coreKgIncludedForRollWeightBilling(billingSlug, coreLengthM, kgPerMeter)
  return weights?.includedKg ?? null
}

export function formatBlendKgCell(n: number | null, opts?: { withSuffix?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return '-'
  const core = formatExtrusionQty(n)
  return opts?.withSuffix ? `${core}kg` : core
}

/**
 * @param productivePlasticKg Quote `derivedTotalKg` — film plastic required (after trim & core billing).
 * @param extrusionWasteKg Sum of extrusion downtime waste + default order % waste.
 * @param totalExtrudedKg `derivedTotalKg + extrusionWasteKg` when available.
 */
export function buildExtrusionResinBlendPrintTable(
  components: ExtrusionResinBlendComponent[],
  opts: {
    caption: string
    variant: 'ld' | 'preset' | 'custom'
    productivePlasticKg: number | null
    extrusionWasteKg: number | null
    totalExtrudedKg: number | null
  },
): ExtrusionResinBlendPrintTable | null {
  if (!components.length) return null

  const totalPct = components.reduce((s, c) => s + (Number.isFinite(c.pct) ? c.pct : 0), 0)
  if (totalPct <= 0) return null

  const plasticKg =
    opts.productivePlasticKg != null && opts.productivePlasticKg > 0 && Number.isFinite(opts.productivePlasticKg)
      ? opts.productivePlasticKg
      : null

  if (plasticKg == null) {
    return {
      caption: opts.caption,
      variant: opts.variant,
      rows: components.map((c) => ({ ...c, kg: null, wasteKg: null, totalKg: null })),
      totalPct,
      totalProductiveKg: null,
      totalWasteKg: null,
      totalExtrudedKg: null,
    }
  }

  const wasteTotal =
    opts.extrusionWasteKg != null && opts.extrusionWasteKg >= 0 && Number.isFinite(opts.extrusionWasteKg)
      ? opts.extrusionWasteKg
      : 0
  const extrudedTotal =
    opts.totalExtrudedKg != null && opts.totalExtrudedKg > 0 && Number.isFinite(opts.totalExtrudedKg)
      ? opts.totalExtrudedKg
      : plasticKg + wasteTotal
  const wasteFactor = plasticKg > 0 ? wasteTotal / plasticKg : 0

  const rows: ExtrusionResinBlendPrintRow[] = components.map((c) => {
    const lineKg = (plasticKg * c.pct) / totalPct
    const lineWaste = lineKg * wasteFactor
    const lineTotal = lineKg + lineWaste
    return {
      ...c,
      kg: roundKg(lineKg),
      wasteKg: roundKg(lineWaste),
      totalKg: roundKg(lineTotal),
    }
  })

  return {
    caption: opts.caption,
    variant: opts.variant,
    rows,
    totalPct,
    totalProductiveKg: roundKg(plasticKg),
    totalWasteKg: roundKg(wasteTotal),
    totalExtrudedKg: roundKg(extrudedTotal),
  }
}

/**
 * Live job sheet sidebar metrics (same calculator + formatters as Quotes page).
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import { computeQuickQuotePreview, type QuoteRatebook, type QuickQuoteInputs } from './quoteCalculator'
import { fmtHoursMinutesPreview, fmtQtyNumber } from './quoteFormat'
import { jobSheetOrderQuantityLabel } from './quoteQuantityDescriptors'

export type JobSheetPreviewQuoteSummary = {
  orderQuantityLabel: string | null
  /** Extruded film kg from the quote calculator (includes extrusion waste). */
  totalKgIncludingWaste: string | null
  /** Same basis as Quotes: {@link fmtHoursMinutesPreview}(extrusion_hours × 60); job sheet UI omits parentheses around the string. */
  extrusionTimeDisplay: string | null
  extrudedMeters: string | null
  /**
   * Extrusion downtime waste as % of **productive plastic kg** (film to make the job, before extrusion waste).
   * Uses `total_extruded_kg − waste_kg` as the denominator so roll-weight billing (billed kg includes cores)
   * does not skew the % vs `totals_kg` (billable).
   */
  estimatedWasteFactorPct: string | null
}

export function computeJobSheetPreviewQuoteSummary(
  spec: SpecPayload,
  jsRow: Record<string, unknown>,
  ratebook: QuoteRatebook | null | undefined,
  quickInputs: QuickQuoteInputs | null | undefined,
): JobSheetPreviewQuoteSummary {
  const orderRaw = jobSheetOrderQuantityLabel(jsRow, spec as Record<string, unknown>)
  const orderQuantityLabel =
    orderRaw && orderRaw !== '—' && String(orderRaw).trim() !== '' ? String(orderRaw).trim() : null

  if (!ratebook || !quickInputs) {
    return {
      orderQuantityLabel,
      totalKgIncludingWaste: null,
      extrusionTimeDisplay: null,
      extrudedMeters: null,
      estimatedWasteFactorPct: null,
    }
  }

  let preview: ReturnType<typeof computeQuickQuotePreview> | null = null
  try {
    preview = computeQuickQuotePreview(quickInputs, ratebook)
  } catch {
    preview = null
  }

  if (!preview) {
    return {
      orderQuantityLabel,
      totalKgIncludingWaste: null,
      extrusionTimeDisplay: null,
      extrudedMeters: null,
      estimatedWasteFactorPct: null,
    }
  }

  const extrudedBaseNum =
    preview.total_extruded_kg != null && Number(preview.total_extruded_kg) > 0 && Number.isFinite(Number(preview.total_extruded_kg))
      ? Number(preview.total_extruded_kg)
      : null
  const totalKgIncludingWaste = extrudedBaseNum != null ? fmtQtyNumber(extrudedBaseNum, 2) : null

  let extrusionTimeDisplay: string | null = null
  if (
    preview.extrusion_hours != null &&
    Number.isFinite(Number(preview.extrusion_hours)) &&
    Number(preview.extrusion_hours) >= 0
  ) {
    extrusionTimeDisplay = fmtHoursMinutesPreview(Number(preview.extrusion_hours) * 60) || null
  }

  const extrudedMeters =
    preview.totals_m != null && Number(preview.totals_m) > 0 && Number.isFinite(Number(preview.totals_m))
      ? `${fmtQtyNumber(Number(preview.totals_m), 2)} m`
      : null

  let estimatedWasteFactorPct: string | null = null
  const extKgRaw = preview.total_extruded_kg
  const wasteKgRaw = preview.waste_kg
  const extKg = extKgRaw != null && Number.isFinite(Number(extKgRaw)) && Number(extKgRaw) > 0 ? Number(extKgRaw) : null
  const wasteKg =
    wasteKgRaw != null && Number.isFinite(Number(wasteKgRaw)) && Number(wasteKgRaw) > 0 ? Number(wasteKgRaw) : 0
  if (extKg != null) {
    const plasticKg = Math.max(0, extKg - wasteKg)
    if (plasticKg > 0) {
      const pct = (wasteKg / plasticKg) * 100
      if (Number.isFinite(pct)) {
        estimatedWasteFactorPct =
          Math.abs(pct - Math.round(pct)) < 1e-6 ? `${Math.round(pct)}%` : `${pct.toFixed(2)}%`
      }
    }
  }

  return {
    orderQuantityLabel,
    totalKgIncludingWaste,
    extrusionTimeDisplay,
    extrudedMeters,
    estimatedWasteFactorPct,
  }
}

/**
 * Live job sheet sidebar metrics (same calculator + formatters as Quotes page).
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import { computeQuickQuotePreview, type QuoteRatebook, type QuickQuoteInputs } from './quoteCalculator'
import { fmtHoursMinutesPreview, fmtQtyNumber } from './quoteFormat'
import { buildJobSheetPrintHeaderSummaryLine } from './jobSheetPrintHeaderSummary'
import { jobSheetOrderQuantityLabel } from './quoteQuantityDescriptors'

export type JobSheetPreviewQuoteSummary = {
  /** One-line print header summary (type/finish code, qty, packing, rolls/ctns). */
  headerSummaryLine: string | null
  orderQuantityLabel: string | null
  /** Productive plastic kg before waste factors are added. */
  productiveKg: string | null
  /** Extruded film kg from the quote calculator (includes extrusion waste). */
  totalKgIncludingWaste: string | null
  wasteBreakdownLines: Array<{ label: string; value: string }>
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
  const specRec = spec as Record<string, unknown>
  const npuRaw = jsRow.num_product_units
  const npu = npuRaw != null && npuRaw !== '' ? Number(npuRaw) : NaN
  const derivedProductUnits = Number.isFinite(npu) && npu > 0 ? Math.round(npu) : null
  const geoDerived =
    (jsRow.total_m != null && Number(jsRow.total_m) > 0) || derivedProductUnits != null
      ? {
          derivedTotalM:
            jsRow.total_m != null && Number(jsRow.total_m) > 0 ? Number(jsRow.total_m) : 0,
          mPerRoll:
            jsRow.num_rolls != null && Number(jsRow.num_rolls) > 0 && jsRow.total_m != null
              ? Number(jsRow.total_m) / Number(jsRow.num_rolls)
              : null,
          derivedProductUnits,
        }
      : null
  const headerSummaryRaw = buildJobSheetPrintHeaderSummaryLine(jsRow, specRec, geoDerived)
  const headerSummaryLine = headerSummaryRaw.trim() !== '' ? headerSummaryRaw.trim() : null

  const orderRaw = jobSheetOrderQuantityLabel(jsRow, specRec)
  const orderQuantityLabel =
    orderRaw && orderRaw !== '—' && String(orderRaw).trim() !== '' ? String(orderRaw).trim() : null

  if (!ratebook || !quickInputs) {
    return {
      headerSummaryLine,
      orderQuantityLabel,
      productiveKg: null,
      totalKgIncludingWaste: null,
      wasteBreakdownLines: [],
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
      headerSummaryLine,
      orderQuantityLabel,
      productiveKg: null,
      totalKgIncludingWaste: null,
      wasteBreakdownLines: [],
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
  const plasticKg = extKg != null ? Math.max(0, extKg - wasteKg) : null
  if (extKg != null) {
    if (plasticKg != null && plasticKg > 0) {
      const pct = (wasteKg / plasticKg) * 100
      if (Number.isFinite(pct)) {
        estimatedWasteFactorPct =
          Math.abs(pct - Math.round(pct)) < 1e-6 ? `${Math.round(pct)}%` : `${pct.toFixed(2)}%`
      }
    }
  }

  const fmtKg = (kg: number) => `${fmtQtyNumber(kg, 2)} kg`
  const fmtPct = (pct: number) => (Math.abs(pct - Math.round(pct)) < 1e-6 ? `${Math.round(pct)}%` : `${pct.toFixed(2)}%`)
  const wasteBreakdownLines: Array<{ label: string; value: string }> = []
  const downtimeWasteKg =
    preview.waste_kg_downtime != null && Number.isFinite(Number(preview.waste_kg_downtime)) && Number(preview.waste_kg_downtime) > 0
      ? Number(preview.waste_kg_downtime)
      : 0
  if (downtimeWasteKg > 0) {
    const minutes = Number(preview.extrusion_waste_minutes || 0)
    wasteBreakdownLines.push({
      label: 'Setup / extrusion waste:',
      value: `${fmtKg(downtimeWasteKg)}${minutes > 0 ? ` (${Math.round(minutes)} min)` : ''}`,
    })
  }
  const orderWasteKg =
    preview.waste_kg_order_pct != null && Number.isFinite(Number(preview.waste_kg_order_pct)) && Number(preview.waste_kg_order_pct) > 0
      ? Number(preview.waste_kg_order_pct)
      : 0
  if (orderWasteKg > 0) {
    wasteBreakdownLines.push({
      label: 'Default order waste:',
      value: `${fmtKg(orderWasteKg)} (${fmtPct(Number(preview.default_order_waste_pct || 0))})`,
    })
  }
  const conversionWasteKg =
    preview.waste_kg_conversion_pct != null &&
    Number.isFinite(Number(preview.waste_kg_conversion_pct)) &&
    Number(preview.waste_kg_conversion_pct) > 0
      ? Number(preview.waste_kg_conversion_pct)
      : 0
  if (conversionWasteKg > 0) {
    wasteBreakdownLines.push({
      label: 'Conversion waste:',
      value: `${fmtKg(conversionWasteKg)} (${fmtPct(Number(preview.conversion_waste_pct || 0))})`,
    })
  }

  return {
    headerSummaryLine,
    orderQuantityLabel,
    productiveKg: plasticKg != null && plasticKg > 0 ? fmtQtyNumber(plasticKg, 2) : null,
    totalKgIncludingWaste,
    wasteBreakdownLines,
    extrusionTimeDisplay,
    extrudedMeters,
    estimatedWasteFactorPct,
  }
}

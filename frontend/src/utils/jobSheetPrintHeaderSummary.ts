import type { SpecPayload } from '../components/SpecPayloadForm'
import { productTypeFinishLabelFromSpec } from './productDescription'
import { resolvedProductUnitsForOrder } from './quantityRollFields'
import { fmtCount } from './quoteFormat'
import { extrusionRollCountForPrint, orderQtyPrefsFromJobSheetAndSpec } from './specOrderDefaults'
import {
  jobSheetAsQuoteQtyPayload,
  packagingPerUnitTailFromPersistedJobSheet,
  quotePayloadUsesContinuousLength,
  quoteProductUnitLabel,
  quoteQtyModeFromPayload,
  quoteTotalQuantityLabelFromPayload,
} from './quoteQuantityDescriptors'

export type JobSheetPrintHeaderGeoSnapshot = {
  derivedTotalM: number
  mPerRoll: number | null
}

/** Normalise order qty for print header (e.g. `40,000 bags` → `40000 Bags`, `99.00 KG` → `99KG`). */
export function formatOrderQuantityForPrintHeader(raw: string): string {
  const t = String(raw ?? '').trim()
  if (!t || t === '—') return ''
  const m = t.match(/^([\d,.]+)\s+(.+)$/i)
  if (!m) return t
  const num = m[1].replace(/,/g, '')
  const unitRaw = m[2].trim()
  const unitLower = unitRaw.toLowerCase()
  if (unitLower === 'kg') return `${num}KG`
  if (unitLower === 'ctn') return `${num} Ctn`
  if (unitLower === 'roll' || unitLower === 'rolls') {
    const n = Number(num)
    return Number.isFinite(n) && n === 1 ? '1 Roll' : `${num} Rolls`
  }
  if (unitLower === 'ea') return `${num} ea`
  const unitTitle =
    unitRaw.charAt(0).toUpperCase() + unitRaw.slice(1).toLowerCase()
  return `${num} ${unitTitle}`
}

/** Compact packing readout (e.g. `200 bags/roll`, `400 bags/Ctn`, `20kg/roll`). */
export function formatPackagingPerUnitForPrintHeader(tail: string): string {
  let t = String(tail ?? '').trim().replace(/\.\s*$/, '')
  if (!t) return ''
  t = t
    .replace(/\/ROLL\.?/gi, '/roll')
    .replace(/\/CTN\.?/gi, '/Ctn')
    .replace(/(\d+(?:\.\d+)?)\s*kg\/roll/gi, '$1kg/roll')
    .replace(/(\d+(?:\.\d+)?)\s*m\/roll/gi, '$1m/roll')
    .replace(/\s+Bags\b/g, ' bags')
    .replace(/\s+bags\/Ctn/gi, ' bags/Ctn')
  return t
}

function orderedKgForExtrusionRollCount(js: Record<string, unknown>): number | null {
  const qv = Number(js.quantity_value ?? 0)
  const qu = String(js.quantity_unit ?? '').toLowerCase()
  if (qu === 'kg' && qv > 0 && Number.isFinite(qv)) return qv
  const totalKg = js.total_kg != null ? Number(js.total_kg) : NaN
  if (Number.isFinite(totalKg) && totalKg > 0) return totalKg
  return null
}

/** Roll / carton count for print header (e.g. `40 Ctns`, `12 Rolls`, `40 Ctns (12 Rolls)`). */
export function jobSheetRollCartonCountLabel(
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
  extrusionRollCountOverride?: number | null,
): string {
  const identity = (spec as { identity?: Record<string, unknown> }).identity || {}
  const packaging = (spec as { packaging?: Record<string, unknown> }).packaging || {}
  const finish = String(identity.finish_mode || 'Rolls').trim() === 'Cartons' ? 'Cartons' : 'Rolls'
  const schedulingRolls = Math.max(0, Math.round(Number(js.num_rolls || 0)))
  const qtyType = String(js.qty_type || 'kg').trim()
  const qu = String(js.quantity_unit || '').toLowerCase()
  const qv = Number(js.quantity_value || 0)
  const bagsPerCarton = Math.max(0, Math.round(Number(packaging.bags_per_carton || 0)))

  const prefs = orderQtyPrefsFromJobSheetAndSpec(js, spec as SpecPayload)
  const weightPerRollKg =
    prefs.weight_per_roll_kg != null && prefs.weight_per_roll_kg > 0
      ? prefs.weight_per_roll_kg
      : js.weight_per_roll_kg != null && Number(js.weight_per_roll_kg) > 0
        ? Number(js.weight_per_roll_kg)
        : null

  const extrusionRolls =
    extrusionRollCountOverride != null && extrusionRollCountOverride > 0
      ? Math.round(extrusionRollCountOverride)
      : extrusionRollCountForPrint({
          finishMode: finish,
          totalKg: orderedKgForExtrusionRollCount(js),
          weightPerRollKg,
          schedulingRollCount: schedulingRolls > 0 ? schedulingRolls : null,
        })

  if (finish === 'Cartons') {
    let numCartons = qtyType === 'units' && qu === 'cartons' && qv > 0 ? Math.round(qv) : 0
    const npu = js.num_product_units != null ? Number(js.num_product_units) : NaN
    if (!(numCartons > 0) && Number.isFinite(npu) && npu > 0 && bagsPerCarton > 0) {
      numCartons = Math.ceil(npu / bagsPerCarton)
    }
    if (numCartons > 0 && extrusionRolls > 0) {
      return `${fmtCount(numCartons)} Ctns (${fmtCount(extrusionRolls)} Rolls)`
    }
    if (numCartons > 0) return `${fmtCount(numCartons)} Ctns`
    if (extrusionRolls > 0) {
      return extrusionRolls === 1 ? '1 Roll' : `${fmtCount(extrusionRolls)} Rolls`
    }
    return ''
  }
  if (extrusionRolls > 0) {
    return extrusionRolls === 1 ? '1 Roll' : `${fmtCount(extrusionRolls)} Rolls`
  }
  return ''
}

/**
 * Ordered quantity for the print header summary — always in product-type units
 * (e.g. `400 Bags`), not cartons (`20 Ctn`); carton count stays in the roll/ctn segment.
 */
export function jobSheetOrderQuantityForPrintHeader(
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
): string {
  const payload = jobSheetAsQuoteQtyPayload(js, spec)
  const mode = quoteQtyModeFromPayload(payload)
  const productType = String(payload.product_type ?? payload.productType ?? '')

  if (mode === 'kg' || mode === 'roll') {
    return formatOrderQuantityForPrintHeader(quoteTotalQuantityLabelFromPayload(payload))
  }

  const isContinuous = quotePayloadUsesContinuousLength(payload)
  const unitLabel = quoteProductUnitLabel(productType)
  const numUnits = Math.round(Number(payload.numUnits ?? payload.num_units ?? 0))
  const numCartons = Math.round(Number(payload.numCartons ?? payload.num_cartons ?? 0))
  const bagsPerCarton = Math.max(0, Math.round(Number(payload.bags_per_carton ?? payload.bagsPerCarton ?? 0)))
  const productCount = resolvedProductUnitsForOrder(numUnits, numCartons, bagsPerCarton)

  if (productCount > 0) {
    if (isContinuous) return `${fmtCount(productCount)} ea`
    return `${fmtCount(productCount)} ${unitLabel}`
  }

  return formatOrderQuantityForPrintHeader(quoteTotalQuantityLabelFromPayload(payload))
}

/**
 * One-line job sheet print header summary:
 * `{Bag on Roll}, {10000 Bags}, {200 bags/roll}, {12 Rolls}` (omits empty segments).
 */
export function buildJobSheetPrintHeaderSummaryLine(
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
  geoDerived?: JobSheetPrintHeaderGeoSnapshot | null,
  opts?: { extrusionRollCount?: number | null },
): string {
  const parts: string[] = []

  const typeFinish = productTypeFinishLabelFromSpec(spec)
  if (typeFinish) parts.push(typeFinish)

  const orderFmt = jobSheetOrderQuantityForPrintHeader(js, spec)
  if (orderFmt) parts.push(orderFmt)

  const packTail = packagingPerUnitTailFromPersistedJobSheet(js, spec, geoDerived ?? null)
  const packFmt = formatPackagingPerUnitForPrintHeader(packTail)
  if (packFmt) parts.push(packFmt)

  const rollCtn = jobSheetRollCartonCountLabel(js, spec, opts?.extrusionRollCount)
  if (rollCtn) parts.push(rollCtn)

  return parts.join('. ')
}

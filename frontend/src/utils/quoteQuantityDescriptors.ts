import type { SpecPayload } from '../components/SpecPayloadForm'
import { buildSpecQuantitySliceFromPersistedJobSheet } from './jobSheetQuantityFromApi'
import { fmtCount, fmtQtyNumber } from './quoteFormat'

/** 2 d.p. kg string for roll weights (matches QuotesPage `formatKgDisplay`). */
export function formatQuoteKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

/** Plural product-unit label for CTN / job qty lines (matches QuotesPage email table). */
export function quoteProductUnitLabel(productType: string): string {
  const pt = String(productType || '').trim()
  if (!pt) return 'Units'
  if (pt === 'Bag') return 'Bags'
  if (pt === 'U-Film') return 'U-Films'
  if (pt === 'J-Film') return 'J-Films'
  return `${pt}s`
}

export function quotePayloadUsesContinuousLength(p: Record<string, unknown>): boolean {
  const pt = String(p.product_type ?? p.productType ?? '')
  if (pt === 'Tube') return true
  if (p.continuous_roll) return true
  const lu = String(p.length_units ?? p.lengthUnits ?? '').toLowerCase()
  return lu === 'continuous'
}

export type QuoteQtyMode = 'units' | 'kg' | 'roll' | 'ctn'

/** Same basis as Live Quote `qtyMode` (kg / units / roll / ctn). */
export function quoteQtyModeFromPayload(p: Record<string, unknown>): QuoteQtyMode {
  const qtyType = String(p.qtyType ?? p.qty_type ?? '').trim()
  const finish = String(p.finish_mode ?? p.finishMode ?? 'Rolls').trim()
  const cartonQtyMode = String(p.cartonQtyMode ?? p.carton_qty_mode ?? '').trim()
  if (qtyType === 'units') {
    if (finish === 'Cartons' && cartonQtyMode === 'ctn') return 'ctn'
    return 'units'
  }
  if (qtyType === 'kg') return 'kg'
  return 'roll'
}

export type QuotePackagingPerUnitTailParams = {
  finishMode: 'Rolls' | 'Cartons'
  productType: string
  bagsPerCarton: number
  isContinuousLength: boolean
  metersPerRoll: number
  weightPerRollKg: number
  /** When continuous M/roll is not stored, derive from web length ÷ rolls (saved payload or live calc). */
  quantityTotalM?: number
  quantityRolls?: number
  /**
   * When set (Live Quote / job sheet paths), roll tails follow qty type: continuous → `…m/ROLL.`,
   * kg → `…kg/ROLL.`, roll / units (1000) on discrete length → `…/ROLL.`.
   * When omitted, discrete rolls fall back to kg-only (legacy list rows).
   */
  qtyMode?: QuoteQtyMode
  /** Discrete rolls: products (e.g. bags) per roll when {@link qtyMode} is `roll` or `units`. */
  unitsPerRoll?: number
}

/**
 * Pack-size fragment appended to the product description in the email / list row
 * (e.g. `600m/ROLL.`, `500/ROLL.`, `25.00kg/ROLL.`, `300 Bags/CTN.`).
 */
export function quotePackagingPerUnitTail(params: QuotePackagingPerUnitTailParams): string {
  const {
    finishMode,
    productType,
    bagsPerCarton,
    isContinuousLength,
    metersPerRoll,
    weightPerRollKg,
    quantityTotalM = 0,
    quantityRolls = 0,
    qtyMode,
    unitsPerRoll: unitsPerRollIn,
  } = params
  const label = quoteProductUnitLabel(productType)
  if (finishMode === 'Cartons' && Number.isFinite(bagsPerCarton) && bagsPerCarton > 0) {
    return `${fmtCount(bagsPerCarton)} ${label}/CTN.`
  }
  if (finishMode === 'Rolls') {
    let mpr = Number(metersPerRoll) || 0
    if (!(mpr > 0) && isContinuousLength) {
      const t = Number(quantityTotalM)
      const r = Number(quantityRolls)
      if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r > 0) mpr = t / r
    }
    if (isContinuousLength && mpr > 0) {
      return `${fmtQtyNumber(mpr, 0)}m/ROLL.`
    }

    const uprRaw = Number(unitsPerRollIn ?? 0)
    const unitsPerRoll =
      Number.isFinite(uprRaw) && uprRaw > 0 ? Math.max(1, Math.round(uprRaw)) : 0

    if (qtyMode === 'kg' && weightPerRollKg > 0) {
      return `${formatQuoteKgDisplay(weightPerRollKg)}kg/ROLL.`
    }
    if (qtyMode === 'roll' || qtyMode === 'units') {
      if (unitsPerRoll > 0) return `${fmtCount(unitsPerRoll)}/ROLL.`
      return ''
    }

    if (qtyMode == null && weightPerRollKg > 0) {
      return `${formatQuoteKgDisplay(weightPerRollKg)}kg/ROLL.`
    }
  }
  return ''
}

/** Join base description + packaging tail (same rule as Live Quote email row). */
export function joinQuoteDescriptionWithPackagingTail(baseDescription: string, tail: string): string {
  const base = (baseDescription || '').replace(/\|/g, '·').replace(/\r?\n/g, ' ').trim()
  const t = (tail || '').trim()
  if (!t) return base || '—'
  if (!base || base === '—') return t
  const gap = base.length > 0 && !/[.!?:]\s*$/.test(base) ? '. ' : ' '
  return `${base}${gap}${t}`
}

function parsePositiveKgLoose(v: unknown): number {
  if (v == null) return 0
  const s = String(v).trim().replace(/,/g, '.')
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** {@link quotePackagingPerUnitTail} from a flat saved quote payload (camelCase or snake_case fields). */
export function quotePackagingPerUnitTailFromPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload
  const finishRaw = String(p.finish_mode ?? p.finishMode ?? 'Rolls').trim()
  const finishMode: 'Rolls' | 'Cartons' = finishRaw === 'Cartons' ? 'Cartons' : 'Rolls'
  const productType = String(p.product_type ?? p.productType ?? '')
  const bagsRaw = p.bags_per_carton ?? p.bagsPerCarton
  const bagsPerCarton = Math.max(0, Math.round(Number(bagsRaw)))
  const isContinuous = quotePayloadUsesContinuousLength(p)
  const metersPerRoll = Number(p.meters_per_roll ?? p.metersPerRoll ?? 0)
  const weightPerRollKg = parsePositiveKgLoose(p.weight_per_roll_kg ?? p.weightPerRoll)
  const qty = (p.quantity as Record<string, unknown> | undefined) || {}
  const quantityTotalM = Number(qty.total_m ?? 0)
  const quantityRolls = Number(qty.rolls ?? 0)
  const qtyMode = quoteQtyModeFromPayload(p)
  const numRolls = Math.max(
    0,
    Math.round(
      Number(
        p.numRolls ?? p.num_rolls ?? (p.quantity as Record<string, unknown> | undefined)?.rolls ?? 0,
      ),
    ),
  )
  const numUnits = Math.max(
    0,
    Math.round(
      Number(
        p.numUnits ?? p.num_units ?? (p.quantity as Record<string, unknown> | undefined)?.units ?? 0,
      ),
    ),
  )
  let unitsPerRoll = Math.max(
    0,
    Math.round(Number((p as { units_per_roll?: unknown }).units_per_roll ?? p.unitsPerRoll ?? 0)),
  )
  if (unitsPerRoll <= 0 && numRolls > 0 && numUnits > 0 && (qtyMode === 'roll' || qtyMode === 'units')) {
    unitsPerRoll = Math.max(1, Math.round(numUnits / numRolls))
  }
  return quotePackagingPerUnitTail({
    finishMode,
    productType,
    bagsPerCarton,
    isContinuousLength: isContinuous,
    metersPerRoll,
    weightPerRollKg,
    quantityTotalM,
    quantityRolls,
    qtyMode,
    unitsPerRoll,
  })
}

/**
 * One-line job quantity for lists (e.g. `50 ROLLS`, `40,000 bags`, `8 CTN`, `99.00 KG`).
 */
export function quoteTotalQuantityLabelFromPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '—'
  const p = payload
  const mode = quoteQtyModeFromPayload(p)
  const productType = String(p.product_type ?? p.productType ?? '')
  const label = quoteProductUnitLabel(productType)
  const isContinuous = quotePayloadUsesContinuousLength(p)
  const qty = (p.quantity as Record<string, unknown> | undefined) || {}
  const totalKg = Number(p.totalKg ?? p.total_kg ?? qty.total_kg ?? 0)
  const quotedKg = Number(p.quoted_totals_kg ?? 0)
  const numUnits = Math.round(Number(p.numUnits ?? p.num_units ?? qty.units ?? 0))
  let numRolls = Math.round(Number(p.numRolls ?? p.num_rolls ?? qty.rolls ?? 0))
  let numCartons = Math.round(Number(p.numCartons ?? p.num_cartons ?? 0))
  const bagsPerCarton = Math.max(0, Math.round(Number(p.bags_per_carton ?? p.bagsPerCarton ?? 0)))

  if (mode === 'kg') {
    const kg = totalKg > 0 ? totalKg : quotedKg > 0 ? quotedKg : 0
    if (kg > 0) return `${fmtQtyNumber(kg, 2)} KG`
    return '—'
  }
  if (mode === 'units' && numUnits > 0) {
    if (isContinuous) return `${fmtCount(Math.round(numUnits))} ea`
    return `${fmtCount(Math.round(numUnits))} ${label.toLowerCase()}`
  }
  if (mode === 'roll') {
    if (!(numRolls > 0) && numUnits > 0 && isContinuous) numRolls = numUnits
    if (numRolls > 0) {
      const word = numRolls === 1 ? 'ROLL' : 'ROLLS'
      return `${fmtCount(numRolls)} ${word}`
    }
    return '—'
  }
  if (mode === 'ctn') {
    if (!(numCartons > 0) && numUnits > 0 && bagsPerCarton > 0) {
      numCartons = Math.ceil(numUnits / bagsPerCarton)
    }
    if (numCartons > 0) return `${fmtCount(numCartons)} CTN`
    return '—'
  }
  return '—'
}

/**
 * Build a quote-style qty payload from persisted job sheet API rows + spec (for shared quantity labels / tails).
 */
export function jobSheetAsQuoteQtyPayload(
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
): Record<string, unknown> {
  const identity = (spec as { identity?: Record<string, unknown> }).identity || {}
  const packaging = (spec as { packaging?: Record<string, unknown> }).packaging || {}
  const dimensions = (spec as { dimensions?: Record<string, unknown> }).dimensions || {}
  const finish = String(identity.finish_mode || 'Rolls').trim()
  const qtyType = String(js.qty_type || 'kg').trim()
  const qu = String(js.quantity_unit || '').toLowerCase()
  const cartonQtyMode = finish === 'Cartons' && qtyType === 'units' && qu === 'cartons' ? 'ctn' : '1000'
  const pt = String(identity.product_type || '')
  const lu = String(dimensions.length_units || '').toLowerCase()
  const continuous_roll = pt === 'Tube' || lu === 'continuous'
  const qv = Number(js.quantity_value || 0)
  const npuRaw = js.num_product_units
  const npu = npuRaw != null && npuRaw !== '' ? Number(npuRaw) : NaN

  let numUnits = 0
  if (qtyType === 'units') {
    if (qu === 'cartons' && Number.isFinite(npu)) numUnits = Math.round(npu)
    else if (Number.isFinite(npu)) numUnits = Math.round(npu)
    else numUnits = Math.round(qv)
  } else if (Number.isFinite(npu)) {
    numUnits = Math.round(npu)
  }

  const numRolls = Math.max(0, Math.round(Number(js.num_rolls || 0)))
  const numCartons = qtyType === 'units' && qu === 'cartons' && qv > 0 ? Math.round(qv) : 0
  const bagsPerCarton = Math.max(0, Math.round(Number(packaging.bags_per_carton || 0)))

  let totalKg = 0
  if (qu === 'kg') totalKg = qv
  else if (js.total_kg != null && Number(js.total_kg) > 0) totalKg = Number(js.total_kg)

  return {
    qty_type: qtyType,
    qtyType,
    finish_mode: finish,
    finishMode: finish,
    carton_qty_mode: cartonQtyMode,
    cartonQtyMode,
    product_type: pt,
    productType: pt,
    continuous_roll,
    length_units: dimensions.length_units,
    total_kg: totalKg,
    totalKg,
    num_units: numUnits,
    numUnits,
    num_rolls: numRolls,
    numRolls,
    num_cartons: numCartons,
    numCartons,
    bags_per_carton: bagsPerCarton,
    bagsPerCarton,
    quoted_totals_kg: 0,
    quantity: {
      total_kg: totalKg,
      units: numUnits,
      rolls: numRolls,
    },
  }
}

/** One-line ordered quantity for job sheets / print (same basis as {@link quoteTotalQuantityLabelFromPayload}). */
export function jobSheetOrderQuantityLabel(js: Record<string, unknown>, spec: Record<string, unknown>): string {
  return quoteTotalQuantityLabelFromPayload(jobSheetAsQuoteQtyPayload(js, spec))
}

/** {@link quotePackagingPerUnitTail} from persisted job sheet + spec + optional geometry snapshot from ratebook calc. */
export function packagingPerUnitTailFromPersistedJobSheet(
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
  geoDerived: { derivedTotalM: number; mPerRoll: number | null } | null,
): string {
  const identity = (spec as { identity?: Record<string, unknown> }).identity || {}
  const packaging = (spec as { packaging?: Record<string, unknown> }).packaging || {}
  const dimensions = (spec as { dimensions?: Record<string, unknown> }).dimensions || {}
  const finishMode = String(identity.finish_mode || 'Rolls').trim() === 'Cartons' ? 'Cartons' : 'Rolls'
  const productType = String(identity.product_type || '')
  const bagsPerCarton = Math.max(0, Math.round(Number(packaging.bags_per_carton || 0)))
  const lu = String(dimensions.length_units || '').toLowerCase()
  const isContinuousLength = productType === 'Tube' || lu === 'continuous'
  const weightPerRollKg = Number(js.weight_per_roll_kg || 0)
  const metersPerRoll =
    geoDerived?.mPerRoll != null && Number(geoDerived.mPerRoll) > 0 ? Number(geoDerived.mPerRoll) : 0
  let quantityTotalM = 0
  if (geoDerived != null && geoDerived.derivedTotalM > 0 && Number.isFinite(geoDerived.derivedTotalM)) {
    quantityTotalM = Number(geoDerived.derivedTotalM)
  } else if (js.total_m != null && Number(js.total_m) > 0) {
    quantityTotalM = Number(js.total_m)
  }
  const quantityRolls = Math.max(0, Math.round(Number(js.num_rolls || 0)))

  const slice = buildSpecQuantitySliceFromPersistedJobSheet(js, spec as SpecPayload)
  const qt = slice.qtyType
  const qtyMode: QuoteQtyMode = qt === 'kg' ? 'kg' : qt === 'units' ? 'units' : 'roll'

  let unitsPerRoll =
    slice.unitsPerRoll != null && Number(slice.unitsPerRoll) > 0
      ? Math.max(1, Math.round(Number(slice.unitsPerRoll)))
      : 0
  const npu = js.num_product_units != null ? Number(js.num_product_units) : NaN
  if (unitsPerRoll <= 0 && Number.isFinite(npu) && npu > 0 && quantityRolls > 0) {
    unitsPerRoll = Math.max(1, Math.round(npu / quantityRolls))
  }

  return quotePackagingPerUnitTail({
    finishMode,
    productType,
    bagsPerCarton,
    isContinuousLength,
    metersPerRoll,
    weightPerRollKg,
    quantityTotalM,
    quantityRolls,
    qtyMode,
    unitsPerRoll,
  })
}

/** Product description + packaging tail (matches Live Quote description rule). */
export function jobSheetDescriptionWithPackagingTail(
  baseDescription: string,
  js: Record<string, unknown>,
  spec: Record<string, unknown>,
  geoDerived: { derivedTotalM: number; mPerRoll: number | null } | null,
): string {
  const tail = packagingPerUnitTailFromPersistedJobSheet(js, spec, geoDerived)
  return joinQuoteDescriptionWithPackagingTail(baseDescription, tail)
}

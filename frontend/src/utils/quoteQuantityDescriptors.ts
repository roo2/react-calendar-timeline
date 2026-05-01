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
}

/**
 * Pack-size fragment appended to the product description in the email / list row
 * (e.g. `400M/ROLL.`, `300 Bags/CTN.`, `20.00kg/ROLL.`).
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
  } = params
  const label = quoteProductUnitLabel(productType)
  if (finishMode === 'Cartons' && Number.isFinite(bagsPerCarton) && bagsPerCarton > 0) {
    return `${fmtCount(bagsPerCarton)} ${label}/CTN.`
  }
  if (finishMode === 'Rolls') {
    let mpr = metersPerRoll
    if (!(mpr > 0) && isContinuousLength) {
      const t = Number(quantityTotalM)
      const r = Number(quantityRolls)
      if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r > 0) mpr = t / r
    }
    if (isContinuousLength && mpr > 0) {
      return `${fmtQtyNumber(mpr, 0)}M/ROLL.`
    }
    if (weightPerRollKg > 0) {
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
  return quotePackagingPerUnitTail({
    finishMode,
    productType,
    bagsPerCarton,
    isContinuousLength: isContinuous,
    metersPerRoll,
    weightPerRollKg,
    quantityTotalM,
    quantityRolls,
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

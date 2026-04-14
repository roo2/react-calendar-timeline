export function fmtDollars(v: unknown, dp: number = 2): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `$${n.toFixed(dp)}`
}

/** en-US grouping + fixed decimals (for quote preview and similar). */
export function fmtQtyNumber(n: number, fractionDigits: number): string {
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/** Whole numbers with thousands separators (cartons, pallets, counts). */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Math.round(n).toLocaleString('en-US')
}

export function fmtDollarsPreview(v: unknown, dp: number = 2): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `$${fmtQtyNumber(n, dp)}`
}

/** Like {@link fmtDollarsPreview} but shows an em dash for zero (quote line items). */
export function fmtDollarsLineItem(v: unknown, dp: number = 2): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n === 0 || Object.is(n, -0)) return '—'
  return fmtDollarsPreview(n, dp)
}

export function fmtHoursMinutes(vMinutes: unknown): string {
  const n = Number(vMinutes)
  if (!Number.isFinite(n)) return String(vMinutes ?? '')
  const total = Math.max(0, Math.round(n))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}hr`
  return `${h}hr ${m}min`
}

/** Like fmtHoursMinutes but hour/minute components use thousands separators. */
export function fmtHoursMinutesPreview(vMinutes: unknown): string {
  const n = Number(vMinutes)
  if (!Number.isFinite(n)) return String(vMinutes ?? '')
  const total = Math.max(0, Math.round(n))
  const h = Math.floor(total / 60)
  const m = total % 60
  const hs = h.toLocaleString('en-US')
  const ms = m.toLocaleString('en-US')
  if (h === 0) return `${ms}min`
  if (m === 0) return `${hs}hr`
  return `${hs}hr ${ms}min`
}

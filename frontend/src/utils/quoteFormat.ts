export function fmtDollars(v: unknown, dp: number = 2): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `$${n.toFixed(dp)}`
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

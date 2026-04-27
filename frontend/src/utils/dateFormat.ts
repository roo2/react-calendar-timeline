export function formatDateDMYShort(raw: string | Date | null | undefined, fallback = '—'): string {
  if (raw == null) return fallback
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fallback
    const d = raw.getDate()
    const m = raw.getMonth() + 1
    const yy = raw.getFullYear() % 100
    return `${d}/${m}/${yy}`
  }

  const s = String(raw).trim()
  if (!s) return fallback
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const yy = Number(m[1]) % 100
    const mm = Number(m[2])
    const dd = Number(m[3])
    return `${dd}/${mm}/${yy}`
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return fallback
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() % 100}`
}

export function formatDateTimeDMYShort(raw: string | Date | null | undefined, fallback = '—'): string {
  if (raw == null) return fallback
  const d = raw instanceof Date ? raw : new Date(String(raw))
  if (Number.isNaN(d.getTime())) return fallback
  const date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() % 100}`
  const hh = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${date} ${hh}:${mm}`
}

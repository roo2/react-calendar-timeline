/** Parse API datetimes as UTC when no timezone is present; use browser local time for display. */
export function parseApiDateTime(raw: string | Date | null | undefined): Date | null {
  if (raw == null) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  let s = String(raw).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) {
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
  }
  const hasTz = /[zZ]$|[+-]\d{2}:\d{2}$/.test(s)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !hasTz) {
    s = `${s}Z`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

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
  const d = parseApiDateTime(raw)
  if (!d) return fallback
  const date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() % 100}`
  const hh = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${date} ${hh}:${mm}`
}

/** Local timezone: DD/MM/YY HH:mm:ss (e.g. 19/05/26 14:30:45). */
export function formatDateTimeDMYShortSeconds(
  raw: string | Date | null | undefined,
  fallback = '—',
): string {
  if (raw == null) return fallback
  const d = parseApiDateTime(raw)
  if (!d) return fallback
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${min}:${sec}`
}

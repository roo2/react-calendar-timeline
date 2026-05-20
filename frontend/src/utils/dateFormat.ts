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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Calendar date in local style: DD/MM/YY (e.g. 13/06/26). */
export function formatDateDMYShort(raw: string | Date | null | undefined, fallback = '—'): string {
  if (raw == null) return fallback
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fallback
    return `${pad2(raw.getDate())}/${pad2(raw.getMonth() + 1)}/${pad2(raw.getFullYear() % 100)}`
  }

  const s = String(raw).trim()
  if (!s) return fallback
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dateOnly && !/T\d{2}:\d{2}/.test(s)) {
    const yy = Number(dateOnly[1]) % 100
    return `${dateOnly[3]}/${dateOnly[2]}/${pad2(yy)}`
  }

  const d = parseApiDateTime(raw)
  if (!d) return fallback
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${pad2(d.getFullYear() % 100)}`
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

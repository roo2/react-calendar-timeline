/** Internal placeholder `Product` row for MYOB import–linked draft job sheets. */
const MYOB_IMPORT_PLACEHOLDER_DESC_RE = /^placeholder for myob import draft job sheets$/i

export function hideMyobProductPlaceholderText(s: string | null | undefined): string {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return MYOB_IMPORT_PLACEHOLDER_DESC_RE.test(t) ? '' : t
}

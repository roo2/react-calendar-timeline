export type SxProps = Record<string, unknown>

function norm(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  return String(v).trim()
}

/**
 * Generic "default row" detector for table-based forms.
 * When a row matches the provided default row (after light normalization),
 * callers can render it with a subtle tinted background to signal "unchanged".
 */
export function isDefaultRow<T extends Record<string, unknown>>(row: T, defaults: T): boolean {
  const keys = new Set([...Object.keys(row), ...Object.keys(defaults)])
  for (const k of keys) {
    if (norm(row[k]) !== norm(defaults[k])) return false
  }
  return true
}

export function defaultRowSx(isDefault: boolean): SxProps {
  // Apply to cells for consistent visuals across MUI table variants.
  return isDefault ? { '& td': { bgcolor: '#FFFDE7' } } : {}
}


/** Spec `quality.flags` ids → labels shown on job sheet print / preview. */
export const QUALITY_FLAG_LABELS: Record<string, string> = {
  tight_gauge: 'Tight Gauge Tolerance',
  seal_integrity: 'Watertight Seals Critical',
  cosmetic: 'Printing Quality',
  colour: 'Colour Critical',
  food_contact: 'Food Contact',
}

const RETIRED_QUALITY_FLAG_IDS = new Set(['medical', 'chemical_industrial', 'non_food'])

/** Quality flag ids for print/preview, including legacy `identity.industry_flags` food_contact. */
export function collectQualityFlagIds(spec: {
  quality_expectations?: { flags?: unknown; known_issues?: unknown } | null
  identity?: { industry_flags?: unknown } | null
  quality_checks?: unknown
} | null | undefined): string[] {
  if (!spec) return []
  const ids = new Set<string>()
  const qFlags = spec.quality_expectations?.flags
  if (Array.isArray(qFlags)) {
    for (const x of qFlags) {
      const id = String(x ?? '').trim()
      if (id && !RETIRED_QUALITY_FLAG_IDS.has(id)) ids.add(id)
    }
  }
  const legacy = spec.quality_checks
  if (Array.isArray(legacy)) {
    for (const x of legacy) {
      const id = String(x ?? '').trim()
      if (id && !RETIRED_QUALITY_FLAG_IDS.has(id)) ids.add(id)
    }
  }
  const industry = spec.identity?.industry_flags
  if (Array.isArray(industry) && industry.includes('food_contact')) ids.add('food_contact')
  return Array.from(ids)
}

export function formatQualityFlagLabel(idOrLabel: string): string {
  const key = String(idOrLabel ?? '').trim()
  if (!key) return ''
  const mapped = QUALITY_FLAG_LABELS[key]
  if (mapped) return mapped
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Flag labels plus free-text `quality_expectations.known_issues` for job sheet print / preview tags. */
export function buildJobSheetPrintQualityCheckLabels(
  spec: Parameters<typeof collectQualityFlagIds>[0],
): string[] {
  const labels = collectQualityFlagIds(spec).map(formatQualityFlagLabel).filter(Boolean)
  const other = String(spec?.quality_expectations?.known_issues ?? '').trim()
  if (other) labels.push(other)
  return labels
}

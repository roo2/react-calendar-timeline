/**
 * Numeric run-up factor from `run_requirements.run_up` (Centerfold / Sheet),
 * used for layflat = width × (factor / 2). Kept in sync with SpecPayloadForm defaults/slugs.
 */
export function runUpNumericalFromSlug(
  runUpSlug: string | undefined | null,
  productType: string | undefined | null,
): number {
  const slug = String(runUpSlug ?? 'none').trim().toLowerCase()
  if (slug === '1up') return 1
  if (slug === '2up') return 2
  if (slug === '4up') return 4
  if (slug === '6up') return 6
  const pt = String(productType ?? '').trim()
  if (pt === 'Centerfold') return 1
  if (pt === 'Sheet') return 2
  return 1
}

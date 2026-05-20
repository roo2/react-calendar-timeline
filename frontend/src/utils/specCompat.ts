export function productTypeCanHaveGusset(productType: string): boolean {
  // Match SpecPayloadForm.tsx logic: only Bag and Tube can have gussets.
  return productType === 'Bag' || productType === 'Tube'
}

/**
 * Inline bottom seal is implied for bags on rolls (not a persisted toggle).
 * Matches production assumptions used on the job sheet printout.
 */
export function derivedInlineSeal(productType: string | undefined | null, finishMode: string | undefined | null): boolean {
  const pt = String(productType ?? '').trim()
  const fm = String(finishMode ?? '').trim()
  return pt === 'Bag' && fm === 'Rolls'
}

/** User-facing label for `run_requirements.seal_type` / `printing.seal_type` slug (`end` → Bottom). */
export function formatSealTypeLabel(slug: unknown, opts?: { full?: boolean }): string {
  const x = String(slug ?? '').trim().toLowerCase()
  if (x === '') return ''
  if (x === 'side') return opts?.full ? 'Side Seal' : 'Side'
  if (x === 'end') return opts?.full ? 'Bottom Seal' : 'Bottom'
  if (x === 'none') return 'None'
  return String(slug ?? '').trim()
}


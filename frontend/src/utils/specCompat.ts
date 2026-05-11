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


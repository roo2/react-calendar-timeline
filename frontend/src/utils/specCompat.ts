export function productTypeCanHaveGusset(productType: string): boolean {
  // Match SpecPayloadForm.tsx logic: only Bag and Tube can have gussets.
  return productType === 'Bag' || productType === 'Tube'
}


/** When false, “Save as new product” stays visible but disabled (first product version / first job sheet revision). */
export function canEnableSaveAsNewProduct(opts: {
  productVersionCount?: number
  editingVersionNumber?: number | null
  jobSheetVersionNumber?: number | null
  /** True on `/products/:id/versions/new` — user is adding a version after the initial one. */
  isAddingProductVersion?: boolean
}): boolean {
  const count = opts.productVersionCount ?? 0
  if (opts.isAddingProductVersion) return count >= 1
  const jobV = opts.jobSheetVersionNumber
  if (jobV != null && jobV > 0) return jobV >= 2
  const editV = opts.editingVersionNumber
  if (editV != null && editV >= 2) return true
  return count >= 2
}

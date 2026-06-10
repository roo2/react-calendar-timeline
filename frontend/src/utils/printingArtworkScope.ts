import type { PrintingArtworkScope } from '../components/PrintingArtworkUploadSection'
import { EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID } from '../pages/products/components/ProductVersionEditor'

/** Artwork PDFs are stored on the product's active version (shared across job sheets). */
export function resolvePrintingArtworkScope(opts: {
  embedded?: boolean
  jobSheetId?: string | null
  productId?: string | null
  jobSheetProductId?: string | null
  versionId?: string | null
  activeVersionId?: string | null
}): PrintingArtworkScope | null {
  if (opts.embedded) return null

  let pid = String(opts.productId || '').trim()
  if (opts.jobSheetId) {
    const fromJob = String(opts.jobSheetProductId || '').trim()
    if (fromJob) pid = fromJob
  }
  if (!pid || pid === EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID) return null

  if (opts.jobSheetId) {
    const activeVid = String(opts.activeVersionId || '').trim()
    return activeVid ? { kind: 'product_version', productId: pid, versionId: activeVid } : null
  }

  const vid = String(opts.versionId || opts.activeVersionId || '').trim()
  return vid ? { kind: 'product_version', productId: pid, versionId: vid } : null
}

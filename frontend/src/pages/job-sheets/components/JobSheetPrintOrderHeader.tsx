import type { ReactElement } from 'react'
import type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'
import { JobSheetPrintOrderHeaderFields } from './JobSheetPrintOrderHeaderFields'

export type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'

const CUSTOMER_NAME_PRINT_TITLE_MAX = 14

function dash(v: string): string {
  const t = String(v ?? '').trim()
  return t === '' ? '—' : t
}

/** Customer name truncated for the print title line (max 14 characters). */
export function truncateCustomerNameForPrintTitle(
  name: string,
  maxLen = CUSTOMER_NAME_PRINT_TITLE_MAX,
): string {
  const t = String(name ?? '').trim()
  if (!t) return '—'
  return t.length <= maxLen ? t : t.slice(0, maxLen)
}

export function buildJobSheetPrintTitleParts(
  header: JobSheetPrintOrderHeaderModel['header'],
  product: JobSheetPrintOrderHeaderModel['product'],
): { jobCode: string; customer: string; productCode: string } {
  return {
    jobCode: dash(String(header.jobCode ?? '')),
    customer: truncateCustomerNameForPrintTitle(String(header.customer ?? '')),
    productCode: dash(String(product.generatedProductCode ?? '')),
  }
}

/** Plain-text title for continuation headers: `Job * Customer * Product`. */
export function formatJobSheetPrintPageTitle(
  header: JobSheetPrintOrderHeaderModel['header'],
  product: JobSheetPrintOrderHeaderModel['product'],
): string {
  const p = buildJobSheetPrintTitleParts(header, product)
  return `${p.jobCode} * ${p.customer} * ${p.productCode}`
}

export function JobSheetPrintPageTitle(props: {
  header: JobSheetPrintOrderHeaderModel['header']
  product: JobSheetPrintOrderHeaderModel['product']
  className?: string
}): ReactElement {
  const { header, product, className } = props
  const p = buildJobSheetPrintTitleParts(header, product)
  return (
    <div className={className}>
      <span className="js-title-part js-title-part--job">{p.jobCode}</span>
      <span className="js-title-sep" aria-hidden="true">
      •
      </span>
      <span className="js-title-part js-title-part--customer">{p.customer}</span>
      <span className="js-title-sep" aria-hidden="true">
      •
      </span>
      <span className="js-title-part js-title-part--product">{p.productCode}</span>
    </div>
  )
}

/**
 * Repeated at the top of each printed sheet (main job sheet + Uteco printing page).
 */
export function JobSheetPrintOrderHeader(props: JobSheetPrintOrderHeaderModel): ReactElement {
  const { perforated, header, product, printingFooter } = props
  const titleClass = `js-title js-title--spread${perforated ? ' js-perf-hl' : ''}`
  return (
    <>
      <JobSheetPrintPageTitle header={header} product={product} className={titleClass} />
      <JobSheetPrintOrderHeaderFields variant="print" header={header} product={product} printingFooter={printingFooter} />
    </>
  )
}

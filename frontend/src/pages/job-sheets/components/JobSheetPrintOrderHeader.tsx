import type { ReactElement } from 'react'
import type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'
import { JobSheetPrintOrderHeaderFields } from './JobSheetPrintOrderHeaderFields'

export type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'

/** `{customer} - {jobCode}` for print sheet titles and continuation headers. */
export function formatJobSheetPrintPageTitle(header: JobSheetPrintOrderHeaderModel['header']): string {
  return (
    [String(header.customer ?? '').trim(), String(header.jobCode ?? '').trim()].filter(Boolean).join(' - ') || '—'
  )
}

/**
 * Repeated at the top of each printed sheet (main job sheet + Uteco printing page).
 */
export function JobSheetPrintOrderHeader(props: JobSheetPrintOrderHeaderModel): ReactElement {
  const { perforated, header, product, printingFooter } = props
  const pageTitle = formatJobSheetPrintPageTitle(header)
  return (
    <>
      <div className={`js-title${perforated ? ' js-perf-hl' : ''}`}>
        {pageTitle}
      </div>
      <JobSheetPrintOrderHeaderFields variant="print" header={header} product={product} printingFooter={printingFooter} />
    </>
  )
}

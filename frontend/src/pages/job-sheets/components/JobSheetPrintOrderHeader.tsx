import type { ReactElement } from 'react'
import type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'
import { JobSheetPrintOrderHeaderFields } from './JobSheetPrintOrderHeaderFields'

export type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'

/**
 * Repeated at the top of each printed sheet (main job sheet + Uteco printing page).
 */
export function JobSheetPrintOrderHeader(props: JobSheetPrintOrderHeaderModel): ReactElement {
  const { titleLine, perforated, header, product, printingFooter } = props
  return (
    <>
      <div className={`js-title${perforated ? ' js-perf-hl' : ''}`}>
        {titleLine} — {header.jobCode}
      </div>
      <JobSheetPrintOrderHeaderFields variant="print" header={header} product={product} printingFooter={printingFooter} />
    </>
  )
}

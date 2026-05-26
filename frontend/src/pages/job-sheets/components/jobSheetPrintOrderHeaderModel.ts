import type { InlinePerforatedHighlight } from '../../../utils/specCompat'

/** Job sheet title bar background when inline perforated. */
export type JobSheetPrintTitleHighlight = InlinePerforatedHighlight

export type JobSheetPrintOrderHeaderModel = {
  /** `blue`: perforated film (not bag-on-roll seal); `yellow`: perforated bag on roll. */
  titleHighlight: JobSheetPrintTitleHighlight
  header: {
    /** Page title: customer (truncated) and job code (not shown in the field grid). */
    customer: string
    jobCode: string
    orderDate: string
    dueDate: string
  }
  product: {
    /** Algorithmic product code from spec (shown in the page title). */
    generatedProductCode: string
    /** Long-form product + finish for the title row (e.g. `Bag on Roll`). */
    productFinishLabel: string
    /** One-line summary: type/finish code, order qty, packing, roll/ctn count. */
    summaryLine: string
    notes: string
    /** Display labels for quality tags (flags + other QC notes). */
    qualityChecks: string[]
  }
  /** Printing-details sheet: description + optional barcode. */
  printingFooter?: {
    printDescription: string
    barcode?: string
  } | null
}

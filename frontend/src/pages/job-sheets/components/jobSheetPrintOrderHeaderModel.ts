export type JobSheetPrintOrderHeaderModel = {
  perforated: boolean
  header: {
    /** Page title with job code (not shown in the field grid). */
    customer: string
    jobCode: string
    invoiceNo: string
    orderDate: string
    purchaseOrderNo: string
    dueDate: string
  }
  product: {
    /** Customer-facing description (with packaging tail when applicable). */
    customerFacingDescription?: string
    generatedDescriptionWithPackagingTail: string
    orderedQuantityLabel: string
    notes: string
    /** Quality flag ids from spec (`quality.flags`). */
    qualityChecks: string[]
  }
  /** Printing-details sheet: description + optional barcode. */
  printingFooter?: {
    printDescription: string
    barcode?: string
  } | null
}

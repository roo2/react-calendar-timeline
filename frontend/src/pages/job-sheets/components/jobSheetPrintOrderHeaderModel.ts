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
    /** Algorithmic product code from spec (primary header line on print). */
    generatedProductCode: string
    /** Customer-facing description (with packaging tail when applicable; secondary line). */
    customerFacingDescription?: string
    /** Generated description with packaging tail; shown on secondary line when customer description is unset. */
    generatedDescriptionWithPackagingTail?: string
    orderedQuantityLabel: string
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

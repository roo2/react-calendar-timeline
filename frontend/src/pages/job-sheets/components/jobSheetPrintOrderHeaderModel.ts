export type JobSheetPrintOrderHeaderModel = {
  titleLine: string
  perforated: boolean
  header: {
    customer: string
    invoiceNo: string
    jobCode: string
    orderDate: string
    purchaseOrderNo: string
    dueDate: string
  }
  product: {
    /** Saved / display product code (primary when no customer-facing override). */
    productCode: string
    /**
     * Spec algorithmic code (e.g. PBR-…); shown lighter when {@link customerFacingProductCode} is set.
     */
    generatedProductCode?: string
    /** `identity.customer_code` when set; shown as the primary/heavier code line. */
    customerFacingProductCode?: string
    /**
     * Generated description + packaging tail (lighter when {@link customerFacingDescriptionWithPackagingTail} is set).
     */
    generatedDescriptionWithPackagingTail: string
    /** Customer-facing description + same packaging tail rule, when set (heavier in print). */
    customerFacingDescriptionWithPackagingTail?: string
    /**
     * Back-compat: same as generated + tail when no customer-facing description; otherwise the customer-facing line.
     */
    descriptionWithPackagingTail: string
    orderedQuantityLabel: string
    notes: string
    qualityChecks: string[]
  }
  /** Extra rows after Quality checks (e.g. printing-details sheet: description + optional barcode). */
  printingFooter?: {
    printDescription: string
    barcode?: string
  } | null
}

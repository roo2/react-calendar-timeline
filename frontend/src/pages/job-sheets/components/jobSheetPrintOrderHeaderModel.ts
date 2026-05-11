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
    productCode: string
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

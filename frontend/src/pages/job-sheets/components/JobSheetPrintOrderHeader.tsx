import type { ReactElement } from 'react'

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

/**
 * Repeated at the top of each printed sheet (main job sheet + Uteco printing page).
 */
export function JobSheetPrintOrderHeader(props: JobSheetPrintOrderHeaderModel): ReactElement {
  const { titleLine, perforated, header: h, product: prod, printingFooter } = props
  return (
    <>
      <div className={`js-title${perforated ? ' js-perf-hl' : ''}`}>{titleLine}</div>

      <div className="js-compact">
        <div className="js-compact-grid">
          <div className="js-compact-item">
            <span className="js-compact-k">Customer:</span>
            <span className="js-compact-v">{h.customer}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Invoice no.:</span>
            <span className="js-compact-v">{h.invoiceNo}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Job code:</span>
            <span className="js-compact-v">{h.jobCode}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Order date:</span>
            <span className="js-compact-v">{h.orderDate}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Purchase order:</span>
            <span className="js-compact-v">{h.purchaseOrderNo}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Due date:</span>
            <span className="js-compact-v js-compact-v-strong">{h.dueDate}</span>
          </div>
        </div>

        <div className="js-compact-block">
          <div className="js-compact-item">
            <span className="js-compact-k">Product code:</span>
            <span className="js-compact-v js-product-code-val">{prod.productCode}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Product description:</span>
            <span className="js-compact-v js-compact-v-strong" style={{ whiteSpace: 'pre-wrap' }}>
              {prod.descriptionWithPackagingTail}
            </span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Ordered quantity:</span>
            <span className="js-compact-v js-compact-v-strong">{prod.orderedQuantityLabel}</span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Notes:</span>
            <span className="js-compact-v js-compact-v-strong" style={{ whiteSpace: 'pre-wrap' }}>
              {prod.notes}
            </span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Quality checks:</span>
            <span className="js-compact-v">
              {prod.qualityChecks.length ? (
                <ul className="js-quality-list">
                  {prod.qualityChecks.map((qc, i) => (
                    <li key={`${qc}-${i}`}>{qc}</li>
                  ))}
                </ul>
              ) : null}
            </span>
          </div>
          {printingFooter ? (
            <>
              <div className="js-print-uteco-card js-print-description-card">
                <span className="js-compact-k">Print description:</span>
                <span className="js-compact-v js-compact-v-strong" style={{ whiteSpace: 'pre-wrap' }}>
                  {String(printingFooter.printDescription ?? '').trim()}
                </span>
              </div>
              {String(printingFooter.barcode ?? '').trim() ? (
                <div className="js-compact-item">
                  <span className="js-compact-k">Bar code:</span>
                  <span className="js-compact-v js-print-barcode-v">{String(printingFooter.barcode).trim()}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}

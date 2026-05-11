import type { ReactElement } from 'react'
import { Box, Typography } from '@mui/material'
import type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'

export type JobSheetPrintOrderHeaderFieldsProps = {
  header: JobSheetPrintOrderHeaderModel['header']
  product: JobSheetPrintOrderHeaderModel['product']
  printingFooter?: JobSheetPrintOrderHeaderModel['printingFooter'] | null
  /** `print`: class names for {@link JobSheetPrintPage} stylesheet. `preview`: compact MUI for editor sidebar. */
  variant: 'print' | 'preview'
  /** When true (preview only), skip the 3×2 job grid and show only the product block (e.g. product version editor). */
  hideHeaderGrid?: boolean | undefined
}

function dash(v: unknown): string {
  const t = String(v ?? '').trim()
  return t === '' ? '—' : t
}

/**
 * Shared markup/order for the job sheet order header (below the title on print).
 * Print and preview use the same field order; preview uses smaller MUI typography.
 */
export function JobSheetPrintOrderHeaderFields(props: JobSheetPrintOrderHeaderFieldsProps): ReactElement {
  const { header: h, product: prod, printingFooter, variant, hideHeaderGrid = false } = props

  if (variant === 'print') {
    return (
      <div className="js-compact">
        {!hideHeaderGrid ? (
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
        ) : null}

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
    )
  }

  const kSx = {
    fontSize: '0.7rem',
    color: 'text.secondary',
    fontWeight: 600,
    flexShrink: 0,
  } as const
  const vSx = (opts?: { mono?: boolean; strong?: boolean; pre?: boolean }) => ({
    fontSize: '0.8125rem',
    lineHeight: 1.35,
    fontWeight: opts?.strong ? 600 : 400,
    color: 'text.primary',
    fontFamily: opts?.mono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined,
    whiteSpace: opts?.pre ? ('pre-wrap' as const) : undefined,
    wordBreak: 'break-word' as const,
    minWidth: 0,
  })

  const row = (key: string, value: string, o?: { mono?: boolean; strong?: boolean; pre?: boolean }) => (
    <Box
      key={key}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 0.75,
        rowGap: 0.125,
        alignItems: 'baseline',
        py: 0.125,
      }}
    >
      <Typography component="span" sx={kSx}>
        {key}
      </Typography>
      <Typography component="span" sx={vSx(o)}>
        {dash(value)}
      </Typography>
    </Box>
  )

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      {!hideHeaderGrid ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            columnGap: { xs: 0.75, sm: '10px' },
            rowGap: { xs: 0.5, sm: '6px' },
            mb: 1,
          }}
        >
          {row('Customer:', h.customer)}
          {row('Invoice no.:', h.invoiceNo, { mono: true })}
          {row('Job code:', h.jobCode, { mono: true })}
          {row('Order date:', h.orderDate)}
          {row('Purchase order:', h.purchaseOrderNo)}
          {row('Due date:', h.dueDate, { strong: true })}
        </Box>
      ) : null}

      <Box
        sx={{
          pt: hideHeaderGrid ? 0 : 1,
          mt: hideHeaderGrid ? 0 : 0.5,
          borderTop: hideHeaderGrid ? 0 : 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        {row('Product code:', prod.productCode, { mono: true, strong: true })}
        {row('Product description:', prod.descriptionWithPackagingTail, { strong: true, pre: true })}
        {row('Ordered quantity:', prod.orderedQuantityLabel, { strong: true })}
        {row('Notes:', prod.notes, { strong: true, pre: true })}
        <Box sx={{ py: 0.125 }}>
          <Typography component="div" sx={{ ...kSx, mb: prod.qualityChecks.length ? 0.25 : 0 }}>
            Quality checks:
          </Typography>
          {prod.qualityChecks.length ? (
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2,
                fontSize: '0.8125rem',
                lineHeight: 1.35,
                color: 'text.primary',
              }}
            >
              {prod.qualityChecks.map((qc, i) => (
                <li key={`${qc}-${i}`}>{qc}</li>
              ))}
            </Box>
          ) : (
            <Typography component="span" sx={vSx()}>
              —
            </Typography>
          )}
        </Box>
        {printingFooter ? (
          <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {row('Print description:', String(printingFooter.printDescription ?? ''), { strong: true, pre: true })}
            {String(printingFooter.barcode ?? '').trim()
              ? row('Bar code:', String(printingFooter.barcode).trim(), { mono: true })
              : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

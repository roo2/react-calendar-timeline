import type { ReactElement } from 'react'
import { Box, Typography } from '@mui/material'
import { formatDateDMYShort } from '../../../utils/dateFormat'
import type { JobSheetPrintOrderHeaderModel } from './jobSheetPrintOrderHeaderModel'

export type JobSheetPrintOrderHeaderFieldsProps = {
  header: JobSheetPrintOrderHeaderModel['header']
  product: JobSheetPrintOrderHeaderModel['product']
  printingFooter?: JobSheetPrintOrderHeaderModel['printingFooter'] | null
  /** `print`: class names for {@link JobSheetPrintPage} stylesheet. `preview`: compact MUI for editor sidebar. */
  variant: 'print' | 'preview'
  /** When true (preview only), skip the order grid and show only the product block (e.g. product version editor). */
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

  const notesText = String(prod.notes ?? '').trim()
  const qualityLabels = prod.qualityChecks.map((x) => String(x ?? '').trim()).filter(Boolean)
  const summaryLine = String(prod.summaryLine ?? '').trim()
  const orderDateDisplay = formatDateDMYShort(h.orderDate)
  const dueDateDisplay = formatDateDMYShort(h.dueDate)

  if (variant === 'print') {
    return (
      <div className="js-compact">
        {!hideHeaderGrid ? (
          <div className="js-compact-grid">
            <div className="js-compact-item">
              <span className="js-compact-k">Order Date:</span>
              <span className="js-compact-v">{orderDateDisplay}</span>
            </div>
            <div className="js-compact-item">
              <span className="js-compact-k">Due Date:</span>
              <span className="js-compact-v">{dueDateDisplay}</span>
            </div>
          </div>
        ) : null}

        <div className="js-compact-grid">
          <div className="js-compact-item">
            <span className="js-compact-k">Notes:</span>
            <span className="js-order-header-notes" style={{ whiteSpace: 'pre-wrap' }}>
              {notesText || '\u00A0'}
            </span>
          </div>
          <div className="js-compact-item">
            <span className="js-compact-k">Quality checks:</span>
            {qualityLabels.length > 0 ? (
              <ul className="js-quality-list">
                {qualityLabels.map((qc, i) => (
                  <li key={`${qc}-${i}`}>{qc}</li>
                ))}
              </ul>
            ) : (
              <span className="js-order-header-notes">{'\u00A0'}</span>
            )}
          </div>
          {printingFooter ? (
            <>
              <div className="js-print-uteco-card js-print-description-card">
                <span className="js-compact-k">Print description:</span>
                <span className="js-compact-v" style={{ whiteSpace: 'pre-wrap' }}>
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
        {summaryLine ? (
          <div className="js-order-header-summary-line js-print-primary-text">{summaryLine}</div>
        ) : null}
      </div>
    )
  }

  const kSx = {
    fontSize: '0.7rem',
    color: 'text.secondary',
    fontWeight: 500,
    flexShrink: 0,
  } as const
  const notesSx = {
    fontSize: '0.8125rem',
    lineHeight: 1.35,
    fontWeight: 500,
    color: 'text.secondary',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  }
  const paddedBlockSx = {
    mt: 0.75,
    p: 1,
    border: 1,
    borderColor: 'divider',
    borderRadius: 1,
    bgcolor: 'action.hover',
  } as const

  const row = (key: string, value: string, o?: { mono?: boolean; pre?: boolean }) => (
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
      <Typography
        component="span"
        sx={{
          fontSize: '0.8125rem',
          lineHeight: 1.35,
          fontWeight: 600,
          color: 'text.primary',
          fontFamily: o?.mono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined,
          whiteSpace: o?.pre ? ('pre-wrap' as const) : undefined,
          wordBreak: 'break-word' as const,
          minWidth: 0,
        }}
      >
        {dash(value)}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ bgcolor: 'background.paper' }}>
      {!hideHeaderGrid ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            columnGap: { xs: 0.75, sm: '10px' },
            rowGap: { xs: 0.5, sm: '6px' },
            mb: 1,
          }}
        >
          {row('Order Date:', orderDateDisplay)}
          {row('Due Date:', dueDateDisplay)}
        </Box>
      ) : null}

      {summaryLine ? (
        <Typography
          component="div"
          sx={{
            fontSize: '0.9375rem',
            lineHeight: 1.35,
            fontWeight: 700,
            color: 'text.primary',
            py: hideHeaderGrid ? 0 : 0.25,
            mt: hideHeaderGrid ? 0 : 0.5,
            borderTop: hideHeaderGrid ? 0 : 1,
            borderColor: 'divider',
          }}
        >
          {summaryLine}
        </Typography>
      ) : null}

      <Box
        sx={{
          pt: hideHeaderGrid ? 0 : summaryLine ? 0.75 : 1,
          mt: hideHeaderGrid ? 0 : summaryLine ? 0.5 : 0.5,
          borderTop: hideHeaderGrid ? 0 : 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box sx={paddedBlockSx}>
          <Typography component="div" sx={{ ...kSx, mb: 0.25 }}>
            Notes:
          </Typography>
          <Typography component="div" sx={notesSx}>
            {notesText || '\u00A0'}
          </Typography>
        </Box>
        <Box sx={paddedBlockSx}>
          <Typography component="div" sx={{ ...kSx, mb: qualityLabels.length > 0 ? 0.5 : 0.25 }}>
            Quality checks:
          </Typography>
          {qualityLabels.length > 0 ? (
            <Box
              component="ul"
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
              }}
            >
              {qualityLabels.map((qc, i) => (
                <Box
                  component="li"
                  key={`${qc}-${i}`}
                  sx={{
                    display: 'inline-flex',
                    px: 0.75,
                    py: 0.25,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    lineHeight: 1.35,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                  }}
                >
                  {qc}
                </Box>
              ))}
            </Box>
          ) : (
            <Typography component="div" sx={notesSx}>
              {'\u00A0'}
            </Typography>
          )}
        </Box>
        {printingFooter ? (
          <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {row('Print description:', String(printingFooter.printDescription ?? ''), { pre: true })}
            {String(printingFooter.barcode ?? '').trim()
              ? row('Bar code:', String(printingFooter.barcode).trim(), { mono: true })
              : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

import { Box, Link as MuiLink, Paper, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import type { JobSheetPreviewQuoteSummary } from '../utils/jobSheetPreviewQuoteSummary'

const QUALITY_FLAG_LABEL: Record<string, string> = {
  tight_gauge: 'Tight gauge tolerance',
  seal_integrity: 'Seal integrity critical',
  cosmetic: 'Printing Quality',
  colour: 'Colour critical',
}

function PreviewInlineRow(props: { label: string; value: string; monospace?: boolean; preWrap?: boolean }) {
  const { label, value, monospace, preWrap } = props
  const dash = '—'
  const v = String(value ?? '').trim()
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 1,
        rowGap: 0.25,
        alignItems: 'baseline',
      }}
    >
      <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={{
          fontFamily: monospace ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined,
          fontWeight: monospace ? 600 : 400,
          whiteSpace: preWrap ? 'pre-wrap' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {v ? value.trim() : dash}
      </Typography>
    </Box>
  )
}

export function JobSheetPreviewPanel(props: {
  productCode: string
  description: string
  /** Original import / MYOB line text (order line). */
  myobImportLineDescription?: string | null
  /** Optional override entered on the job sheet. */
  customerFacingDescription?: string | null
  /** When false, hide invoice / order date / due date (e.g. product spec editor sidebar). */
  showJobFields?: boolean
  /** Job sheet job number (e.g. CUST_1); shown when editing an existing job sheet. */
  jobCode?: string
  /** When set, show a link to the job sheet detail page in the preview header. */
  jobSheetId?: string | null
  /** Customer display name (matches printed header). */
  customerName?: string
  invoiceNo?: string
  purchaseOrderNo?: string
  orderDate?: string
  dueDate?: string
  /** Optional notes line (identity / run notes), same basis as the printed job sheet. */
  notes?: string | null
  /** Quality expectation flag ids from spec; shown with friendly labels when known. */
  qualityFlagIds?: string[] | null
  /** Optional hook before opening print preview; return false to cancel navigation. */
  onBeforeOpenPrint?: () => Promise<boolean> | boolean
  /** Live order qty + quote-calculator estimates (same basis as Quotes page). */
  quoteSummary?: JobSheetPreviewQuoteSummary | null
}) {
  const {
    productCode,
    description,
    myobImportLineDescription = '',
    customerFacingDescription = '',
    showJobFields = true,
    jobCode = '',
    jobSheetId = null,
    customerName = '',
    invoiceNo = '',
    purchaseOrderNo = '',
    orderDate = '',
    dueDate = '',
    notes = null,
    qualityFlagIds = null,
    onBeforeOpenPrint,
    quoteSummary = null,
  } = props
  const user = String(customerFacingDescription || '').trim()
  const myob = String(myobImportLineDescription || '').trim()
  const specDesc = String(description || '').trim()
  const effective = (user || myob || specDesc).trim()
  const showSpecSecondary = Boolean(specDesc && specDesc !== effective)
  const sheetId = jobSheetId != null && String(jobSheetId).trim() ? String(jobSheetId).trim() : ''
  const printHref = sheetId ? `/job-sheets/${encodeURIComponent(sheetId)}/print` : ''

  const qcLabels = (Array.isArray(qualityFlagIds) ? qualityFlagIds : [])
    .map((id) => QUALITY_FLAG_LABEL[String(id)] || String(id))
    .filter(Boolean)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h6">Preview</Typography>
        {sheetId ? (
          <MuiLink
            component={Link}
            to={printHref}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            variant="body2"
            sx={{ flexShrink: 0 }}
            onClick={async (e) => {
              if (!onBeforeOpenPrint) return
              e.preventDefault()
              const ok = await onBeforeOpenPrint()
              if (!ok || !printHref) return
              window.open(printHref, '_blank', 'noopener,noreferrer')
            }}
          >
            Print preview
          </MuiLink>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {showJobFields ? (
          <>
            <PreviewInlineRow label="Customer:" value={customerName} />
            <PreviewInlineRow label="Invoice no.:" value={invoiceNo} monospace />
            <PreviewInlineRow label="Job code:" value={jobCode} monospace />
            <PreviewInlineRow label="Order date:" value={orderDate} />
            <PreviewInlineRow label="Purchase order:" value={purchaseOrderNo} />
            <PreviewInlineRow label="Due date:" value={dueDate} />
            <Box sx={{ borderTop: 1, borderColor: 'divider', my: 0.75 }} />
          </>
        ) : null}

        <PreviewInlineRow label="Product code:" value={productCode} monospace />

        <PreviewInlineRow label="Product description:" value={effective} preWrap />

        {showSpecSecondary ? (
          <PreviewInlineRow label="From product spec:" value={specDesc} preWrap />
        ) : null}

        {showJobFields && quoteSummary?.orderQuantityLabel ? (
          <PreviewInlineRow label="Ordered quantity:" value={quoteSummary.orderQuantityLabel} />
        ) : null}

        {String(notes ?? '').trim() ? <PreviewInlineRow label="Notes:" value={String(notes).trim()} preWrap /> : null}

        {qcLabels.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, alignItems: 'baseline' }}>
            <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              Quality checks:
            </Typography>
            <Typography component="span" variant="body2">
              {qcLabels.join(', ')}
            </Typography>
          </Box>
        ) : null}

        {showJobFields && quoteSummary ? (
          <>
            <Box sx={{ borderTop: 1, borderColor: 'divider', my: 0.75 }} />
            <Typography variant="subtitle2" sx={{ mt: 0.25 }}>
              Production (estimate)
            </Typography>
            <PreviewInlineRow label="Extruded meters:" value={quoteSummary.extrudedMeters ? quoteSummary.extrudedMeters : ''} />
            <PreviewInlineRow
              label="Total KG (including waste):"
              value={quoteSummary.totalKgIncludingWaste != null ? `${quoteSummary.totalKgIncludingWaste} kg` : ''}
            />
            <PreviewInlineRow label="Extrusion time (est.):" value={quoteSummary.extrusionTimeDisplay || ''} />
            <PreviewInlineRow
              label="Extrusion waste factor:"
              value={
                quoteSummary.estimatedWasteFactorPct
                  ? `${quoteSummary.estimatedWasteFactorPct} of ordered job kg`
                  : ''
              }
            />
          </>
        ) : null}
      </Box>
    </Paper>
  )
}

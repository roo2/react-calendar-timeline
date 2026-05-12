import { Box, Paper, Typography } from '@mui/material'
import type { JobSheetPreviewQuoteSummary } from '../utils/jobSheetPreviewQuoteSummary'
import { JobSheetPrintOrderHeaderFields } from '../pages/job-sheets/components/JobSheetPrintOrderHeaderFields'
import type { JobSheetPrintOrderHeaderModel } from '../pages/job-sheets/components/jobSheetPrintOrderHeaderModel'

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
  /** Optional persisted job sheet id (passed through for consistency with callers). */
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
    customerName = '',
    invoiceNo = '',
    purchaseOrderNo = '',
    orderDate = '',
    dueDate = '',
    notes = null,
    qualityFlagIds = null,
    quoteSummary = null,
  } = props
  const user = String(customerFacingDescription || '').trim()
  const myob = String(myobImportLineDescription || '').trim()
  const specDesc = String(description || '').trim()
  const effective = (user || myob || specDesc).trim()
  const showSpecSecondary = Boolean(specDesc && specDesc !== effective)
  const qcLabels = (Array.isArray(qualityFlagIds) ? qualityFlagIds : [])
    .map((id) => QUALITY_FLAG_LABEL[String(id)] || String(id))
    .filter(Boolean)

  const emptyHeader: JobSheetPrintOrderHeaderModel['header'] = {
    customer: '',
    invoiceNo: '',
    jobCode: '',
    orderDate: '',
    purchaseOrderNo: '',
    dueDate: '',
  }

  const header: JobSheetPrintOrderHeaderModel['header'] = showJobFields
    ? {
        customer: customerName,
        invoiceNo: invoiceNo ?? '',
        jobCode: jobCode ?? '',
        orderDate: orderDate ?? '',
        purchaseOrderNo: purchaseOrderNo ?? '',
        dueDate: dueDate ?? '',
      }
    : emptyHeader

  const product: JobSheetPrintOrderHeaderModel['product'] = {
    productCode: productCode || '—',
    descriptionWithPackagingTail: effective || '—',
    orderedQuantityLabel:
      showJobFields && quoteSummary?.orderQuantityLabel && String(quoteSummary.orderQuantityLabel).trim() !== ''
        ? String(quoteSummary.orderQuantityLabel).trim()
        : '—',
    notes: String(notes ?? '').trim(),
    qualityChecks: qcLabels,
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Preview
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <JobSheetPrintOrderHeaderFields
          variant="preview"
          header={header}
          product={product}
          printingFooter={null}
          hideHeaderGrid={!showJobFields}
        />

        {showSpecSecondary ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', pl: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            <Box component="span" sx={{ fontWeight: 600 }}>
              From product spec:
            </Box>{' '}
            {specDesc}
          </Typography>
        ) : null}

        {showJobFields && quoteSummary ? (
          <>
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 0.25 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.02 }}>
              Production (estimate)
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 0.25 }}>
              <PreviewInlineRow label="Extruded meters:" value={quoteSummary.extrudedMeters ? quoteSummary.extrudedMeters : ''} />
              <PreviewInlineRow
                label="Total KG (inc waste):"
                value={quoteSummary.totalKgIncludingWaste != null ? `${quoteSummary.totalKgIncludingWaste} kg` : ''}
              />
              <PreviewInlineRow label="Extrusion time:" value={quoteSummary.extrusionTimeDisplay || ''} />
              <PreviewInlineRow
                label="Extrusion waste factor:"
                value={
                  quoteSummary.estimatedWasteFactorPct ? `${quoteSummary.estimatedWasteFactorPct} of extruded resin` : ''
                }
              />
            </Box>
          </>
        ) : null}
      </Box>
    </Paper>
  )
}

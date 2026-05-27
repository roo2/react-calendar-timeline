import { Box, Paper, Typography } from '@mui/material'
import type { JobSheetPreviewQuoteSummary } from '../utils/jobSheetPreviewQuoteSummary'
import type { JobSheetPalletLoadPlanning } from '../utils/jobSheetPalletPlanning'
import { JobSheetPrintOrderHeaderFields } from '../pages/job-sheets/components/JobSheetPrintOrderHeaderFields'
import type { JobSheetPrintOrderHeaderModel } from '../pages/job-sheets/components/jobSheetPrintOrderHeaderModel'

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
  /** Algorithmic product code from spec (primary header line). */
  generatedProductCode: string
  /** Generated description with packaging tail (sidebar “From product spec” hint only). */
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
  /** Quality check tag labels (flags + other QC notes). */
  qualityCheckLabels?: string[] | null
  /** Live order qty + quote-calculator estimates (same basis as Quotes page). */
  quoteSummary?: JobSheetPreviewQuoteSummary | null
  /** Print-header one-line summary (type/finish, qty, packing, rolls/ctns). */
  headerSummaryLine?: string | null
  /** Pallet count for ship quantity (job sheet packaging / volume estimate). */
  palletLoadPlanning?: JobSheetPalletLoadPlanning | null
  /** Lowercase unit label for display (`rolls` / `cartons`). */
  palletUnitLabel?: 'rolls' | 'cartons'
}) {
  const {
    generatedProductCode,
    description,
    myobImportLineDescription = '',
    customerFacingDescription = '',
    showJobFields = true,
    jobCode = '',
    customerName = '',
    orderDate = '',
    dueDate = '',
    notes = null,
    qualityCheckLabels = null,
    quoteSummary = null,
    headerSummaryLine: headerSummaryLineProp = null,
    palletLoadPlanning = null,
    palletUnitLabel = 'rolls',
  } = props
  const user = String(customerFacingDescription || '').trim()
  const myob = String(myobImportLineDescription || '').trim()
  const specDesc = String(description || '').trim()
  const effective = (user || myob || specDesc).trim()
  const showSpecSecondary = Boolean(specDesc && specDesc !== effective && !user)
  const qcLabels = (Array.isArray(qualityCheckLabels) ? qualityCheckLabels : [])
    .map((x) => String(x).trim())
    .filter(Boolean)

  const emptyHeader: JobSheetPrintOrderHeaderModel['header'] = {
    customer: '',
    jobCode: '',
    orderDate: '',
    dueDate: '',
  }

  const header: JobSheetPrintOrderHeaderModel['header'] = showJobFields
    ? {
        customer: customerName,
        jobCode: jobCode ?? '',
        orderDate: orderDate ?? '',
        dueDate: dueDate ?? '',
      }
    : emptyHeader

  const product: JobSheetPrintOrderHeaderModel['product'] = {
    generatedProductCode: String(generatedProductCode ?? '').trim(),
    productFinishLabel: '',
    summaryLine: String(headerSummaryLineProp ?? quoteSummary?.headerSummaryLine ?? '').trim(),
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

        {quoteSummary ? (
          <>
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 0.25 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.02 }}>
              Production (estimate)
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 0.25 }}>
              <PreviewInlineRow label="Original order:" value={quoteSummary.orderQuantityLabel || ''} />
              <PreviewInlineRow label="Extruded meters:" value={quoteSummary.extrudedMeters ? quoteSummary.extrudedMeters : ''} />
              <PreviewInlineRow
                label="Order KG (before waste):"
                value={quoteSummary.productiveKg != null ? `${quoteSummary.productiveKg} kg` : ''}
              />
              <PreviewInlineRow
                label="Total KG (inc waste):"
                value={quoteSummary.totalKgIncludingWaste != null ? `${quoteSummary.totalKgIncludingWaste} kg` : ''}
              />
              <PreviewInlineRow label="Extrusion time:" value={quoteSummary.extrusionTimeDisplay || ''} />
              {quoteSummary.wasteBreakdownLines.length > 0 ? (
                quoteSummary.wasteBreakdownLines.map((line) => (
                  <PreviewInlineRow key={`${line.label}-${line.value}`} label={line.label} value={line.value} />
                ))
              ) : (
                <PreviewInlineRow label="Waste factors:" value="None" />
              )}
              <PreviewInlineRow
                label="Total waste factor:"
                value={quoteSummary.estimatedWasteFactorPct ? `${quoteSummary.estimatedWasteFactorPct} of order KG` : ''}
              />
            </Box>
          </>
        ) : null}

        {palletLoadPlanning != null ? (
          <>
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 0.25 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.02 }}>
              Shipping (pallets)
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 0.25 }}>
              <PreviewInlineRow label="Pallets:" value={String(palletLoadPlanning.palletsRequired)} />
              <PreviewInlineRow
                label={`${palletUnitLabel === 'cartons' ? 'Cartons' : 'Rolls'} per pallet:`}
                value={`${palletLoadPlanning.unitsPerPallet}${
                  palletLoadPlanning.perPalletSource === 'volume_estimate' ? ' (volume est.)' : ''
                }`}
              />
            </Box>
          </>
        ) : null}
      </Box>
    </Paper>
  )
}

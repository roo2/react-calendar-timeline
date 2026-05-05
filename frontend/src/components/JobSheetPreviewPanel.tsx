import { Box, Link as MuiLink, Paper, Typography } from '@mui/material'
import { Link } from 'react-router-dom'

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
  invoiceNo?: string
  orderDate?: string
  dueDate?: string
  /** Optional hook before opening print preview; return false to cancel navigation. */
  onBeforeOpenPrint?: () => Promise<boolean> | boolean
}) {
  const {
    productCode,
    description,
    myobImportLineDescription = '',
    customerFacingDescription = '',
    showJobFields = true,
    jobCode = '',
    jobSheetId = null,
    invoiceNo = '',
    orderDate = '',
    dueDate = '',
    onBeforeOpenPrint,
  } = props
  const dash = '—'
  const user = String(customerFacingDescription || '').trim()
  const myob = String(myobImportLineDescription || '').trim()
  const specDesc = String(description || '').trim()
  const effective = (user || myob || specDesc).trim()
  const showSpecSecondary = Boolean(specDesc && specDesc !== effective)
  const sheetId = jobSheetId != null && String(jobSheetId).trim() ? String(jobSheetId).trim() : ''
  const printHref = sheetId ? `/job-sheets/${encodeURIComponent(sheetId)}/print` : ''
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
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div>
          <Typography variant="caption" color="text.secondary" display="block">
            Customer-facing product code
          </Typography>
          <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {productCode.trim() ? productCode : dash}
          </Typography>
        </div>
        {showJobFields ? (
          <>
            <div>
              <Typography variant="caption" color="text.secondary" display="block">
                Job code
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {jobCode.trim() ? jobCode : dash}
              </Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary" display="block">
                Invoice No
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {invoiceNo.trim() ? invoiceNo : dash}
              </Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary" display="block">
                Order Date
              </Typography>
              <Typography variant="body2">
                {orderDate.trim() ? orderDate : dash}
              </Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary" display="block">
                Due Date
              </Typography>
              <Typography variant="body2">
                {dueDate.trim() ? dueDate : dash}
              </Typography>
            </div>
          </>
        ) : null}
        <div>
          <Typography variant="caption" color="text.secondary" display="block">
            Customer-facing description
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {effective ? effective : dash}
          </Typography>
        </div>
        {showSpecSecondary ? (
          <div>
            <Typography variant="caption" color="text.secondary" display="block">
              From product spec
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {specDesc}
            </Typography>
          </div>
        ) : null}
      </Box>
    </Paper>
  )
}

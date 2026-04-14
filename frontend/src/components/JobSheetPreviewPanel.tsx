import { Box, Link as MuiLink, Paper, Typography } from '@mui/material'
import { Link } from 'react-router-dom'

export function JobSheetPreviewPanel(props: {
  productCode: string
  description: string
  /** When false, hide invoice / order date / due date (e.g. product spec editor sidebar). */
  showJobFields?: boolean
  /** Job sheet job number (e.g. CUST_1); shown when editing an existing job sheet. */
  jobCode?: string
  /** When set, show a link to the job sheet detail page in the preview header. */
  jobSheetId?: string | null
  invoiceNo?: string
  orderDate?: string
  dueDate?: string
}) {
  const {
    productCode,
    description,
    showJobFields = true,
    jobCode = '',
    jobSheetId = null,
    invoiceNo = '',
    orderDate = '',
    dueDate = '',
  } = props
  const dash = '—'
  const sheetId = jobSheetId != null && String(jobSheetId).trim() ? String(jobSheetId).trim() : ''
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
            to={`/job-sheets/${encodeURIComponent(sheetId)}`}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            variant="body2"
            sx={{ flexShrink: 0 }}
          >
            Open job sheet
          </MuiLink>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div>
          <Typography variant="caption" color="text.secondary" display="block">
            Product Code
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
            Description
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {description.trim() ? description : dash}
          </Typography>
        </div>
      </Box>
    </Paper>
  )
}

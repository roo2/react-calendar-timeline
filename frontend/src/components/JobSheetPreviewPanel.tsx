import { Box, Paper, Typography } from '@mui/material'

export function JobSheetPreviewPanel(props: {
  productCode: string
  description: string
  /** When false, hide invoice / order date / due date (e.g. product spec editor sidebar). */
  showJobFields?: boolean
  /** Job sheet job number (e.g. CUST_1); shown when editing an existing job sheet. */
  jobCode?: string
  invoiceNo?: string
  orderDate?: string
  dueDate?: string
}) {
  const {
    productCode,
    description,
    showJobFields = true,
    jobCode = '',
    invoiceNo = '',
    orderDate = '',
    dueDate = '',
  } = props
  const dash = '—'
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Preview
      </Typography>
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

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { ProductVersionSummary } from '../components/ProductVersionSummary'

type JobSheetDetail = {
  job_sheet: {
    id: string
    job_no: string
    customer_name?: string | null
    product_code: string
    product_description?: string | null
    due_date?: string | null
    quantity_value: number
    quantity_unit: string
    version_number: number
    product_id: string
    product_version_id: string
  }
  spec_payload: any
}

function fmtQty(v: number, u: string) {
  const unit =
    u === 'kg' ? 'kg' : u === 'rolls' ? 'rolls' : u === 'bags' ? 'bags' : u === 'meters' ? 'm' : u
  return `${v} ${unit}`
}

export function JobSheetShowPage() {
  const { jobSheetId } = useParams()
  const [data, setData] = useState<JobSheetDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!jobSheetId) return
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<JobSheetDetail>(`/api/job-sheets/${encodeURIComponent(jobSheetId)}`)
        setData(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load job sheet')
      }
    })()
  }, [jobSheetId])

  if (err) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Job Sheet</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to="/job-sheets" variant="outlined">
          Back
        </Button>
      </Stack>
    )
  }
  if (!data) return <p>Loading…</p>

  const js = data.job_sheet

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h5">Job Sheet {js.job_no}</Typography>
          <Typography variant="body2" color="text.secondary">
            Customer: {js.customer_name || '-'} • Product: {js.product_code} • Version: {js.version_number}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Qty: {fmtQty(Number(js.quantity_value || 0), js.quantity_unit)} • Due: {js.due_date || '-'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Button component={Link} to={`/products/${js.product_id}/versions/${js.product_version_id}`} variant="outlined">
            View Version
          </Button>
          <Button component={Link} to="/job-sheets" variant="outlined">
            Back to Job Sheets
          </Button>
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Summary (spec)
        </Typography>
        <ProductVersionSummary spec={data.spec_payload} />
      </Paper>
    </Stack>
  )
}


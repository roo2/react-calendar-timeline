import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
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

function qtyTypeLabel(u: string) {
  if (u === 'kg') return 'Total KGs'
  if (u === 'rolls') return 'No. of Rolls'
  if (u === 'bags') return 'No. of Bags'
  if (u === 'meters') return 'Total Meters'
  return u
}

export function JobSheetShowPage() {
  const { jobSheetId } = useParams()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
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
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Job Sheet</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              component={Link}
              to={`/job-sheets/${encodeURIComponent(js.id)}/edit?returnTo=${encodeURIComponent(returnTo)}`}
              variant="contained"
            >
              Edit Job Sheet
            </Button>
            <Button component={Link} to="/job-sheets" variant="outlined">
              Back to Job Sheets
            </Button>
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
          <TextField label="Customer" value={js.customer_name || '-'} InputProps={{ readOnly: true }} disabled />
          <TextField label="Job No" value={js.job_no || ''} InputProps={{ readOnly: true }} disabled />
          <TextField label="Due Date" value={js.due_date || '-'} InputProps={{ readOnly: true }} disabled />
        </Box>

        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          <TextField label="Quantity Type" value={js.quantity_unit || ''} InputProps={{ readOnly: true }} disabled />
          <TextField
            label={qtyTypeLabel(js.quantity_unit)}
            value={fmtQty(Number(js.quantity_value || 0), js.quantity_unit)}
            InputProps={{ readOnly: true }}
            disabled
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Product"
            value={`${js.product_code}${js.product_description ? ` — ${js.product_description}` : ''}`}
            InputProps={{ readOnly: true }}
            disabled
            fullWidth
            helperText={`Version: ${js.version_number}`}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Summary (spec)
        </Typography>
        <ProductVersionSummary spec={data.spec_payload} />
      </Paper>
    </Stack>
  )
}


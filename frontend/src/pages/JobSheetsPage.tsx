import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Alert, Box, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'

type JobSheetSummary = {
  id: string
  job_no: string
  customer_name?: string | null
  product_code: string
  product_description?: string | null
  due_date?: string | null
  quantity_value: number
  quantity_unit: string
  created_at?: string | null
}

function fmtQty(v: number, u: string) {
  const unit =
    u === 'kg' ? 'kg' : u === 'rolls' ? 'rolls' : u === 'bags' ? 'bags' : u === 'meters' ? 'm' : u
  return `${v} ${unit}`
}

export function JobSheetsPage() {
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const [items, setItems] = useState<JobSheetSummary[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const res = await apiFetch<{ items: JobSheetSummary[] }>('/api/job-sheets')
        setItems(res.items || [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load job sheets')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h5">Job Sheets</Typography>
          <Typography variant="body2" color="text.secondary">
            Saved job sheets (quantity + due date + spec version).
          </Typography>
        </Box>
        <Button variant="contained" component={Link} to="/job-sheets/new">
          New Job Sheet
        </Button>
      </Box>

      {err && <Alert severity="error">{err}</Alert>}

      <Paper variant="outlined">
        {loading ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Job No</TableCell>
                <TableCell sx={{ width: 220 }}>Customer</TableCell>
                <TableCell sx={{ width: 220 }}>Product</TableCell>
                <TableCell>Qty</TableCell>
                <TableCell sx={{ width: 140 }}>Due</TableCell>
                <TableCell sx={{ width: 200 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{r.job_no}</TableCell>
                  <TableCell>{r.customer_name || '-'}</TableCell>
                  <TableCell>
                    <strong>{r.product_code}</strong>
                    {r.product_description ? ` — ${r.product_description}` : ''}
                  </TableCell>
                  <TableCell>{fmtQty(Number(r.quantity_value || 0), r.quantity_unit)}</TableCell>
                  <TableCell>{r.due_date || '-'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button size="small" variant="outlined" component={Link} to={`/job-sheets/${r.id}`}>
                        View
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        component={Link}
                        to={`/job-sheets/${r.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                      >
                        Edit
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                    No job sheets yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Stack>
  )
}


import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheets, type JobSheetSummary } from '../../store/slices/jobSheetsSlice'
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

function fmtQty(v: number, u: string) {
  const unit =
    u === 'kg' ? 'kg' : u === 'rolls' ? 'rolls' : u === 'bags' ? 'bags' : u === 'meters' ? 'm' : u
  return `${v} ${unit}`
}

export function JobSheetsPage() {
  const dispatch = useAppDispatch()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const { items, status, error } = useAppSelector((s) => s.jobSheets.list)
  const loading = status === 'loading'

  useEffect(() => {
    void dispatch(fetchJobSheets())
  }, [dispatch])

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

      {error && <Alert severity="error">{error}</Alert>}

      <Paper variant="outlined">
        {loading && items.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Invoice No</TableCell>
                <TableCell sx={{ width: 72, maxWidth: 88, whiteSpace: 'nowrap' }}>Customer</TableCell>
                <TableCell sx={{ minWidth: 280 }}>Product</TableCell>
                <TableCell>Qty</TableCell>
                <TableCell sx={{ width: 120 }}>Order Date</TableCell>
                <TableCell sx={{ width: 120 }}>Due Date</TableCell>
                <TableCell sx={{ width: 200 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(items as JobSheetSummary[]).map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{r.invoice_no ?? ''}</TableCell>
                  <TableCell
                    sx={{ width: 72, maxWidth: 88, whiteSpace: 'nowrap', fontFamily: 'monospace' }}
                    title={
                      (r.customer_code || '').trim() && r.customer_name ? r.customer_name : undefined
                    }
                  >
                    {(r.customer_code || '').trim().toUpperCase() || r.customer_name || '—'}
                  </TableCell>
                  <TableCell sx={{ minWidth: 280, verticalAlign: 'top' }}>
                    <Typography variant="body2" component="div" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {r.product_code}
                    </Typography>
                    {r.product_description ? (
                      <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                        {r.product_description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{fmtQty(Number(r.quantity_value || 0), r.quantity_unit)}</TableCell>
                  <TableCell>{r.order_date ?? '-'}</TableCell>
                  <TableCell>{r.due_date ?? '-'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button size="small" variant="text" color="primary" component={Link} to={`/job-sheets/${r.id}`}>
                        View
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        component={Link}
                        to={`/job-sheets/${r.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                      >
                        Edit
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
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

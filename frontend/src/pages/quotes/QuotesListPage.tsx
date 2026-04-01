import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchSavedQuotesList } from '../../store/slices/quotesSlice'
import { can } from '../../auth/permissions'
import { buildSpecFromQuotePayload, type QuotePayload } from '../../utils/quoteToSpec'
import { computeProductDescriptionFromSpec } from '../../utils/productDescription'
import {
  Alert,
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Link as MuiLink,
} from '@mui/material'

function productDescriptionFromSavedPayload(payload: Record<string, unknown> | undefined | null): string {
  if (!payload || typeof payload !== 'object') return '—'
  try {
    const spec = buildSpecFromQuotePayload(payload as QuotePayload)
    const text = computeProductDescriptionFromSpec(spec).trim()
    return text || '—'
  } catch {
    return '—'
  }
}

function fmtQuotedKg(payload: Record<string, unknown> | undefined | null): string {
  const v = payload?.quoted_totals_kg
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`
}

function fmtQuotedTotalPrice(payload: Record<string, unknown> | undefined | null): string {
  const v = payload?.quoted_total_price
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function QuotesListPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const { items, status, error } = useAppSelector((s) => s.quotes.savedList)
  const canCreate = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const loading = status === 'loading'

  useEffect(() => {
    void dispatch(fetchSavedQuotesList(undefined))
  }, [dispatch])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h5">Quotes</Typography>
          <Typography variant="body2" color="text.secondary">
            Saved quotes (quick quote calculator).
          </Typography>
        </Box>
        {canCreate && (
          <Button variant="contained" component={Link} to="/quotes/new">
            New Quote
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined">
        {loading && items.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Customer</TableCell>
                  <TableCell sx={{ minWidth: 200, maxWidth: 420 }}>Description</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Total kg
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Total price
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Price/kg
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>Created</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((q) => (
                  <TableRow key={q.id} hover>
                    <TableCell>
                      <MuiLink component={Link} to={`/customers/${q.customer_id}`} underline="hover">
                        {q.customer_name || q.customer_id || '-'}
                      </MuiLink>
                    </TableCell>
                    <TableCell
                      sx={{
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        color: 'text.secondary',
                        fontSize: '0.8125rem',
                      }}
                    >
                      {productDescriptionFromSavedPayload(q.payload)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {fmtQuotedKg(q.payload)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {fmtQuotedTotalPrice(q.payload)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {q.price_per_kg != null && Number.isFinite(Number(q.price_per_kg))
                        ? `$${Number(q.price_per_kg).toFixed(2)}`
                        : '—'}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {q.created_at
                        ? new Date(q.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
                        : '-'}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <Button size="small" variant="text" color="primary" component={Link} to={`/quotes/${encodeURIComponent(q.id)}/edit`}>
                          View
                        </Button>
                        {canEdit && (
                          <Button size="small" variant="outlined" component={Link} to={`/quotes/${encodeURIComponent(q.id)}/edit`}>
                            Edit
                          </Button>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary">No quotes.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  )
}

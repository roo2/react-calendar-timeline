import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchSavedQuotesList } from '../../store/slices/quotesSlice'
import { can } from '../../auth/permissions'
import { buildSpecFromQuotePayload, type QuotePayload } from '../../utils/quoteToSpec'
import { computeProductDescriptionFromSpec } from '../../utils/productDescription'
import {
  joinQuoteDescriptionWithPackagingTail,
  quotePackagingPerUnitTailFromPayload,
  quoteTotalQuantityLabelFromPayload,
} from '../../utils/quoteQuantityDescriptors'
import { formatDateDMYShort } from '../../utils/dateFormat'
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

function fmtQuotedTotalPrice(payload: Record<string, unknown> | undefined | null): string {
  const v = payload?.quoted_total_price
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPricePerUnit(row: { payload: Record<string, unknown> | null | undefined; price_per_kg?: string | null }): string {
  const payload = row.payload
  if (!payload || typeof payload !== 'object') return '—'
  const qtyType = String((payload as { qtyType?: unknown }).qtyType ?? '').trim()
  const finishMode = String((payload as { finishMode?: unknown }).finishMode ?? '').trim()
  const cartonQtyMode = String((payload as { cartonQtyMode?: unknown }).cartonQtyMode ?? '').trim()
  const lengthUnits = String((payload as { lengthUnits?: unknown }).lengthUnits ?? '').trim().toLowerCase()
  const quotedTotal = Number((payload as { quoted_total_price?: unknown }).quoted_total_price ?? 0)
  const quotedKg = Number((payload as { quoted_totals_kg?: unknown }).quoted_totals_kg ?? 0)
  const quantity = (payload as { quantity?: Record<string, unknown> }).quantity
  const numRolls = Number((payload as { numRolls?: unknown }).numRolls ?? quantity?.rolls ?? 0)
  const numUnits = Number((payload as { numUnits?: unknown }).numUnits ?? quantity?.units ?? 0)
  const numCartons = Number((payload as { numCartons?: unknown }).numCartons ?? 0)

  const fmt = (n: number, unit: string) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per ${unit}`

  if (qtyType === 'kg') {
    const ppk = row.price_per_kg != null ? Number(row.price_per_kg) : NaN
    if (Number.isFinite(ppk) && ppk > 0) return fmt(ppk, 'KG')
    if (quotedTotal > 0 && quotedKg > 0) return fmt(quotedTotal / quotedKg, 'KG')
    return '—'
  }

  if (qtyType === 'total_rolls' && finishMode === 'Rolls' && quotedTotal > 0 && numRolls > 0) {
    return fmt(quotedTotal / numRolls, 'ROLL')
  }

  if (qtyType === 'units' && finishMode === 'Cartons' && cartonQtyMode === 'ctn' && quotedTotal > 0 && numCartons > 0) {
    return fmt(quotedTotal / numCartons, 'CTN')
  }

  if (qtyType === 'units' && quotedTotal > 0 && numUnits > 0) {
    if (lengthUnits === 'continuous') return fmt(quotedTotal / numUnits, 'ea')
    return fmt(quotedTotal / (numUnits / 1000), '1000')
  }

  if (quotedTotal > 0 && quotedKg > 0) return fmt(quotedTotal / quotedKg, 'KG')
  return '—'
}

function fmtPricePerKg(row: { payload: Record<string, unknown> | null | undefined; price_per_kg?: string | null }): string {
  const payload = row.payload
  if (!payload || typeof payload !== 'object') return '—'
  const quotedTotal = Number((payload as { quoted_total_price?: unknown }).quoted_total_price ?? 0)
  const quotedKg = Number((payload as { quoted_totals_kg?: unknown }).quoted_totals_kg ?? 0)
  const ppk = row.price_per_kg != null ? Number(row.price_per_kg) : NaN
  if (Number.isFinite(ppk) && ppk > 0) return `$${ppk.toFixed(2)}`
  if (quotedTotal > 0 && quotedKg > 0) return `$${(quotedTotal / quotedKg).toFixed(2)}`
  return '—'
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
                    Total qty
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Price per Unit
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Total price
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Price per KG
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
                      {(() => {
                        const base = productDescriptionFromSavedPayload(q.payload)
                        const hasProductLine = Boolean((base || '').trim() && base !== '—')
                        if (!hasProductLine) return base
                        return joinQuoteDescriptionWithPackagingTail(
                          base,
                          quotePackagingPerUnitTailFromPayload(q.payload),
                        )
                      })()}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {quoteTotalQuantityLabelFromPayload(q.payload)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {fmtPricePerUnit(q)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {fmtQuotedTotalPrice(q.payload)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {fmtPricePerKg(q)}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDateDMYShort(q.created_at, '-')}
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
                    <TableCell colSpan={8}>
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

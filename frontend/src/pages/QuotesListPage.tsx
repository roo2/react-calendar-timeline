import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import {
  Alert,
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Link as MuiLink,
} from '@mui/material'

type QuoteRow = {
  id: string
  customer_id: string
  customer_name?: string | null
  payload: Record<string, unknown>
  cost_per_kg?: number | null
  price_per_kg?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export function QuotesListPage() {
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canCreate = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')

  const [items, setItems] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const res = await apiFetch<QuoteRow[]>('/api/quotes/saved')
        setItems(Array.isArray(res) ? res : [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load quotes')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

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

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      <Paper variant="outlined">
        {loading ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Customer</TableCell>
                <TableCell>Product type</TableCell>
                <TableCell>Price/kg</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
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
                  <TableCell>{(q.payload?.product_type as string) || '-'}</TableCell>
                  <TableCell>
                    {q.price_per_kg != null && Number.isFinite(Number(q.price_per_kg))
                      ? `$${Number(q.price_per_kg).toFixed(2)}`
                      : '-'}
                  </TableCell>
                  <TableCell>
                    {q.created_at
                      ? new Date(q.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
                      : '-'}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit && (
                      <Button size="small" variant="outlined" component={Link} to={`/quotes/${encodeURIComponent(q.id)}/edit`}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography color="text.secondary">No quotes.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  )
}

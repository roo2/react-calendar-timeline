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

type OrderRow = {
  id: string
  code: string
  status: string
  customer_name?: string | null
  product_code?: string | null
  version_number?: number | null
  item_count?: number | null
  created_at?: string | null
  order_date?: string | null
}

export function OrdersPage() {
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canCreate = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')

  const [items, setItems] = useState<OrderRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<OrderRow[]>('/api/orders')
        setItems(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load orders')
      }
    })()
  }, [])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h5">Orders</Typography>
        {canCreate && (
          <Button variant="contained" component={Link} to="/orders/new">
            New Order
          </Button>
        )}
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice Number</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Order Date</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((o) => (
              <TableRow key={o.id} hover>
                <TableCell>
                  <MuiLink component={Link} to={`/orders/${o.id}`} underline="hover">
                    {o.code}
                  </MuiLink>
                </TableCell>
                <TableCell>{o.customer_name || '-'}</TableCell>
                <TableCell>
                  {o.product_code
                    ? `${o.product_code}${o.version_number != null ? ` v${o.version_number}` : ''}${o.item_count && o.item_count > 1 ? ` (+${o.item_count - 1})` : ''}`
                    : '-'}
                </TableCell>
                <TableCell>{o.status}</TableCell>
                <TableCell>{o.order_date || o.created_at?.slice(0, 10) || ''}</TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    <Button size="small" variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(o.id)}`}>
                      View
                    </Button>
                    {canEdit && (o.status === 'draft' || o.status === 'confirmed') ? (
                      <Button size="small" variant="outlined" component={Link} to={`/orders/${encodeURIComponent(o.id)}/edit`}>
                        Edit
                      </Button>
                    ) : null}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}


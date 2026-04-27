import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchOrders, type OrderRow } from '../../store/slices/ordersSlice'
import { can } from '../../auth/permissions'
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

export function OrdersPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const { items, status, error } = useAppSelector((s) => s.orders.list)
  const canCreate = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')

  useEffect(() => {
    void dispatch(fetchOrders(undefined))
  }, [dispatch])

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

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined">
        {status === 'loading' && items.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice Number</TableCell>
                <TableCell>Customer PO</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Product</TableCell>
                <TableCell align="right">Order total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Order Date</TableCell>
                <TableCell>MYOB</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(items as OrderRow[]).map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/orders/${o.id}`} underline="hover">
                      {o.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{o.customer_purchase_order_number || '—'}</TableCell>
                  <TableCell>{o.customer_name || '-'}</TableCell>
                  <TableCell>
                    {o.product_code
                      ? `${o.product_code}${o.version_number != null ? ` v${o.version_number}` : ''}${o.item_count && o.item_count > 1 ? ` (+${o.item_count - 1})` : ''}`
                      : '-'}
                  </TableCell>
                  <TableCell align="right">
                    {o.order_total != null && Number.isFinite(Number(o.order_total))
                      ? `$${Number(o.order_total).toFixed(2)}`
                      : '—'}
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
        )}
      </Paper>
    </Box>
  )
}

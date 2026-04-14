import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchOrder, publishOrder } from '../../store/slices/ordersSlice'
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
} from '@mui/material'

export function OrderShowPage() {
  const { orderId } = useParams()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const detailEntry = useAppSelector((s) => (orderId ? s.orders.detail.byId[orderId] : undefined))
  const order = detailEntry?.order
  const loadErr = detailEntry?.error
  const loading = detailEntry?.status === 'loading' || detailEntry?.status === 'idle'

  const canPublish = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = canPublish

  const [publishErr, setPublishErr] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!orderId) return
    void dispatch(fetchOrder(orderId))
  }, [orderId, dispatch])

  const err = loadErr || publishErr

  if (err && !order && detailEntry?.status === 'failed') {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Order
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to="/orders" variant="text" color="primary">
          Back to Orders
        </Button>
      </Box>
    )
  }
  if (!order || loading) return <p>Loading…</p>

  const items = order.items || []
  const totalPriceSum = items.reduce(
    (sum: number, it: { total_price?: number | null }) => sum + (it.total_price != null ? Number(it.total_price) : 0),
    0,
  )

  function fmtCurrency(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—'
    return `$${Number(v).toFixed(2)}`
  }

  function formatOrderUnit(u: string | undefined): string {
    const x = String(u || '').toLowerCase()
    if (x === 'kg') return 'KG'
    if (x === 'rolls') return 'Roll'
    if (x === 'cartons') return 'Carton'
    if (x === 'bags') return 'Bags (legacy)'
    if (x === 'meters') return 'Meters (legacy)'
    return u || '—'
  }

  async function onPublish() {
    if (!orderId) return
    if (publishing) return
    try {
      setPublishErr(null)
      setPublishing(true)
      await dispatch(publishOrder(orderId)).unwrap()
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : 'Failed to publish order')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Order {order.code}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Status: <strong>{order.status}</strong> • Customer: {order.customer_name || '-'} • Order Date:{' '}
        {order.order_date || order.created_at?.slice(0, 10) || '-'}
      </Typography>

      {publishErr && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {publishErr}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Button component={Link} to="/orders" variant="text" color="primary">
          Back to Orders
        </Button>
        {canEdit && (order.status === 'draft' || order.status === 'confirmed') && (
          <Button variant="outlined" component={Link} to={`/orders/${encodeURIComponent(order.id)}/edit`}>
            Edit Order
          </Button>
        )}
        {canPublish && order.status === 'draft' && (
          <Button variant="contained" onClick={onPublish} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish Order'}
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Job No</TableCell>
              <TableCell>Product Code</TableCell>
              <TableCell>Product Name</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">Total Price</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((it: any) => (
              <TableRow key={it.id} hover>
                <TableCell>{it.job_no || '-'}</TableCell>
                <TableCell>{it.product_code || '-'}</TableCell>
                <TableCell>{it.product_name || '-'}</TableCell>
                <TableCell align="right">
                  {it.quantity_value != null ? Number(it.quantity_value).toLocaleString() : '—'}
                </TableCell>
                <TableCell>{formatOrderUnit(it.quantity_unit)}</TableCell>
                <TableCell align="right">{fmtCurrency(it.rate)}</TableCell>
                <TableCell align="right">{fmtCurrency(it.total_price)}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    component={Link}
                    to={`/job-sheets/${it.job_sheet_id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                  >
                    Edit job sheet
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary">No line items.</Typography>
                </TableCell>
              </TableRow>
            )}
            {items.length > 0 && (
              <TableRow sx={{ fontWeight: 600, bgcolor: 'action.hover' }}>
                <TableCell colSpan={6} align="right">
                  Total
                </TableCell>
                <TableCell align="right">{fmtCurrency(totalPriceSum)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}

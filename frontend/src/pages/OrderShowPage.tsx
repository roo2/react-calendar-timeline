import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
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
} from '@mui/material'

export function OrderShowPage() {
  const { orderId } = useParams()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canPublish = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = canPublish

  const [order, setOrder] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!orderId) return
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<any>(`/api/orders/${orderId}`)
        setOrder(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load order')
      }
    })()
  }, [orderId])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Order
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to="/orders" variant="outlined">
          Back to Orders
        </Button>
      </Box>
    )
  }
  if (!order) return <p>Loading…</p>

  async function onPublish() {
    if (!orderId) return
    if (publishing) return
    try {
      setPublishing(true)
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/publish`, { method: 'POST' })
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      setOrder(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to publish order')
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
        Status: <strong>{order.status}</strong> • Customer: {order.customer_name || '-'} • Created: {order.created_at || ''}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        {canPublish && order.status === 'draft' && (
          <Button variant="contained" onClick={onPublish} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish Order'}
          </Button>
        )}
        {canEdit && (order.status === 'draft' || order.status === 'confirmed') && (
          <Button variant="outlined" component={Link} to={`/orders/${encodeURIComponent(order.id)}/edit`}>
            Edit Order
          </Button>
        )}
        <Button variant="outlined" component={Link} to="/orders">
          Back to Orders
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Job No</TableCell>
              <TableCell>Product Code</TableCell>
              <TableCell>Product Name</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Due Date</TableCell>
              <TableCell>Quantity</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(order.items || []).map((it: any) => (
              <TableRow key={it.id} hover>
                <TableCell>{it.job_no || '-'}</TableCell>
                <TableCell>{it.product_code || '-'}</TableCell>
                <TableCell>{it.product_name || '-'}</TableCell>
                <TableCell>{it.version_number != null ? `v${it.version_number}` : '-'}</TableCell>
                <TableCell>{it.due_date || '-'}</TableCell>
                <TableCell>
                  {it.quantity_value != null ? `${it.quantity_value} ${it.quantity_unit || ''}`.trim() : '-'}
                </TableCell>
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
            {(order.items || []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary">No products.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

    </Box>
  )
}


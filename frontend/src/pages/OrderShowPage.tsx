import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canAddJob = can(roles, 'PROD_MANAGER')

  const [order, setOrder] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

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

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Order {order.code}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Status: <strong>{order.status}</strong> • Customer: {order.customer_name || '-'} • Product:{' '}
        {order.product_code ? `${order.product_code} v${order.version_number ?? ''}` : '-'} • Currency: {order.currency} • Created:{' '}
        {order.created_at || ''}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        {canAddJob && (
          <Button variant="contained" component={Link} to={`/orders/${order.id}/jobs/new`}>
            Add Job
          </Button>
        )}
        <Button variant="outlined" component={Link} to="/orders">
          Back to Orders
        </Button>
      </Box>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Job Code</TableCell>
              <TableCell>Planned Qty</TableCell>
              <TableCell>Produced Qty</TableCell>
              <TableCell>Allocated Units</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(order.jobs || []).map((j: any) => (
              <TableRow key={j.id} hover>
                <TableCell>{j.job_code}</TableCell>
                <TableCell>{j.planned_qty}</TableCell>
                <TableCell>{j.produced_qty}</TableCell>
                <TableCell>{j.allocated_order_units || '-'}</TableCell>
                <TableCell>{j.status}</TableCell>
              </TableRow>
            ))}
            {(order.jobs || []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary">No jobs yet.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}


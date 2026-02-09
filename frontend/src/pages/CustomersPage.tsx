import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppSelector } from '../store/hooks'
import { useAppDispatch } from '../store/hooks'
import { can } from '../auth/permissions'
import { fetchCustomers } from '../store/slices/customersSlice'
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
  TextField,
  Typography,
  Link as MuiLink,
} from '@mui/material'

export function CustomersPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const canCreateOrder = can(roles, 'SALES', 'PROD_MANAGER')

  const [q, setQ] = useState('')
  const items = useAppSelector((s) => s.customers.list.items)
  const err = useAppSelector((s) => s.customers.list.error)

  useEffect(() => {
    void dispatch(fetchCustomers({ q: '' }))
  }, [dispatch])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await dispatch(fetchCustomers({ q }))
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h5">Customers</Typography>
        {canEdit && (
          <Button variant="contained" component={Link} to="/customers/new">
            New Customer
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <form onSubmit={onSubmit}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <TextField
              label="Search"
              placeholder="Search by name..."
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              sx={{ minWidth: 240 }}
            />
            <Button type="submit" variant="outlined">
              Search
            </Button>
          </Box>
        </form>
      </Paper>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      {items.length > 0 ? (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/customers/${c.id}`} underline="hover">
                      {c.name}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{c.status}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button size="small" variant="outlined" component={Link} to={`/customers/${c.id}`}>
                        View
                      </Button>
                      {canEdit && (
                        <Button size="small" variant="outlined" component={Link} to={`/customers/${c.id}/edit`}>
                          Edit
                        </Button>
                      )}
                      {canCreateOrder && (
                        <Button size="small" variant="contained" component={Link} to={`/orders/new?customerId=${encodeURIComponent(c.id)}`}>
                          New Order
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No customers found{q ? '. Try a different search term.' : '.'}{' '}
            {canEdit && (
              <MuiLink component={Link} to="/customers/new" underline="hover">
                Create your first customer
              </MuiLink>
            )}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}


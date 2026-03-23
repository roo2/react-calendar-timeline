import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchProducts } from '../../store/slices/productsSlice'
import { can } from '../../auth/permissions'
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
  TextField,
  Typography,
  Link as MuiLink,
} from '@mui/material'
export function ProductsPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const { items, status, error, lastQuery } = useAppSelector((s) => s.products.list)
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const isPm = can(roles, 'PROD_MANAGER')

  const [q, setQ] = useState('')

  useEffect(() => {
    void dispatch(fetchProducts(undefined))
  }, [dispatch])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await dispatch(fetchProducts({ q })).unwrap()
    } catch {
      // error in slice
    }
  }

  const listErr = lastQuery === q.trim() && status === 'failed' ? error : null

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5">Products</Typography>
        {canEdit && (
          <Button variant="contained" component={Link} to="/products/new">
            New Product
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <form onSubmit={onSubmit}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Search"
              placeholder="Search by code"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Button type="submit" variant="outlined" size="small" sx={{ px: 2, py: 1 }}>
              Search
            </Button>
          </Box>
        </form>
      </Paper>

      {listErr && <Alert severity="error">{listErr}</Alert>}

      <Paper variant="outlined">
        {status === 'loading' && items.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Customer</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Type</TableCell>
                <TableCell sx={{ width: 220, whiteSpace: 'nowrap' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.customer_name || '-'}</TableCell>
                  <TableCell>
                    <MuiLink
                      component={Link}
                      to={p.active_version_id ? `/products/${p.id}/versions/${p.active_version_id}` : `/products/${p.id}`}
                      underline="hover"
                    >
                      {p.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{p.description || '-'}</TableCell>
                  <TableCell>{p.product_type || '-'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'nowrap', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <MuiLink
                        component={Link}
                        to={`/products/${p.id}`}
                        underline="hover"
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Previous versions ({typeof p.version_count === 'number' ? p.version_count : 0})
                      </MuiLink>
                      {isPm ? (
                        <Button size="small" variant="outlined" component={Link} to={`/products/${p.id}/versions/new`}>
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
    </Stack>
  )
}

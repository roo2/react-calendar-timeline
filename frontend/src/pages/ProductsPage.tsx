import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
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

type ProductSummary = {
  id: string
  code: string
  description?: string | null
  customer_name?: string | null
  active_version_id?: string | null
  active_version_number?: number | null
  product_type?: string | null
  pack_mode?: string | null
}

export function ProductsPage() {
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const isPm = can(roles, 'PROD_MANAGER')

  const [q, setQ] = useState('')
  const [items, setItems] = useState<ProductSummary[]>([])
  const [err, setErr] = useState<string | null>(null)

  async function load(query: string) {
    setErr(null)
    const res = await apiFetch<{ items: ProductSummary[] }>(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    setItems(res.items)
  }

  useEffect(() => {
    void load('')
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await load(q)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to load products')
    }
  }

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

      {err && <Alert severity="error">{err}</Alert>}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Customer</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Packing</TableCell>
              <TableCell sx={{ width: 140 }}>Latest</TableCell>
              <TableCell sx={{ width: 220 }}>Actions</TableCell>
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
                <TableCell>{p.pack_mode || '-'}</TableCell>
                <TableCell>{p.active_version_number ?? '-'}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <MuiLink component={Link} to={`/products/${p.id}`} underline="hover">
                      Previous versions
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
      </Paper>
    </Stack>
  )
}


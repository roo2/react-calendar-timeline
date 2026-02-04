import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
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
  customer_name?: string | null
  active_version_id?: string | null
}

export function ProductsPage() {
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = roles.includes('SALES') || roles.includes('PROD_MANAGER')

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
              label="Search"
              placeholder="Search by code"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Button type="submit" variant="outlined">
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
              <TableCell>Code</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>Active Version</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <MuiLink component={Link} to={`/products/${p.id}`} underline="hover">
                    {p.code}
                  </MuiLink>
                </TableCell>
                <TableCell>{p.customer_name || '-'}</TableCell>
                <TableCell>{p.active_version_id || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  )
}


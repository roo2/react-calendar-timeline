import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

type Filters = {
  category?: string | null
  item_id?: string | null
  job_id?: string | null
  run_id?: string | null
  created_from?: string | null
  created_to?: string | null
  page?: number
  page_size?: number
}

export function InventoryTransactionsPage() {
  const [filters, setFilters] = useState<Filters>({ page: 1, page_size: 25 })
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    const f = filters
    if (f.category) p.set('category', f.category)
    if (f.item_id) p.set('item_id', f.item_id)
    if (f.job_id) p.set('job_id', f.job_id)
    if (f.run_id) p.set('run_id', f.run_id)
    if (f.created_from) p.set('created_from', f.created_from)
    if (f.created_to) p.set('created_to', f.created_to)
    p.set('page', String(f.page || 1))
    p.set('page_size', String(f.page_size || 25))
    return p.toString()
  }, [filters])

  async function load() {
    try {
      setErr(null)
      const res = await apiFetch<any>(`/api/inventory/transactions?${qs}`)
      setData(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load transactions')
    }
  }

  useEffect(() => {
    void load()
  }, [qs])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFilters((f) => ({ ...f, page: 1 }))
  }

  const page = data?.filters?.page || filters.page || 1
  const pageSize = data?.filters?.page_size || filters.page_size || 25
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Inventory Transactions
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <form onSubmit={onSubmit}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 2,
              alignItems: 'end',
            }}
          >
            <TextField
              select
              label="Category"
              value={filters.category || ''}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.currentTarget.value || null }))}
            >
              <MenuItem value="">All</MenuItem>
              {['raw_material', 'wip_extruded_roll', 'wip_printed_roll', 'finished_goods', 'packaging_material', 'scrap'].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Item ID"
              value={filters.item_id || ''}
              onChange={(e) => setFilters((f) => ({ ...f, item_id: e.currentTarget.value || null }))}
              placeholder="UUID"
            />
            <TextField
              label="Job ID"
              value={filters.job_id || ''}
              onChange={(e) => setFilters((f) => ({ ...f, job_id: e.currentTarget.value || null }))}
              placeholder="UUID"
            />
            <TextField
              label="Run ID"
              value={filters.run_id || ''}
              onChange={(e) => setFilters((f) => ({ ...f, run_id: e.currentTarget.value || null }))}
              placeholder="UUID"
            />
            <TextField
              label="Created From"
              type="datetime-local"
              value={filters.created_from || ''}
              onChange={(e) => setFilters((f) => ({ ...f, created_from: e.currentTarget.value || null }))}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Created To"
              type="datetime-local"
              value={filters.created_to || ''}
              onChange={(e) => setFilters((f) => ({ ...f, created_to: e.currentTarget.value || null }))}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Page Size"
              value={String(filters.page_size || 25)}
              onChange={(e) => setFilters((f) => ({ ...f, page_size: Number(e.currentTarget.value), page: 1 }))}
            >
              {[10, 25, 50, 100].map((sz) => (
                <MenuItem key={sz} value={String(sz)}>
                  {sz}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button type="submit" variant="outlined" size="small" sx={{ px: 2, py: 1 }}>
                Filter
              </Button>
              <Button component={Link} to="/inventory" variant="outlined" size="small" sx={{ px: 2, py: 1 }}>
                Back
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Created At</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell>UOM</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Job</TableCell>
              <TableCell>Run</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>By</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data?.items || []).map((t: any) => {
              const q = Number(t.quantity)
              return (
                <TableRow key={t.id} hover>
                  <TableCell>{t.created_at}</TableCell>
                  <TableCell>{t.category}</TableCell>
                  <TableCell align="right">{(q >= 0 ? '+' : '') + String(t.quantity)}</TableCell>
                  <TableCell>{t.uom}</TableCell>
                  <TableCell>{t.item_id || ''}</TableCell>
                  <TableCell>{t.job_id || ''}</TableCell>
                  <TableCell>{t.run_id || ''}</TableCell>
                  <TableCell>{t.reason || ''}</TableCell>
                  <TableCell>{t.created_by}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          Page {page} of {totalPages}
        </Typography>
        {page > 1 && (
          <Button size="small" variant="outlined" onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) - 1 }))}>
            Prev
          </Button>
        )}
        {page < totalPages && (
          <Button size="small" variant="outlined" onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) + 1 }))}>
            Next
          </Button>
        )}
      </Box>
    </Box>
  )
}


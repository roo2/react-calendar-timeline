import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Paper,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'

type Row = {
  id: string
  name: string
  discount_percent: number
  sort_order: number
}

export function CustomerPricingTiersAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [rows, setRows] = useState<Row[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newDiscount, setNewDiscount] = useState<number | ''>('')
  const [newSort, setNewSort] = useState<number | ''>('')

  async function load() {
    try {
      setLoadErr(null)
      setLoading(true)
      const list = await apiFetch<Row[]>('/api/admin/customer-pricing-tiers')
      setRows(Array.isArray(list) ? list : [])
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const canAdd = useMemo(
    () => !!newName.trim() && newDiscount !== '' && Number.isFinite(Number(newDiscount)) && Number(newDiscount) >= 0,
    [newName, newDiscount],
  )

  async function saveRow(id: string, patch: Partial<Pick<Row, 'name' | 'discount_percent' | 'sort_order'>>) {
    try {
      setErr(null)
      setSavingId(id)
      await apiFetch(`/api/admin/customer-pricing-tiers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  async function createRow() {
    if (!canAdd) return
    try {
      setErr(null)
      setSavingId('__new__')
      const body: { name: string; discount_percent: number; sort_order?: number } = {
        name: newName.trim(),
        discount_percent: Number(newDiscount),
      }
      if (newSort !== '' && Number.isFinite(Number(newSort))) body.sort_order = Number(newSort)
      await apiFetch('/api/admin/customer-pricing-tiers', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setNewName('')
      setNewDiscount('')
      setNewSort('')
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRow(id: string) {
    if (!(await confirmDelete('Delete this pricing tier?'))) return
    try {
      setErr(null)
      setSavingId(id)
      await apiFetch(`/api/admin/customer-pricing-tiers/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Customer pricing tiers"
        subtitle="Retail list price is the quote base. Each tier is a percent discount off that subtotal (before optional $/kg overrides)."
      />

      {loadErr ? <Alert severity="error">{loadErr}</Alert> : null}
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Add tier
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} flexWrap="wrap">
          <TextField size="small" label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} sx={{ minWidth: 200 }} />
          <TextField
            size="small"
            label="Discount %"
            type="number"
            inputProps={{ min: 0, max: 100, step: 0.01 }}
            value={newDiscount === '' ? '' : String(newDiscount)}
            onChange={(e) => {
              const v = e.target.value
              setNewDiscount(v === '' ? '' : Number(v))
            }}
            sx={{ width: 140 }}
          />
          <TextField
            size="small"
            label="Sort order"
            type="number"
            inputProps={{ step: 1 }}
            value={newSort === '' ? '' : String(newSort)}
            onChange={(e) => {
              const v = e.target.value
              setNewSort(v === '' ? '' : Number(v))
            }}
            sx={{ width: 140 }}
            helperText="Optional"
          />
          <Button variant="contained" disabled={!canAdd || savingId === '__new__'} onClick={() => void createRow()}>
            Add
          </Button>
        </Stack>
      </Paper>

      <AdminDataTable>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">Discount %</TableCell>
            <TableCell align="right">Sort</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography color="text.secondary">Loading…</Typography>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography color="text.secondary">No tiers</Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TierRow key={r.id} row={r} saving={savingId === r.id} onSave={saveRow} onDelete={deleteRow} />
            ))
          )}
        </TableBody>
      </AdminDataTable>
    </Stack>
  )
}

function TierRow(props: {
  row: Row
  saving: boolean
  onSave: (id: string, patch: Partial<Pick<Row, 'name' | 'discount_percent' | 'sort_order'>>) => void
  onDelete: (id: string) => void
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [discount, setDiscount] = useState<number>(row.discount_percent)
  const [sort, setSort] = useState<number>(row.sort_order)

  useEffect(() => {
    setName(row.name)
    setDiscount(row.discount_percent)
    setSort(row.sort_order)
  }, [row.id, row.name, row.discount_percent, row.sort_order])

  const dirty =
    name.trim() !== row.name || Number(discount) !== Number(row.discount_percent) || Number(sort) !== Number(row.sort_order)

  return (
    <TableRow>
      <TableCell sx={{ maxWidth: 280 }}>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell align="right" sx={{ width: 160 }}>
        <TextField
          size="small"
          type="number"
          inputProps={{ min: 0, max: 100, step: 0.01 }}
          value={Number.isFinite(discount) ? String(discount) : ''}
          onChange={(e) => setDiscount(Number(e.target.value))}
          sx={{ width: 140, ml: 'auto' }}
        />
      </TableCell>
      <TableCell align="right" sx={{ width: 140 }}>
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 1 }}
          value={Number.isFinite(sort) ? String(sort) : ''}
          onChange={(e) => setSort(Number(e.target.value))}
          sx={{ width: 120, ml: 'auto' }}
        />
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={!dirty || saving}
          onClick={() => onSave(row.id, { name: name.trim(), discount_percent: Number(discount), sort_order: Number(sort) })}
        >
          Save
        </Button>{' '}
        <Button size="small" color="error" variant="outlined" disabled={saving} onClick={() => void onDelete(row.id)}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  )
}

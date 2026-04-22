import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
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

type Row = { id: string; description: string; unit_price: number; active: boolean }

export function ResellProductsAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [rows, setRows] = useState<Row[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [newDesc, setNewDesc] = useState('')
  const [newPrice, setNewPrice] = useState<number | ''>('')
  const [newActive, setNewActive] = useState(true)

  async function load() {
    try {
      setLoadErr(null)
      setLoading(true)
      const list = await apiFetch<Row[]>('/api/admin/resell-products?include_inactive=true')
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

  const canAdd = useMemo(() => !!newDesc.trim() && newPrice !== '' && Number(newPrice) >= 0, [newDesc, newPrice])

  async function saveRow(id: string, patch: Partial<Pick<Row, 'description' | 'unit_price' | 'active'>>) {
    try {
      setErr(null)
      setSavingId(id)
      await apiFetch(`/api/admin/resell-products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
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
      await apiFetch('/api/admin/resell-products', {
        method: 'POST',
        body: JSON.stringify({
          description: newDesc.trim(),
          unit_price: Number(newPrice),
          active: newActive,
        }),
      })
      setNewDesc('')
      setNewPrice('')
      setNewActive(true)
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRow(id: string, description: string) {
    if (!confirmDelete(`resell product “${description.slice(0, 80)}”`)) return
    try {
      setErr(null)
      setSavingId(id)
      await apiFetch(`/api/admin/resell-products/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete (may be in use on orders)')
    } finally {
      setSavingId(null)
    }
  }

  const displayErr = err || loadErr

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Resell / supplies"
        subtitle="Non-manufactured items sold on orders (e.g. cardboard cores, pallets). Used in the order “Add product” dropdown."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && rows.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 140 }}>Unit price ($)</TableCell>
                <TableCell sx={{ width: 100 }}>Active</TableCell>
                <TableCell sx={{ width: 200 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <ResellRow
                  key={r.id}
                  row={r}
                  saving={savingId === r.id}
                  onSave={saveRow}
                  onDelete={deleteRow}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField
                    size="small"
                    fullWidth
                    label="Description"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="Price"
                    type="number"
                    inputProps={{ min: 0, step: 'any' }}
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </TableCell>
                <TableCell>
                  <FormControlLabel
                    control={<Checkbox checked={newActive} onChange={(e) => setNewActive(e.target.checked)} size="small" />}
                    label=""
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canAdd || savingId === '__new__'}
                    onClick={() => void createRow()}
                  >
                    Add
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function ResellRow(props: {
  row: Row
  saving: boolean
  onSave: (id: string, patch: Partial<Pick<Row, 'description' | 'unit_price' | 'active'>>) => void
  onDelete: (id: string, description: string) => void
}) {
  const { row, saving, onSave, onDelete } = props
  const [desc, setDesc] = useState(row.description)
  const [price, setPrice] = useState<number | ''>(row.unit_price)
  const [active, setActive] = useState(row.active)

  useEffect(() => {
    setDesc(row.description)
    setPrice(row.unit_price)
    setActive(row.active)
  }, [row.description, row.unit_price, row.active, row.id])

  const dirty = desc !== row.description || price !== row.unit_price || active !== row.active

  return (
    <TableRow>
      <TableCell>
        <TextField size="small" fullWidth value={desc} onChange={(e) => setDesc(e.target.value)} disabled={saving} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ min: 0, step: 'any' }}
          value={price}
          onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
          disabled={saving}
        />
      </TableCell>
      <TableCell>
        <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} size="small" disabled={saving} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={!dirty || saving}
          onClick={() => void onSave(row.id, { description: desc.trim(), unit_price: Number(price), active })}
        >
          Save
        </Button>{' '}
        <Button size="small" color="error" disabled={saving} onClick={() => void onDelete(row.id, row.description)}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  )
}

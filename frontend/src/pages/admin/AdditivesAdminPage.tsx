import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { adminDeleteAdditive, adminSaveAdditive, fetchAdminAdditives } from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Additive } from './types'

export function AdditivesAdminPage() {
  const dispatch = useAppDispatch()
  const { items: rows, status, error: loadErr } = useAppSelector((s) => s.adminRateCards.additives)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState<number | ''>('')

  const canCreate = useMemo(() => !!newCode.trim() && !!newName.trim() && newPrice !== '', [newCode, newName, newPrice])

  useEffect(() => {
    void dispatch(fetchAdminAdditives())
  }, [dispatch])

  const displayErr = err || loadErr

  async function saveRow(code: string, patch: Omit<Additive, 'additive_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminSaveAdditive({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save additive')
    } finally {
      setSaving(null)
    }
  }

  async function deleteRow(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`additive '${trimmed}'`)) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminDeleteAdditive(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete additive')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Additives" subtitle="Add or update additive master data." />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && rows.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <AdditiveRow key={r.additive_code} row={r} saving={saving === r.additive_code} onSave={saveRow} onDelete={deleteRow} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Price / kg" inputProps={{ inputMode: 'decimal' }} value={newPrice} onChange={(e) => setNewPrice(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreate || saving === newCode.trim()}
                    onClick={() => {
                      if (!canCreate) return
                      void saveRow(newCode, { name: newName.trim(), price_per_kg: Number(newPrice) }).then(() => {
                        setNewCode('')
                        setNewName('')
                        setNewPrice('')
                      })
                    }}
                  >
                    Add additive
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

function AdditiveRow(props: {
  row: Additive
  saving: boolean
  onSave: (code: string, patch: Omit<Additive, 'additive_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState<number | ''>(row.price_per_kg)
  const dirty = name !== row.name || price !== row.price_per_kg
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.additive_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={price} onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" variant="outlined" disabled={saving || !dirty || !name.trim() || price === ''} onClick={() => void onSave(row.additive_code, { name: name.trim(), price_per_kg: Number(price) })}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.additive_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

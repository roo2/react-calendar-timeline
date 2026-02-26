import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Additive } from './types'

export function AdditivesAdminPage() {
  const [rows, setRows] = useState<Additive[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState<number | ''>('')

  const canCreate = useMemo(() => !!newCode.trim() && !!newName.trim() && newPrice !== '', [newCode, newName, newPrice])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const res = await apiFetch<Additive[]>('/api/admin/rate-cards/additives')
        setRows(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load additives')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveRow(code: string, patch: Omit<Additive, 'additive_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSaving(trimmed)
      const saved = await apiFetch<Additive>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setRows((cur) => {
        const idx = cur.findIndex((r) => r.additive_code === saved.additive_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.additive_code.localeCompare(b.additive_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
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
      await apiFetch<void>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setRows((cur) => cur.filter((r) => r.additive_code !== trimmed))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete additive')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Additives" subtitle="Add or update additive master data." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? (
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


import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { adminDeleteColour, adminSaveColour, fetchAdminColours } from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Colour } from './types'

export function ColoursAdminPage() {
  const dispatch = useAppDispatch()
  const { items: rows, status, error: loadErr } = useAppSelector((s) => s.adminRateCards.colours)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState<number | ''>('')
  const [newShortCode, setNewShortCode] = useState('')

  const canCreate = useMemo(() => !!newCode.trim() && !!newName.trim() && newPrice !== '', [newCode, newName, newPrice])

  useEffect(() => {
    void dispatch(fetchAdminColours())
  }, [dispatch])

  const displayErr = err || loadErr

  async function saveRow(code: string, patch: Omit<Colour, 'colour_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminSaveColour({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save colour')
    } finally {
      setSaving(null)
    }
  }

  async function deleteRow(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`colour '${trimmed}'`)) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminDeleteColour(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete colour')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Colours" subtitle="Add or update colour master data." />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && rows.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Code</TableCell>
                <TableCell sx={{ width: 72 }}>Short</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <ColourRow key={r.colour_code} row={r} saving={saving === r.colour_code} onSave={saveRow} onDelete={deleteRow} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Short" value={newShortCode} onChange={(e) => setNewShortCode((e.target.value || '').slice(0, 3))} inputProps={{ maxLength: 3 }} placeholder="3" />
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
                      void saveRow(newCode, {
                        name: newName.trim(),
                        price_per_kg: Number(newPrice),
                        sort_order: rows.length,
                        short_code: newShortCode.trim() || null,
                      }).then(() => {
                        setNewCode('')
                        setNewName('')
                        setNewPrice('')
                        setNewShortCode('')
                      })
                    }}
                  >
                    Add colour
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

function ColourRow(props: {
  row: Colour
  saving: boolean
  onSave: (code: string, patch: Omit<Colour, 'colour_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState<number | ''>(row.price_per_kg)
  const [shortCode, setShortCode] = useState(row.short_code ?? '')
  useEffect(() => {
    setName(row.name)
    setPrice(row.price_per_kg)
    setShortCode(row.short_code ?? '')
  }, [row.name, row.price_per_kg, row.short_code])
  const dirty = name !== row.name || price !== row.price_per_kg || shortCode !== (row.short_code ?? '')
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.colour_code}</TableCell>
      <TableCell>
        <TextField size="small" sx={{ width: 72 }} value={shortCode} onChange={(e) => setShortCode((e.target.value || '').slice(0, 3))} inputProps={{ maxLength: 3 }} />
      </TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={price} onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || price === ''}
            onClick={() => void onSave(row.colour_code, { name: name.trim(), price_per_kg: Number(price), sort_order: row.sort_order, short_code: shortCode.trim() || null })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.colour_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

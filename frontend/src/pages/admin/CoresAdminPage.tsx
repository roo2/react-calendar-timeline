import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Core } from './types'

export function CoresAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [rows, setRows] = useState<Core[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newType, setNewType] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCostPerM, setNewCostPerM] = useState<number | ''>('')
  const [newKgPerM, setNewKgPerM] = useState<number | ''>('')

  const canCreate = useMemo(() => !!newType.trim() && newCostPerM !== '' && newKgPerM !== '', [newCostPerM, newKgPerM, newType])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const res = await apiFetch<Core[]>('/api/admin/rate-cards/cores')
        setRows(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load cores')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveRow(coreType: string, patch: Omit<Core, 'core_type'>) {
    const trimmed = coreType.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSaving(trimmed)
      const saved = await apiFetch<Core>(`/api/admin/rate-cards/cores/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setRows((cur) => {
        const idx = cur.findIndex((r) => r.core_type === saved.core_type)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.core_type.localeCompare(b.core_type))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save core')
    } finally {
      setSaving(null)
    }
  }

  async function deleteRow(coreType: string) {
    const trimmed = coreType.trim()
    if (!trimmed) return
    if (!confirmDelete(`core '${trimmed}'`)) return
    try {
      setErr(null)
      setSaving(trimmed)
      await apiFetch<void>(`/api/admin/rate-cards/cores/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setRows((cur) => cur.filter((r) => r.core_type !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete core')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Cores" subtitle="Core types used for roll estimating." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 140 }}>Core type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 160 }}>Cost / m</TableCell>
                <TableCell sx={{ width: 160 }}>kg / m</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <CoreRow key={r.core_type} row={r} saving={saving === r.core_type} onSave={saveRow} onDelete={deleteRow} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Core type" value={newType} onChange={(e) => setNewType(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Cost / m" inputProps={{ inputMode: 'decimal' }} value={newCostPerM} onChange={(e) => setNewCostPerM(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="kg / m" inputProps={{ inputMode: 'decimal' }} value={newKgPerM} onChange={(e) => setNewKgPerM(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreate || saving === newType.trim()}
                    onClick={() => {
                      if (!canCreate) return
                      void saveRow(newType, {
                        description: newDesc.trim() || null,
                        cost_per_meter: Number(newCostPerM),
                        kg_per_meter: Number(newKgPerM),
                      }).then(() => {
                        setNewType('')
                        setNewDesc('')
                        setNewCostPerM('')
                        setNewKgPerM('')
                      })
                    }}
                  >
                    Add core
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

function CoreRow(props: {
  row: Core
  saving: boolean
  onSave: (coreType: string, patch: Omit<Core, 'core_type'>) => Promise<void>
  onDelete: (coreType: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [desc, setDesc] = useState(row.description || '')
  const [cost, setCost] = useState<number | ''>(row.cost_per_meter)
  const [kg, setKg] = useState<number | ''>(row.kg_per_meter)
  const dirty = desc !== (row.description || '') || cost !== row.cost_per_meter || kg !== row.kg_per_meter
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.core_type}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={desc} onChange={(e) => setDesc(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={cost} onChange={(e) => setCost(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={kg} onChange={(e) => setKg(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || cost === '' || kg === ''}
            onClick={() =>
              void onSave(row.core_type, {
                description: desc.trim() || null,
                cost_per_meter: Number(cost),
                kg_per_meter: Number(kg),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.core_type)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}


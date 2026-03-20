import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Link as MuiLink, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Anilox } from './types'

export function AniloxAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [rows, setRows] = useState<Anilox[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const canCreate = useMemo(() => !!newCode.trim() && !!newDescription.trim(), [newCode, newDescription])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const res = await apiFetch<Anilox[]>('/api/admin/rate-cards/anilox')
        setRows(Array.isArray(res) ? res : [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load anilox')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveRow(code: string, patch: Omit<Anilox, 'anilox_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`anilox:${trimmed}`)
      const saved = await apiFetch<Anilox>(`/api/admin/rate-cards/anilox/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setRows((cur) => {
        const idx = cur.findIndex((r) => r.anilox_code === saved.anilox_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.anilox_code.localeCompare(b.anilox_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save anilox')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteRow(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`anilox '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingKey(`anilox:${trimmed}`)
      await apiFetch<void>(`/api/admin/rate-cards/anilox/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setRows((cur) => cur.filter((r) => r.anilox_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete anilox')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Anilox (Uteco)"
        subtitle="Master list for Uteco printing specs: code and description (used in product spec dropdown)."
      />
      <Typography variant="body2">
        <MuiLink component={Link} to="/admin/printing" underline="hover">
          ← Back to Printing
        </MuiLink>
      </Typography>
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 200 }}>Code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <AniloxRow key={r.anilox_code} row={r} saving={savingKey === `anilox:${r.anilox_code}`} onSave={saveRow} onDelete={deleteRow} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreate || savingKey === `anilox:${newCode.trim()}`}
                    onClick={() => {
                      if (!canCreate) return
                      void saveRow(newCode, { description: newDescription.trim() }).then(() => {
                        setNewCode('')
                        setNewDescription('')
                      })
                    }}
                  >
                    Add anilox
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

function AniloxRow(props: {
  row: Anilox
  saving: boolean
  onSave: (code: string, patch: Omit<Anilox, 'anilox_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [description, setDescription] = useState(row.description)
  const dirty = description !== row.description
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.anilox_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={description} onChange={(e) => setDescription(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" variant="outlined" disabled={saving || !dirty || !description.trim()} onClick={() => void onSave(row.anilox_code, { description: description.trim() })}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.anilox_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

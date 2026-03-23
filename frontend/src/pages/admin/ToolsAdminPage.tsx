import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
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

type ToolTypeRow = {
  id: string
  code: string
  name: string
  unique_per_machine: boolean
}

type ToolRow = {
  id: string
  tool_type_id: string
  tool_type_code: string
  serial_code: string
  active: boolean
  notes: string | null
}

export function ToolsAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<ToolTypeRow[]>([])
  const [tools, setTools] = useState<ToolRow[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  const [newTypeId, setNewTypeId] = useState('')
  const [newSerial, setNewSerial] = useState('')
  const [newNotes, setNewNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch<{ tool_types: ToolTypeRow[]; tools: ToolRow[] }>('/api/admin/tools/bootstrap')
      setTypes(res.tool_types || [])
      setTools(res.tools || [])
      setNewTypeId((prev) => prev || (res.tool_types?.[0]?.id ?? ''))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load tools')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveTool(id: string, patch: Partial<Pick<ToolRow, 'serial_code' | 'active' | 'notes'>>) {
    setSaving(id)
    setErr(null)
    try {
      await apiFetch(`/api/admin/tools/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  async function addTool() {
    if (!newTypeId.trim() || !newSerial.trim()) {
      setErr('Select a tool type and enter a serial code.')
      return
    }
    setSaving('new')
    setErr(null)
    try {
      await apiFetch('/api/admin/tools', {
        method: 'POST',
        body: JSON.stringify({
          tool_type_id: newTypeId,
          serial_code: newSerial.trim(),
          active: true,
          notes: newNotes.trim() || null,
        }),
      })
      setNewSerial('')
      setNewNotes('')
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(null)
    }
  }

  async function removeTool(id: string, serial: string) {
    if (!confirmDelete(`tool '${serial}'`)) return
    setSaving(id)
    setErr(null)
    try {
      await apiFetch(`/api/admin/tools/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Tools"
        subtitle="Physical tool pool for scheduling (inline print, perforation, hole punch, etc.). Add one row per device; inactive tools are excluded from availability."
      />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Tool types (reference)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Types are defined in the database / migrations (e.g. inline_printer_1c, inline_perforator, inline_hole_punch,
          electra_punch). Register physical units below.
        </Typography>
        {loading && types.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={0.5}>
            {types.map((t) => (
              <Typography key={t.id} variant="body2">
                <strong>{t.code}</strong> — {t.name}
              </Typography>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Physical tools
        </Typography>
        {loading && tools.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 200 }}>Type</TableCell>
                <TableCell sx={{ width: 180 }}>Serial</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell sx={{ width: 100 }}>Active</TableCell>
                <TableCell sx={{ width: 200 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {tools.map((r) => (
                <ToolEditRow
                  key={r.id}
                  row={r}
                  saving={saving === r.id}
                  onSave={saveTool}
                  onDelete={removeTool}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    fullWidth
                    label="Type"
                    value={newTypeId}
                    onChange={(e) => setNewTypeId(e.target.value)}
                  >
                    {types.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.code}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Serial" value={newSerial} onChange={(e) => setNewSerial(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Notes" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
                </TableCell>
                <TableCell />
                <TableCell align="right">
                  <Button size="small" variant="contained" disabled={saving === 'new'} onClick={() => void addTool()}>
                    Add tool
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

function ToolEditRow({
  row,
  saving,
  onSave,
  onDelete,
}: {
  row: ToolRow
  saving: boolean
  onSave: (id: string, patch: Partial<Pick<ToolRow, 'serial_code' | 'active' | 'notes'>>) => void
  onDelete: (id: string, serial: string) => void
}) {
  const [serial, setSerial] = useState(row.serial_code)
  const [notes, setNotes] = useState(row.notes ?? '')
  const [active, setActive] = useState(row.active)

  useEffect(() => {
    setSerial(row.serial_code)
    setNotes(row.notes ?? '')
    setActive(row.active)
  }, [row.serial_code, row.notes, row.active])

  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2">{row.tool_type_code || '—'}</Typography>
      </TableCell>
      <TableCell>
        <TextField size="small" value={serial} onChange={(e) => setSerial(e.target.value)} fullWidth />
      </TableCell>
      <TableCell>
        <TextField size="small" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />
      </TableCell>
      <TableCell>
        <FormControlLabel control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />} label="" />
      </TableCell>
      <TableCell align="right">
        <Button size="small" disabled={saving} onClick={() => onSave(row.id, { serial_code: serial, notes, active })}>
          Save
        </Button>{' '}
        <Button size="small" color="warning" disabled={saving} onClick={() => onDelete(row.id, row.serial_code)}>
          Deactivate
        </Button>
      </TableCell>
    </TableRow>
  )
}

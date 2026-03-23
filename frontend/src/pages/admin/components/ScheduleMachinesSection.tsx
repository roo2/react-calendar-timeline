import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ApiError, apiFetch } from '../../../api/client'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './AdminDataTable'

export type ScheduleMachineType = 'extruder' | 'printer_uteco' | 'converter_bagger'

export type ScheduleMachine = {
  id: string
  code: string
  machine_type: string
  capability: Record<string, unknown>
  active: boolean
}

/** Defaults aligned with DB seed (`0003_views_and_seeds`); edit JSON per site as needed. */
export const SCHEDULE_CAPABILITY_DEFAULTS: Record<ScheduleMachineType, Record<string, unknown>> = {
  extruder: {
    supports_inline_1c_print: true,
    supports_inline_perforation: true,
    width_range_mm: [100, 2000],
    gauge_range_um: [25, 200],
  },
  printer_uteco: {
    max_colours_per_side: 6,
    duplex_supported: true,
    max_web_width_mm: 1600,
  },
  converter_bagger: {
    supported_finish_modes: ['Cartons'],
    min_max_width_mm: [150, 800],
  },
}

type Props = {
  machineType: ScheduleMachineType
  title: string
  description: React.ReactNode
  /** Used when adding a new schedule lane. */
  defaultCapability: Record<string, unknown>
  /** Shown below the table (per–machine-type guidance). */
  footerHint?: React.ReactNode
}

function capabilityJsonString(cap: Record<string, unknown>) {
  return JSON.stringify(cap, null, 2)
}

function ScheduleMachineRow({
  machine,
  saving,
  onSave,
}: {
  machine: ScheduleMachine
  saving: boolean
  onSave: (id: string, patch: { code?: string; capability: Record<string, unknown>; active: boolean }) => Promise<void>
}) {
  const [code, setCode] = useState(machine.code)
  const [capJson, setCapJson] = useState(() => capabilityJsonString(machine.capability))
  const [active, setActive] = useState(machine.active)
  const [localErr, setLocalErr] = useState<string | null>(null)

  useEffect(() => {
    setCode(machine.code)
    setCapJson(capabilityJsonString(machine.capability))
    setActive(machine.active)
  }, [machine])

  const dirty =
    code !== machine.code || capJson !== capabilityJsonString(machine.capability) || active !== machine.active

  const handleSave = async () => {
    setLocalErr(null)
    let capability: Record<string, unknown>
    try {
      const parsed = JSON.parse(capJson) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setLocalErr('Capability must be a JSON object.')
        return
      }
      capability = parsed as Record<string, unknown>
    } catch {
      setLocalErr('Invalid JSON in capability.')
      return
    }
    try {
      await onSave(machine.id, { code: code !== machine.code ? code : undefined, capability, active })
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <TableRow>
      <TableCell sx={{ verticalAlign: 'top' }}>
        <TextField size="small" label="Code" value={code} onChange={(e) => setCode(e.target.value)} fullWidth />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 280 }}>
        <TextField
          size="small"
          label="Capability (JSON)"
          value={capJson}
          onChange={(e) => setCapJson(e.target.value)}
          multiline
          minRows={4}
          fullWidth
          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
        />
        {localErr ? (
          <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
            {localErr}
          </Typography>
        ) : null}
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top' }}>
        <FormControlLabel control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Active" />
      </TableCell>
      <TableCell align="right" sx={{ verticalAlign: 'top' }}>
        <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function ScheduleMachinesSection({
  machineType,
  title,
  description,
  defaultCapability,
  footerHint,
}: Props) {
  const { setDirty } = useUnsavedChanges()
  const [items, setItems] = useState<ScheduleMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newCapJson, setNewCapJson] = useState(() => capabilityJsonString(defaultCapability))
  const [newActive, setNewActive] = useState(true)
  const [addErr, setAddErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const rows = await apiFetch<ScheduleMachine[]>(`/api/admin/machines?machine_type=${encodeURIComponent(machineType)}`)
      setItems(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load machines')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [machineType])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setNewCapJson(capabilityJsonString(defaultCapability))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset add-form defaults when section type changes only
  }, [machineType])

  const canAdd = useMemo(() => newCode.trim().length > 0, [newCode])

  const saveRow = async (
    id: string,
    patch: { code?: string; capability: Record<string, unknown>; active: boolean },
  ) => {
    setSavingId(id)
    setErr(null)
    try {
      const body: Record<string, unknown> = { capability: patch.capability, active: patch.active }
      if (patch.code != null) body.code = patch.code
      const updated = await apiFetch<ScheduleMachine>(`/api/admin/machines/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setItems((prev) => prev.map((m) => (m.id === id ? updated : m)))
      setDirty(false)
    } finally {
      setSavingId(null)
    }
  }

  const addMachine = async () => {
    setAddErr(null)
    let capability: Record<string, unknown>
    try {
      const parsed = JSON.parse(newCapJson) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setAddErr('Capability must be a JSON object.')
        return
      }
      capability = parsed as Record<string, unknown>
    } catch {
      setAddErr('Invalid JSON in capability.')
      return
    }
    setSavingId('__new__')
    setErr(null)
    try {
      const created = await apiFetch<ScheduleMachine>('/api/admin/machines', {
        method: 'POST',
        body: JSON.stringify({
          code: newCode.trim(),
          machine_type: machineType,
          capability,
          active: newActive,
        }),
      })
      setItems((prev) => [...prev, created].sort((a, b) => a.code.localeCompare(b.code)))
      setNewCode('')
      setNewCapJson(capabilityJsonString(defaultCapability))
      setNewActive(true)
      setDirty(false)
    } catch (e) {
      setAddErr(e instanceof ApiError ? e.message : 'Failed to add machine')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}
      {loading && items.length === 0 ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <AdminDataTable>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 160 }}>Code</TableCell>
              <TableCell>Capability (JSON)</TableCell>
              <TableCell sx={{ width: 120 }}>Active</TableCell>
              <TableCell align="right" sx={{ width: 100 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((m) => (
              <ScheduleMachineRow key={m.id} machine={m} saving={savingId === m.id} onSave={saveRow} />
            ))}
            <TableRow>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <TextField
                  size="small"
                  label="New code"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  fullWidth
                />
              </TableCell>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <TextField
                  size="small"
                  label="Capability (JSON)"
                  value={newCapJson}
                  onChange={(e) => setNewCapJson(e.target.value)}
                  multiline
                  minRows={4}
                  fullWidth
                  sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
                />
                {addErr ? (
                  <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                    {addErr}
                  </Typography>
                ) : null}
              </TableCell>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <FormControlLabel
                  control={<Checkbox checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />}
                  label="Active"
                />
              </TableCell>
              <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!canAdd || savingId === '__new__'}
                  onClick={() => void addMachine()}
                >
                  Add
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </AdminDataTable>
      )}
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          {footerHint ?? (
            <>
              Inactive machines are hidden from the production schedule. Codes must be unique. Changing a code is blocked if
              the machine already has queue history.
            </>
          )}
        </Typography>
      </Box>
    </Paper>
  )
}

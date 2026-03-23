import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminDeleteExtruder,
  adminSaveExtruder,
  adminSaveExtrusionWasteFactor,
  fetchAdminExtrusionTab,
} from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import { ScheduleMachinesSection, SCHEDULE_CAPABILITY_DEFAULTS } from './components/ScheduleMachinesSection'
import type { Extruder, ExtrusionWasteFactor } from './types'

export function ExtrusionAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const extruders = useAppSelector((s) => s.adminRateCards.extruders.items)
  const wasteFactors = useAppSelector((s) => s.adminRateCards.extrusionWasteFactors.items)
  const { status, error: tabErr } = useAppSelector((s) => s.adminRateCards.extrusionTab)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newExtruderCode, setNewExtruderCode] = useState('')
  const [newExtruderModel, setNewExtruderModel] = useState('')
  const [newExtruderWMin, setNewExtruderWMin] = useState<number | ''>('')
  const [newExtruderWMax, setNewExtruderWMax] = useState<number | ''>('')
  const [newExtruderDecisionW, setNewExtruderDecisionW] = useState<number | ''>('')
  const [newExtruderAvgKgHr, setNewExtruderAvgKgHr] = useState<number | ''>('')
  const [newExtruderAveWidth, setNewExtruderAveWidth] = useState<number | ''>('')
  const [newExtruderCostPerHr, setNewExtruderCostPerHr] = useState<number | ''>('')

  const canCreateExtruder = useMemo(() => !!newExtruderCode.trim(), [newExtruderCode])

  useEffect(() => {
    void dispatch(fetchAdminExtrusionTab())
  }, [dispatch])

  const displayErr = err || tabErr

  async function saveExtruder(code: string, patch: Omit<Extruder, 'extruder_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`extruder:${trimmed}`)
      await dispatch(adminSaveExtruder({ code: trimmed, patch })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save extruder')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteExtruder(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`extruder '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingKey(`extruder:${trimmed}`)
      await dispatch(adminDeleteExtruder(trimmed)).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete extruder')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveWasteFactor(factor: string, patch: Omit<ExtrusionWasteFactor, 'factor'>) {
    const trimmed = factor.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`wf:${trimmed}`)
      await dispatch(adminSaveExtrusionWasteFactor({ factor: trimmed, patch })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save waste factor')
    } finally {
      setSavingKey(null)
    }
  }

  /** Match ratebook + schedule: decision width ascending, null/missing width last, then code. */
  const extrudersSorted = useMemo(() => {
    return (extruders || [])
      .slice()
      .sort((a, b) => {
        const aw = a.decision_width_mm
        const bw = b.decision_width_mm
        if (aw == null && bw == null) return a.extruder_code.localeCompare(b.extruder_code)
        if (aw == null) return 1
        if (bw == null) return -1
        if (aw !== bw) return aw - bw
        return a.extruder_code.localeCompare(b.extruder_code)
      })
  }, [extruders])

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Extrusion"
        subtitle="Extruder rate cards (quotes & kg/hr), production schedule lanes, and extrusion waste factors."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <ScheduleMachinesSection
        machineType="extruder"
        title="Production schedule — extruders"
        description={
          <>
            These are the extruder <strong>lanes</strong> on the Schedule board. Use the <strong>same code</strong> as a row in
            the extruder rate table below so run-time estimates use that machine&apos;s <strong>kg/hr</strong> and capability
            checks match.
          </>
        }
        defaultCapability={SCHEDULE_CAPABILITY_DEFAULTS.extruder}
        footerHint={
          <>
            Inactive extruders are hidden from the schedule. Codes must be unique. For kg/hr, the schedule matches{' '}
            <code>machines.code</code> to <code>extruders.extruder_code</code>. You cannot rename a code if that lane already
            has queue items.
          </>
        }
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Extruder rate cards (quotes & throughput)
        </Typography>
        {loading && extruders.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 140 }}>Code</TableCell>
                <TableCell sx={{ width: 220 }}>Model</TableCell>
                <TableCell sx={{ width: 120 }}>W min</TableCell>
                <TableCell sx={{ width: 120 }}>W max</TableCell>
                <TableCell sx={{ width: 140 }}>Decision Width</TableCell>
                <TableCell sx={{ width: 140 }}>Avg (kg/hr)</TableCell>
                <TableCell sx={{ width: 120 }}>Ave width</TableCell>
                <TableCell sx={{ width: 100 }}>Cost/hr ($)</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {extrudersSorted.map((r) => (
                <ExtruderRow
                  key={r.extruder_code}
                  row={r}
                  saving={savingKey === `extruder:${r.extruder_code}`}
                  onSave={saveExtruder}
                  onDelete={deleteExtruder}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newExtruderCode} onChange={(e) => setNewExtruderCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Model" value={newExtruderModel} onChange={(e) => setNewExtruderModel(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={newExtruderWMin} onChange={(e) => setNewExtruderWMin(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={newExtruderWMax} onChange={(e) => setNewExtruderWMax(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={newExtruderDecisionW} onChange={(e) => setNewExtruderDecisionW(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={newExtruderAvgKgHr} onChange={(e) => setNewExtruderAvgKgHr(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={newExtruderAveWidth} onChange={(e) => setNewExtruderAveWidth(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }} value={newExtruderCostPerHr} onChange={(e) => setNewExtruderCostPerHr(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateExtruder || savingKey === `extruder:${newExtruderCode.trim()}`}
                    onClick={() => {
                      if (!canCreateExtruder) return
                      void saveExtruder(newExtruderCode, {
                        model: newExtruderModel.trim() || null,
                        film_width_min_mm: newExtruderWMin === '' ? null : Number(newExtruderWMin),
                        film_width_max_mm: newExtruderWMax === '' ? null : Number(newExtruderWMax),
                        decision_width_mm: newExtruderDecisionW === '' ? null : Number(newExtruderDecisionW),
                        average_kg_hr: newExtruderAvgKgHr === '' ? null : Number(newExtruderAvgKgHr),
                        ave_width: newExtruderAveWidth === '' ? null : Number(newExtruderAveWidth),
                        cost_per_hr: newExtruderCostPerHr === '' ? null : Number(newExtruderCostPerHr),
                      }).then(() => {
                        setNewExtruderCode('')
                        setNewExtruderModel('')
                        setNewExtruderWMin('')
                        setNewExtruderWMax('')
                        setNewExtruderDecisionW('')
                        setNewExtruderAvgKgHr('')
                        setNewExtruderAveWidth('')
                        setNewExtruderCostPerHr('')
                      })
                    }}
                  >
                    Add extruder
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Extrusion waste factors
        </Typography>
        {loading && wasteFactors.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell>Factor</TableCell>
                <TableCell sx={{ width: 160 }}>Minutes</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {wasteFactors.map((r) => (
                <WasteFactorRow
                  key={r.factor}
                  row={r}
                  saving={savingKey === `wf:${r.factor}`}
                  onSave={saveWasteFactor}
                />
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function ExtruderRow(props: {
  row: Extruder
  saving: boolean
  onSave: (code: string, patch: Omit<Extruder, 'extruder_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [model, setModel] = useState(row.model || '')
  const [wMin, setWMin] = useState<number | ''>(row.film_width_min_mm ?? '')
  const [wMax, setWMax] = useState<number | ''>(row.film_width_max_mm ?? '')
  const [decisionW, setDecisionW] = useState<number | ''>(row.decision_width_mm ?? '')
  const [avgKgHr, setAvgKgHr] = useState<number | ''>(row.average_kg_hr ?? '')
  const [aveWidth, setAveWidth] = useState<number | ''>(row.ave_width ?? '')
  const [costPerHr, setCostPerHr] = useState<number | ''>(row.cost_per_hr ?? '')
  useEffect(() => {
    setModel(row.model || '')
    setWMin(row.film_width_min_mm ?? '')
    setWMax(row.film_width_max_mm ?? '')
    setDecisionW(row.decision_width_mm ?? '')
    setAvgKgHr(row.average_kg_hr ?? '')
    setAveWidth(row.ave_width ?? '')
    setCostPerHr(row.cost_per_hr ?? '')
  }, [row.model, row.film_width_min_mm, row.film_width_max_mm, row.decision_width_mm, row.average_kg_hr, row.ave_width, row.cost_per_hr])

  const dirty =
    model !== (row.model || '') ||
    wMin !== (row.film_width_min_mm ?? '') ||
    wMax !== (row.film_width_max_mm ?? '') ||
    decisionW !== (row.decision_width_mm ?? '') ||
    avgKgHr !== (row.average_kg_hr ?? '') ||
    aveWidth !== (row.ave_width ?? '') ||
    costPerHr !== (row.cost_per_hr ?? '')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.extruder_code}</TableCell>
      <TableCell>
        <TextField size="small" value={model} onChange={(e) => setModel(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={wMin} onChange={(e) => setWMin(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={wMax} onChange={(e) => setWMax(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={decisionW} onChange={(e) => setDecisionW(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={avgKgHr} onChange={(e) => setAvgKgHr(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={aveWidth} onChange={(e) => setAveWidth(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }} value={costPerHr} onChange={(e) => setCostPerHr(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty}
            onClick={() =>
              void onSave(row.extruder_code, {
                model: model.trim() || null,
                film_width_min_mm: wMin === '' ? null : Number(wMin),
                film_width_max_mm: wMax === '' ? null : Number(wMax),
                decision_width_mm: decisionW === '' ? null : Number(decisionW),
                average_kg_hr: avgKgHr === '' ? null : Number(avgKgHr),
                ave_width: aveWidth === '' ? null : Number(aveWidth),
                cost_per_hr: costPerHr === '' ? null : Number(costPerHr),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.extruder_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function WasteFactorRow(props: {
  row: ExtrusionWasteFactor
  saving: boolean
  onSave: (factor: string, patch: Omit<ExtrusionWasteFactor, 'factor'>) => Promise<void>
}) {
  const { row, saving, onSave } = props
  const [minutes, setMinutes] = useState<number | ''>(row.minutes)
  const dirty = minutes !== row.minutes
  return (
    <TableRow hover>
      <TableCell>{row.factor}</TableCell>
      <TableCell>
        <TextField size="small" label="Minutes" inputProps={{ inputMode: 'numeric' }} value={minutes} onChange={(e) => setMinutes(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" variant="outlined" disabled={saving || !dirty || minutes === ''} onClick={() => void onSave(row.factor, { minutes: Number(minutes) })}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}


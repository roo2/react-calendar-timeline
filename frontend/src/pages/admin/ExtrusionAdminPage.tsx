import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Extruder, ExtrusionWasteFactor } from './types'

export function ExtrusionAdminPage() {
  const [extruders, setExtruders] = useState<Extruder[]>([])
  const [wasteFactors, setWasteFactors] = useState<ExtrusionWasteFactor[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newExtruderCode, setNewExtruderCode] = useState('')
  const [newExtruderModel, setNewExtruderModel] = useState('')
  const [newExtruderWMin, setNewExtruderWMin] = useState<number | ''>('')
  const [newExtruderWMax, setNewExtruderWMax] = useState<number | ''>('')
  const [newExtruderDecisionW, setNewExtruderDecisionW] = useState<number | ''>('')
  const [newExtruderAvgKgHr, setNewExtruderAvgKgHr] = useState<number | ''>('')
  const [newExtruderAveWidth, setNewExtruderAveWidth] = useState<number | ''>('')

  const canCreateExtruder = useMemo(() => !!newExtruderCode.trim(), [newExtruderCode])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const [ex, wf] = await Promise.all([
          apiFetch<Extruder[]>('/api/admin/rate-cards/extruders'),
          apiFetch<ExtrusionWasteFactor[]>('/api/admin/rate-cards/extrusion-waste-factors'),
        ])
        setExtruders(ex)
        setWasteFactors(wf)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load extrusion admin data')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveExtruder(code: string, patch: Omit<Extruder, 'extruder_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`extruder:${trimmed}`)
      const saved = await apiFetch<Extruder>(`/api/admin/rate-cards/extruders/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setExtruders((cur) => {
        const idx = cur.findIndex((r) => r.extruder_code === saved.extruder_code)
        if (idx === -1) return [...cur, saved]
        const next = cur.slice()
        next[idx] = saved
        return next
      })
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
      await apiFetch<void>(`/api/admin/rate-cards/extruders/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setExtruders((cur) => cur.filter((r) => r.extruder_code !== trimmed))
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
      const saved = await apiFetch<ExtrusionWasteFactor>(`/api/admin/rate-cards/extrusion-waste-factors/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setWasteFactors((cur) => {
        const idx = cur.findIndex((r) => r.factor === saved.factor)
        if (idx === -1) return [...cur, saved]
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save waste factor')
    } finally {
      setSavingKey(null)
    }
  }

  const extrudersSorted = useMemo(() => {
    return (extruders || []).slice().sort((a, b) => Number(b.decision_width_mm || 0) - Number(a.decision_width_mm || 0))
  }, [extruders])

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Extrusion" subtitle="Extruders and extrusion waste factors (minutes)." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Extruders
        </Typography>
        {loading ? (
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
                      }).then(() => {
                        setNewExtruderCode('')
                        setNewExtruderModel('')
                        setNewExtruderWMin('')
                        setNewExtruderWMax('')
                        setNewExtruderDecisionW('')
                        setNewExtruderAvgKgHr('')
                        setNewExtruderAveWidth('')
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
        {loading ? (
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

  const dirty =
    model !== (row.model || '') ||
    wMin !== (row.film_width_min_mm ?? '') ||
    wMax !== (row.film_width_max_mm ?? '') ||
    decisionW !== (row.decision_width_mm ?? '') ||
    avgKgHr !== (row.average_kg_hr ?? '') ||
    aveWidth !== (row.ave_width ?? '')

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


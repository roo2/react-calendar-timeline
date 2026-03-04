import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'

type ConversionSpeed = {
  min_gauge_um: number
  max_gauge_um: number
  min_length_mm: number
  max_length_mm: number
  bags_per_minute: number
}

type ConversionFactor = {
  slug: string
  name: string
  value: number
}

type CartonOption = {
  slug: string
  name: string
  cost_per_unit: number
  is_default: boolean
}

type GaugeRange = { min_gauge_um: number; max_gauge_um: number }
type LengthRange = { min_length_mm: number; max_length_mm: number }

function gaugeKey(g: GaugeRange) {
  return `${g.min_gauge_um}-${g.max_gauge_um}`
}

function lengthKey(l: LengthRange) {
  return `${l.min_length_mm}-${l.max_length_mm}`
}

function speedKey(s: Pick<ConversionSpeed, 'min_gauge_um' | 'max_gauge_um' | 'min_length_mm' | 'max_length_mm'>) {
  return `${gaugeKey(s)}:${lengthKey(s)}`
}

export function ConversionAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [speeds, setSpeeds] = useState<ConversionSpeed[]>([])
  const [factors, setFactors] = useState<ConversionFactor[]>([])
  const [cartonOptions, setCartonOptions] = useState<CartonOption[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [speedSavedFlash, setSpeedSavedFlash] = useState(false)
  const speedSavedTimerRef = useRef<number | null>(null)

  const gaugeRanges: GaugeRange[] = useMemo(() => {
    const m = new Map<string, GaugeRange>()
    for (const s of speeds || []) {
      const g = { min_gauge_um: Number(s.min_gauge_um || 0), max_gauge_um: Number(s.max_gauge_um || 0) }
      m.set(gaugeKey(g), g)
    }
    return Array.from(m.values()).sort((a, b) => a.min_gauge_um - b.min_gauge_um || a.max_gauge_um - b.max_gauge_um)
  }, [speeds])

  const lengthRanges: LengthRange[] = useMemo(() => {
    const m = new Map<string, LengthRange>()
    for (const s of speeds || []) {
      const l = { min_length_mm: Number(s.min_length_mm || 0), max_length_mm: Number(s.max_length_mm || 0) }
      m.set(lengthKey(l), l)
    }
    return Array.from(m.values()).sort((a, b) => a.min_length_mm - b.min_length_mm || a.max_length_mm - b.max_length_mm)
  }, [speeds])

  const speedByKey: Map<string, ConversionSpeed> = useMemo(() => {
    const m = new Map<string, ConversionSpeed>()
    for (const s of speeds || []) m.set(speedKey(s), s)
    return m
  }, [speeds])

  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const s of speeds || []) next[speedKey(s)] = String(s.bags_per_minute)
    setCellDrafts(next)
  }, [speeds])

  useEffect(() => {
    return () => {
      if (speedSavedTimerRef.current != null) window.clearTimeout(speedSavedTimerRef.current)
    }
  }, [])

  const factorsSorted = useMemo(() => {
    return (factors || []).slice().sort((a, b) => a.slug.localeCompare(b.slug))
  }, [factors])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const [s, f, co] = await Promise.all([
          apiFetch<ConversionSpeed[]>('/api/admin/rate-cards/conversion-speeds'),
          apiFetch<ConversionFactor[]>('/api/admin/rate-cards/conversion-factors'),
          apiFetch<CartonOption[]>('/api/admin/rate-cards/carton-options'),
        ])
        setSpeeds(Array.isArray(s) ? s : [])
        setFactors(Array.isArray(f) ? f : [])
        setCartonOptions(Array.isArray(co) ? co : [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load conversion admin data')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveSpeed(
    key: Pick<ConversionSpeed, 'min_gauge_um' | 'max_gauge_um' | 'min_length_mm' | 'max_length_mm'>,
    patch: Pick<ConversionSpeed, 'bags_per_minute'>,
  ) {
    const k = `speed:${speedKey(key)}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<ConversionSpeed>(
        `/api/admin/rate-cards/conversion-speeds/${encodeURIComponent(String(key.min_gauge_um))}/${encodeURIComponent(
          String(key.max_gauge_um),
        )}/${encodeURIComponent(String(key.min_length_mm))}/${encodeURIComponent(String(key.max_length_mm))}`,
        { method: 'PUT', body: JSON.stringify(patch) },
      )
      setSpeeds((cur) => {
        const idx = cur.findIndex((s) => speedKey(s) === speedKey(saved))
        if (idx === -1) return [...cur, saved]
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      if (speedSavedTimerRef.current != null) window.clearTimeout(speedSavedTimerRef.current)
      setSpeedSavedFlash(true)
      speedSavedTimerRef.current = window.setTimeout(() => setSpeedSavedFlash(false), 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save conversion speed')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveCartonOption(slug: string, patch: Pick<CartonOption, 'name' | 'cost_per_unit'>) {
    const k = `carton:${slug}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<CartonOption>(`/api/admin/rate-cards/carton-options/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...patch, is_default: cartonOptions.find((c) => c.slug === slug)?.is_default ?? false }),
      })
      setCartonOptions((cur) => cur.map((c) => (c.slug === slug ? saved : c)))
      setDirty(false)
    } finally {
      setSavingKey(null)
    }
  }

  async function setDefaultCartonOption(slug: string) {
    const k = `carton-default:${slug}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<CartonOption>(`/api/admin/rate-cards/carton-options/${encodeURIComponent(slug)}/set-default`, {
        method: 'POST',
      })
      setCartonOptions((cur) => cur.map((c) => (c.slug === slug ? saved : { ...c, is_default: false })))
      setDirty(false)
    } finally {
      setSavingKey(null)
    }
  }

  async function saveFactor(slug: string, patch: Pick<ConversionFactor, 'name' | 'value'>) {
    const s = slug.trim()
    if (!s) return
    const k = `factor:${s}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<ConversionFactor>(`/api/admin/rate-cards/conversion-factors/${encodeURIComponent(s)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setFactors((cur) => {
        const idx = cur.findIndex((f) => f.slug === saved.slug)
        if (idx === -1) return [...cur, saved]
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save conversion factor')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Packing / Conversion" subtitle="Conversion speeds (bags/minute), conversion factors, and carton options used for carton estimates." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1">Conversion speeds (bags/minute)</Typography>
          <Typography
            variant="caption"
            color={savingKey?.startsWith('speed:') ? 'text.secondary' : speedSavedFlash ? 'success.main' : 'text.secondary'}
          >
            {savingKey?.startsWith('speed:') ? 'Saving…' : speedSavedFlash ? 'Saved' : ''}
          </Typography>
        </Stack>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Gauge (µm)</TableCell>
                {lengthRanges.map((l) => (
                  <TableCell key={lengthKey(l)} align="center">
                    {l.min_length_mm}-{l.max_length_mm}mm
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {gaugeRanges.map((g) => (
                <TableRow key={gaugeKey(g)} hover>
                  <TableCell>
                    {g.min_gauge_um}-{g.max_gauge_um}
                  </TableCell>
                  {lengthRanges.map((l) => {
                    const key = `${gaugeKey(g)}:${lengthKey(l)}`
                    const existing = speedByKey.get(key) || null
                    const draft = Object.prototype.hasOwnProperty.call(cellDrafts, key) ? cellDrafts[key] : existing ? String(existing.bags_per_minute) : ''
                    const isSaving = savingKey === `speed:${key}`
                    const isDirty = (existing ? String(existing.bags_per_minute) : '') !== draft

                    return (
                      <TableCell key={key} align="center">
                        <TextField
                          size="small"
                          inputProps={{ inputMode: 'decimal' }}
                          value={draft}
                          onChange={(e) => {
                            const v = e.target.value
                            // Allow partial decimal input like "1." while typing.
                            if (v === '' || /^(\d+(\.\d*)?|\.\d*)$/.test(v)) {
                              setCellDrafts((cur) => ({ ...cur, [key]: v }))
                            }
                          }}
                          onBlur={() => {
                            if (!isDirty || isSaving) return
                            const trimmed = draft.trim()
                            const patchVal = trimmed === '' ? null : parseFloat(trimmed)
                            const apiKey = {
                              min_gauge_um: g.min_gauge_um,
                              max_gauge_um: g.max_gauge_um,
                              min_length_mm: l.min_length_mm,
                              max_length_mm: l.max_length_mm,
                            }
                            if (patchVal == null) {
                              // Don't implicitly delete on clear — just revert.
                              setCellDrafts((cur) => ({
                                ...cur,
                                [key]: existing ? String(existing.bags_per_minute) : '',
                              }))
                              return
                            }
                            if (!Number.isFinite(patchVal) || patchVal <= 0) return
                            void saveSpeed(apiKey, { bags_per_minute: patchVal })
                          }}
                          disabled={isSaving}
                          sx={{ maxWidth: 120 }}
                        />
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Carton options
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 160 }}>Cost ($)</TableCell>
                <TableCell sx={{ width: 140 }}>Default</TableCell>
                <TableCell sx={{ width: 120 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {(cartonOptions || []).map((c) => (
                <CartonOptionRow
                  key={c.slug}
                  row={c}
                  saving={savingKey === `carton:${c.slug}`}
                  settingDefault={savingKey === `carton-default:${c.slug}`}
                  onSave={saveCartonOption}
                  onSetDefault={setDefaultCartonOption}
                />
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Conversion factors
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 180 }}>Value</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {factorsSorted.map((f) => (
                <FactorRow key={f.slug} row={f} saving={savingKey === `factor:${f.slug}`} onSave={saveFactor} />
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function CartonOptionRow(props: {
  row: CartonOption
  saving: boolean
  settingDefault: boolean
  onSave: (slug: string, patch: Pick<CartonOption, 'name' | 'cost_per_unit'>) => Promise<void>
  onSetDefault: (slug: string) => Promise<void>
}) {
  const { row, saving, settingDefault, onSave, onSetDefault } = props
  const [cost, setCost] = useState(() => String(row.cost_per_unit))
  useEffect(() => setCost(String(row.cost_per_unit)), [row.slug, row.cost_per_unit])
  const dirty = cost !== String(row.cost_per_unit)
  return (
    <TableRow hover>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={cost}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^(\d+(\.\d*)?|\.\d*)$/.test(v)) setCost(v)
          }}
        />
      </TableCell>
      <TableCell>
        {row.is_default ? (
          <Typography variant="body2" color="primary">Default</Typography>
        ) : (
          <Button
            size="small"
            variant="outlined"
            disabled={settingDefault}
            onClick={() => void onSetDefault(row.slug)}
          >
            {settingDefault ? 'Setting…' : 'Set default'}
          </Button>
        )}
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || cost.trim() === '' || !Number.isFinite(parseFloat(cost)) || parseFloat(cost) < 0}
          onClick={() => void onSave(row.slug, { name: row.name, cost_per_unit: parseFloat(cost) })}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function FactorRow(props: {
  row: ConversionFactor
  saving: boolean
  onSave: (slug: string, patch: Pick<ConversionFactor, 'name' | 'value'>) => Promise<void>
}) {
  const { row, saving, onSave } = props
  const [value, setValue] = useState(() => String(row.value))
  useEffect(() => setValue(String(row.value)), [row.slug, row.value])
  const dirty = value !== String(row.value)
  return (
    <TableRow hover>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^(\d+(\.\d*)?|\.\d*)$/.test(v)) setValue(v)
          }}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || value.trim() === '' || !Number.isFinite(parseFloat(value))}
            onClick={() => void onSave(row.slug, { name: row.name, value: parseFloat(value) })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}


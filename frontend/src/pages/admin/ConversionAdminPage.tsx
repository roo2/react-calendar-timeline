import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminSaveCartonOption,
  adminSaveConversionFactor,
  adminSaveConversionSpeed,
  adminSetDefaultCartonOption,
  fetchAdminConversionTab,
  type CartonOption,
  type ConversionFactor,
  type ConversionSpeed,
} from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { ScheduleMachinesSection, SCHEDULE_CAPABILITY_DEFAULTS } from './components/ScheduleMachinesSection'

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
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const speeds = useAppSelector((s) => s.adminRateCards.conversionSpeeds.items)
  const factors = useAppSelector((s) => s.adminRateCards.conversionFactors.items)
  const cartonOptions = useAppSelector((s) => s.adminRateCards.cartonOptions.items)
  const { status, error: tabErr } = useAppSelector((s) => s.adminRateCards.conversionTab)
  const loading = status === 'loading'
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
    void dispatch(fetchAdminConversionTab())
  }, [dispatch])

  const displayErr = err || tabErr

  async function saveSpeed(
    key: Pick<ConversionSpeed, 'min_gauge_um' | 'max_gauge_um' | 'min_length_mm' | 'max_length_mm'>,
    patch: Pick<ConversionSpeed, 'bags_per_minute'>,
  ) {
    const k = `speed:${speedKey(key)}`
    try {
      setErr(null)
      setSavingKey(k)
      await dispatch(adminSaveConversionSpeed({ key, patch })).unwrap()
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
      await dispatch(
        adminSaveCartonOption({
          slug,
          name: patch.name,
          cost_per_unit: patch.cost_per_unit,
          is_default: cartonOptions.find((c) => c.slug === slug)?.is_default ?? false,
        }),
      ).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save carton option')
    } finally {
      setSavingKey(null)
    }
  }

  async function setDefaultCartonOption(slug: string) {
    const k = `carton-default:${slug}`
    try {
      setErr(null)
      setSavingKey(k)
      await dispatch(adminSetDefaultCartonOption(slug)).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to set default carton')
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
      await dispatch(adminSaveConversionFactor({ slug: s, patch })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save conversion factor')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Packing / Conversion"
        subtitle="Bagging schedule lanes, conversion speeds (bags/minute), conversion factors, and carton options."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <ScheduleMachinesSection
        machineType="converter_bagger"
        title="Production schedule — bagging / conversion"
        description="Each row is a bagger lane on the Schedule board (e.g. BGR01). Capability JSON can list supported finish modes and width limits for routing checks."
        defaultCapability={SCHEDULE_CAPABILITY_DEFAULTS.converter_bagger}
        footerHint="Inactive baggers are hidden from the schedule. Add a new row here when you install an additional bagging line."
      />

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
        {loading && speeds.length === 0 ? (
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
        {loading && cartonOptions.length === 0 ? (
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
        {loading && factorsSorted.length === 0 ? (
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


import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminSaveConversionFactor,
  adminSaveConversionSpeed,
  fetchAdminConversionTab,
  type ConversionFactor,
  type ConversionSpeed,
} from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'

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

/** Cost factors table (first); quote calculator reads these slugs (conversion labour $/hr + carton cost). */
const COST_FACTOR_SLUGS = ['conversion_cost_per_hr', 'conversion_price_per_hr', 'carton_cost'] as const

type CostFactorSlug = (typeof COST_FACTOR_SLUGS)[number]

const COST_FACTOR_DEFAULTS: Record<CostFactorSlug, { name: string }> = {
  conversion_cost_per_hr: { name: 'Conversion Cost ($/hr)' },
  conversion_price_per_hr: { name: 'Conversion Price ($/hr)' },
  carton_cost: { name: 'Cost per carton ($)' },
}

export function ConversionAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const speeds = useAppSelector((s) => s.adminRateCards.conversionSpeeds.items)
  const factors = useAppSelector((s) => s.adminRateCards.conversionFactors.items)
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

  const factorBySlug = useMemo(() => new Map((factors || []).map((f) => [f.slug, f])), [factors])

  const costConversionFactors = useMemo((): ConversionFactor[] => {
    return COST_FACTOR_SLUGS.map((slug) => {
      const existing = factorBySlug.get(slug)
      if (existing) return existing
      return { slug, name: COST_FACTOR_DEFAULTS[slug].name, value: 0 }
    })
  }, [factorBySlug])

  const productionConversionFactors = useMemo(() => {
    const costSlugs = new Set<string>(COST_FACTOR_SLUGS)
    return (factors || [])
      .filter((f) => !costSlugs.has(f.slug))
      .slice()
      .sort((a, b) => a.slug.localeCompare(b.slug))
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
        subtitle="Conversion factors (rates) and conversion speeds (bags/minute)."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Conversion factors
        </Typography>
        {loading && (factors || []).length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={3}>
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                Cost factors
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
                Labour rates for quotes (cost vs sell-side), plus cost per carton. If a row is new, enter a value and
                click Save. When conversion price per hour is zero or missing, quotes use the cost rate for labour.
              </Typography>
              <AdminDataTable>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 180 }}>Value</TableCell>
                    <TableCell sx={{ width: 220 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {costConversionFactors.map((f) => (
                    <FactorRow
                      key={f.slug}
                      row={f}
                      isPlaceholder={!factorBySlug.has(f.slug)}
                      saving={savingKey === `factor:${f.slug}`}
                      onSave={saveFactor}
                    />
                  ))}
                </TableBody>
              </AdminDataTable>
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                Production Factors
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
                Throughput and timing inputs used for scheduling and quote conversion minutes (e.g. roll weight, roll
                change time).
              </Typography>
              {productionConversionFactors.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No Production Factors configured.
                </Typography>
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
                    {productionConversionFactors.map((f) => (
                      <FactorRow key={f.slug} row={f} saving={savingKey === `factor:${f.slug}`} onSave={saveFactor} />
                    ))}
                  </TableBody>
                </AdminDataTable>
              )}
            </Box>
          </Stack>
        )}
      </Paper>

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
    </Stack>
  )
}

function FactorRow(props: {
  row: ConversionFactor
  saving: boolean
  /** True when this slug is not in the DB yet — empty value until the user enters one and saves. */
  isPlaceholder?: boolean
  onSave: (slug: string, patch: Pick<ConversionFactor, 'name' | 'value'>) => Promise<void>
}) {
  const { row, saving, onSave, isPlaceholder = false } = props
  const [value, setValue] = useState(() => (isPlaceholder ? '' : String(row.value)))
  useEffect(() => {
    if (isPlaceholder) return
    setValue(String(row.value))
  }, [row.slug, row.value, isPlaceholder])
  const dirty = isPlaceholder ? value.trim() !== '' : value !== String(row.value)
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


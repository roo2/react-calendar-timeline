import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'

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
  const [speeds, setSpeeds] = useState<ConversionSpeed[]>([])
  const [factors, setFactors] = useState<ConversionFactor[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newFactorSlug, setNewFactorSlug] = useState('')
  const [newFactorName, setNewFactorName] = useState('')
  const [newFactorValue, setNewFactorValue] = useState<number | ''>('')
  const canCreateFactor = useMemo(() => {
    return !!newFactorSlug.trim() && !!newFactorName.trim() && newFactorValue !== ''
  }, [newFactorName, newFactorSlug, newFactorValue])

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

  const [cellDrafts, setCellDrafts] = useState<Record<string, number | ''>>({})

  useEffect(() => {
    const next: Record<string, number | ''> = {}
    for (const s of speeds || []) next[speedKey(s)] = Number(s.bags_per_minute)
    setCellDrafts(next)
  }, [speeds])

  const factorsSorted = useMemo(() => {
    return (factors || []).slice().sort((a, b) => a.slug.localeCompare(b.slug))
  }, [factors])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const [s, f] = await Promise.all([
          apiFetch<ConversionSpeed[]>('/api/admin/rate-cards/conversion-speeds'),
          apiFetch<ConversionFactor[]>('/api/admin/rate-cards/conversion-factors'),
        ])
        setSpeeds(Array.isArray(s) ? s : [])
        setFactors(Array.isArray(f) ? f : [])
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save conversion factor')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteFactor(slug: string) {
    const s = slug.trim()
    if (!s) return
    if (!confirmDelete(`conversion factor '${s}'`)) return
    const k = `factor:${s}`
    try {
      setErr(null)
      setSavingKey(k)
      await apiFetch<void>(`/api/admin/rate-cards/conversion-factors/${encodeURIComponent(s)}`, { method: 'DELETE' })
      setFactors((cur) => cur.filter((f) => f.slug !== s))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete conversion factor')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Packing / Conversion" subtitle="Conversion speeds (bags/minute) and conversion factors used for carton estimates." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Conversion speeds
        </Typography>
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
                    const draft = Object.prototype.hasOwnProperty.call(cellDrafts, key)
                      ? cellDrafts[key]
                      : existing
                        ? Number(existing.bags_per_minute)
                        : ''
                    const isSaving = savingKey === `speed:${key}`
                    const isDirty =
                      (existing ? Number(existing.bags_per_minute) : '') !== draft

                    return (
                      <TableCell key={key} align="center">
                        <TextField
                          size="small"
                          inputProps={{ inputMode: 'decimal' }}
                          value={draft}
                          onChange={(e) => {
                            const v = e.target.value
                            setCellDrafts((cur) => ({ ...cur, [key]: v ? parseFloat(v) : '' }))
                          }}
                          onBlur={() => {
                            if (!isDirty || isSaving) return
                            const patchVal = draft === '' ? null : Number(draft)
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
                                [key]: existing ? Number(existing.bags_per_minute) : '',
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
          Conversion factors
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 220 }}>Slug</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 180 }}>Value</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {factorsSorted.map((f) => (
                <FactorRow key={f.slug} row={f} saving={savingKey === `factor:${f.slug}`} onSave={saveFactor} onDelete={deleteFactor} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Slug" value={newFactorSlug} onChange={(e) => setNewFactorSlug(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newFactorName} onChange={(e) => setNewFactorName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={newFactorValue} onChange={(e) => setNewFactorValue(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateFactor}
                    onClick={() => {
                      if (!canCreateFactor) return
                      void saveFactor(newFactorSlug, { name: newFactorName.trim(), value: Number(newFactorValue) }).then(() => {
                        setNewFactorSlug('')
                        setNewFactorName('')
                        setNewFactorValue('')
                      })
                    }}
                  >
                    Add factor
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

function FactorRow(props: {
  row: ConversionFactor
  saving: boolean
  onSave: (slug: string, patch: Pick<ConversionFactor, 'name' | 'value'>) => Promise<void>
  onDelete: (slug: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [value, setValue] = useState<number | ''>(row.value)
  const dirty = value !== row.value
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.slug}</TableCell>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={value} onChange={(e) => setValue(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || value === ''}
            onClick={() => void onSave(row.slug, { name: row.name, value: Number(value) })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.slug)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}


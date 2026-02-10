import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { apiFetch } from '../api/client'
import { ResinSelect, type ResinOption } from '../components/ResinSelect'

type Resin = {
  resin_code: string
  name: string
  density: number
  price_per_kg: number
  currency: string
}

type ResinBlend = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
}

export function AdminPage() {
  const [resins, setResins] = useState<Resin[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [resinBlends, setResinBlends] = useState<ResinBlend[]>([])
  const [savingBlendCode, setSavingBlendCode] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newDensity, setNewDensity] = useState<number | ''>('')
  const [newPrice, setNewPrice] = useState<number | ''>('')
  const [newCurrency, setNewCurrency] = useState('AUD')

  const [newBlendCode, setNewBlendCode] = useState('')
  const [newBlendName, setNewBlendName] = useState('')
  const [newBlendComponents, setNewBlendComponents] = useState<Array<{ resin_code: string; pct: number | '' }>>([
    { resin_code: '', pct: 100 },
  ])

  const resinOptions: ResinOption[] = useMemo(
    () =>
      (resins || []).map((r) => ({
        resin_code: r.resin_code,
        name: r.name,
      })),
    [resins],
  )

  const canCreate = useMemo(() => {
    return !!newCode.trim() && !!newName.trim() && newDensity !== '' && newPrice !== '' && !!newCurrency.trim()
  }, [newCode, newCurrency, newDensity, newName, newPrice])

  const canCreateBlend = useMemo(() => {
    if (!newBlendCode.trim() || !newBlendName.trim()) return false
    const comps = newBlendComponents.filter((c) => c.resin_code.trim() && c.pct !== '')
    if (comps.length === 0) return false
    const sum = comps.reduce((acc, c) => acc + Number(c.pct || 0), 0)
    return Math.abs(sum - 100) < 0.01
  }, [newBlendCode, newBlendComponents, newBlendName])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const rows = await apiFetch<Resin[]>('/api/admin/rate-cards/resins')
        setResins(rows)
        const blends = await apiFetch<ResinBlend[]>('/api/admin/rate-cards/resin-blends')
        setResinBlends(blends)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load resins')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveResin(code: string, patch: Omit<Resin, 'resin_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingCode(trimmed)
      const saved = await apiFetch<Resin>(`/api/admin/rate-cards/resins/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setResins((cur) => {
        const idx = cur.findIndex((r) => r.resin_code === saved.resin_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.resin_code.localeCompare(b.resin_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin')
    } finally {
      setSavingCode(null)
    }
  }

  async function saveBlend(code: string, patch: Omit<ResinBlend, 'blend_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingBlendCode(trimmed)
      const saved = await apiFetch<ResinBlend>(`/api/admin/rate-cards/resin-blends/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setResinBlends((cur) => {
        const idx = cur.findIndex((b) => b.blend_code === saved.blend_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.blend_code.localeCompare(b.blend_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin blend')
    } finally {
      setSavingBlendCode(null)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Admin
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          {err && <Alert severity="error">{err}</Alert>}

          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Resins
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add or update resin master data used by materials and quoting.
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: 2 }}>
            {loading ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 140 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 140 }}>Density</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 120 }}>Currency</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {resins.map((r) => (
                    <ResinRow key={r.resin_code} resin={r} saving={savingCode === r.resin_code} onSave={saveResin} />
                  ))}
                  <TableRow>
                    <TableCell>
                      <TextField size="small" label="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Density"
                        type="number"
                        inputProps={{ step: 0.0001, min: 0 }}
                        value={newDensity}
                        onChange={(e) => setNewDensity(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Price / kg"
                        type="number"
                        inputProps={{ step: 0.0001, min: 0 }}
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" label="Currency" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!canCreate || savingCode === newCode.trim()}
                        onClick={() => {
                          if (!canCreate) return
                          void saveResin(newCode, {
                            name: newName.trim(),
                            density: Number(newDensity),
                            price_per_kg: Number(newPrice),
                            currency: newCurrency.trim().toUpperCase(),
                          }).then(() => {
                            setNewCode('')
                            setNewName('')
                            setNewDensity('')
                            setNewPrice('')
                            setNewCurrency('AUD')
                          })
                        }}
                      >
                        Add resin
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </Paper>

          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Resin blends
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Preset resin+percentage mixes used by the product spec form.
            </Typography>

            {loading ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <Stack spacing={2}>
                {resinBlends.map((b) => (
                  <ResinBlendListItem
                    key={b.blend_code}
                    blend={b}
                    saving={savingBlendCode === b.blend_code}
                    onSave={saveBlend}
                    resinOptions={resinOptions}
                  />
                ))}

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Add blend
                  </Typography>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 2,
                      alignItems: 'center',
                    }}
                  >
                    <TextField
                      size="small"
                      label="Blend code"
                      value={newBlendCode}
                      onChange={(e) => setNewBlendCode(e.target.value)}
                    />
                    <TextField size="small" label="Name" value={newBlendName} onChange={(e) => setNewBlendName(e.target.value)} />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!canCreateBlend || savingBlendCode === newBlendCode.trim()}
                        onClick={() => {
                          if (!canCreateBlend) return
                          void saveBlend(newBlendCode, {
                            name: newBlendName.trim(),
                            components: newBlendComponents
                              .filter((c) => c.resin_code.trim() && c.pct !== '')
                              .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
                          }).then(() => {
                            setNewBlendCode('')
                            setNewBlendName('')
                            setNewBlendComponents([{ resin_code: '', pct: 100 }])
                          })
                        }}
                      >
                        Add blend
                      </Button>
                    </Box>
                  </Box>

                  <BlendComponentsEditor components={newBlendComponents} onChange={setNewBlendComponents} resinOptions={resinOptions} />
                  {!!newBlendCode.trim() && !!newBlendName.trim() && (
                    <Typography
                      variant="caption"
                      color={canCreateBlend ? 'text.secondary' : 'error'}
                      sx={{ display: 'block', mt: 1 }}
                    >
                      Total:{' '}
                      {newBlendComponents
                        .filter((c) => c.resin_code.trim() && c.pct !== '')
                        .reduce((acc, c) => acc + Number(c.pct || 0), 0)
                        .toFixed(2)}
                      % {canCreateBlend ? '(OK)' : '(must sum to 100%)'}
                    </Typography>
                  )}
                </Paper>
              </Stack>
            )}
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}

function ResinRow(props: {
  resin: Resin
  saving: boolean
  onSave: (code: string, patch: Omit<Resin, 'resin_code'>) => Promise<void>
}) {
  const { resin, saving, onSave } = props
  const [name, setName] = useState(resin.name)
  const [density, setDensity] = useState<number | ''>(resin.density)
  const [price, setPrice] = useState<number | ''>(resin.price_per_kg)
  const [currency, setCurrency] = useState(resin.currency)

  const dirty =
    name !== resin.name ||
    density !== resin.density ||
    price !== resin.price_per_kg ||
    currency !== resin.currency

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{resin.resin_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 0.0001, min: 0 }}
          value={density}
          onChange={(e) => setDensity(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 0.0001, min: 0 }}
          value={price}
          onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField size="small" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || !name.trim() || density === '' || price === '' || !currency.trim()}
          onClick={() =>
            void onSave(resin.resin_code, {
              name: name.trim(),
              density: Number(density),
              price_per_kg: Number(price),
              currency: currency.trim().toUpperCase(),
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function ResinBlendListItem(props: {
  blend: ResinBlend
  saving: boolean
  onSave: (code: string, patch: Omit<ResinBlend, 'blend_code'>) => Promise<void>
  resinOptions: ResinOption[]
}) {
  const { blend, saving, onSave, resinOptions } = props
  const [name, setName] = useState(blend.name)
  const [components, setComponents] = useState<Array<{ resin_code: string; pct: number | '' }>>(
    (blend.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct })),
  )

  const sum = components
    .filter((c) => c.resin_code.trim() && c.pct !== '')
    .reduce((acc, c) => acc + Number(c.pct || 0), 0)

  const dirty =
    name !== blend.name ||
    JSON.stringify(components) !== JSON.stringify((blend.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct })))

  const canSave =
    !!name.trim() &&
    components.filter((c) => c.resin_code.trim() && c.pct !== '').length > 0 &&
    Math.abs(sum - 100) < 0.01

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '180px 1fr 140px', gap: 2, alignItems: 'center' }}>
        <TextField size="small" label="Code" value={blend.blend_code} InputProps={{ readOnly: true }} />
        <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !canSave}
            onClick={() =>
              void onSave(blend.blend_code, {
                name: name.trim(),
                components: components
                  .filter((c) => c.resin_code.trim() && c.pct !== '')
                  .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </Box>

      <BlendComponentsEditor components={components} onChange={setComponents} resinOptions={resinOptions} />
      <Typography variant="caption" color={Math.abs(sum - 100) < 0.01 ? 'text.secondary' : 'error'} sx={{ display: 'block', mt: 1 }}>
        Total: {sum.toFixed(2)}% {Math.abs(sum - 100) < 0.01 ? '(OK)' : '(must sum to 100%)'}
      </Typography>
    </Paper>
  )
}

function BlendComponentsEditor(props: {
  components: Array<{ resin_code: string; pct: number | '' }>
  onChange: (next: Array<{ resin_code: string; pct: number | '' }>) => void
  resinOptions: ResinOption[]
}) {
  const { components, onChange, resinOptions } = props
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
        Components
      </Typography>
      <Stack spacing={1}>
        {components.map((c, idx) => (
          <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px', gap: 2, alignItems: 'center' }}>
            <ResinSelect
              options={resinOptions}
              valueCode={c.resin_code}
              onChangeCode={(nextCode) =>
                onChange(components.map((x, i) => (i === idx ? { ...x, resin_code: nextCode } : x)))
              }
            />

            <TextField
              size="small"
              label="Pct"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={c.pct}
              onChange={(e) =>
                onChange(
                  components.map((x, i) =>
                    i === idx ? { ...x, pct: e.target.value ? parseFloat(e.target.value) : '' } : x,
                  ),
                )
              }
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                size="small"
                color="error"
                variant="outlined"
                disabled={components.length <= 1}
                onClick={() => {
                  const next = components.slice()
                  next.splice(idx, 1)
                  onChange(next.length ? next : [{ resin_code: '', pct: 100 }])
                }}
              >
                Remove
              </Button>
            </Box>
          </Box>
        ))}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" variant="outlined" onClick={() => onChange([...components, { resin_code: '', pct: '' }])}>
            Add component
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}


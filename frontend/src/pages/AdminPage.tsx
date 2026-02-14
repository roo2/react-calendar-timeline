import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  MenuItem,
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

type Additive = {
  additive_code: string
  name: string
  price_per_kg: number
  category?: string | null
}

type Colour = {
  colour_code: string
  name: string
  price_per_kg: number
  opacity_multiplier: number
  currency: string
}

type Core = {
  core_type: string
  description?: string | null
  cost_per_meter: number
  kg_per_meter: number
  currency: string
}

type Ink = {
  ink_code: string
  name: string
}

type Plate = {
  customer_id: string
  plate_code: string
  description?: string | null
}

type CustomerSummary = {
  id: string
  code?: string | null
  name: string
}

export function AdminPage() {
  const [resins, setResins] = useState<Resin[]>([])
  const [additives, setAdditives] = useState<Additive[]>([])
  const [colours, setColours] = useState<Colour[]>([])
  const [cores, setCores] = useState<Core[]>([])
  const [inks, setInks] = useState<Ink[]>([])
  const [plates, setPlates] = useState<Plate[]>([])
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [savingAdditiveCode, setSavingAdditiveCode] = useState<string | null>(null)
  const [savingColourCode, setSavingColourCode] = useState<string | null>(null)
  const [savingCoreType, setSavingCoreType] = useState<string | null>(null)
  const [savingInkCode, setSavingInkCode] = useState<string | null>(null)
  const [savingPlateKey, setSavingPlateKey] = useState<string | null>(null)
  const [resinBlends, setResinBlends] = useState<ResinBlend[]>([])
  const [savingBlendCode, setSavingBlendCode] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newDensity, setNewDensity] = useState<number | ''>('')
  const [newPrice, setNewPrice] = useState<number | ''>('')
  const [newCurrency, setNewCurrency] = useState('AUD')

  const [newAdditiveCode, setNewAdditiveCode] = useState('')
  const [newAdditiveName, setNewAdditiveName] = useState('')
  const [newAdditivePrice, setNewAdditivePrice] = useState<number | ''>('')
  const [newAdditiveCategory, setNewAdditiveCategory] = useState('process')

  const [newColourCode, setNewColourCode] = useState('')
  const [newColourName, setNewColourName] = useState('')
  const [newColourPrice, setNewColourPrice] = useState<number | ''>('')
  const [newColourOpacity, setNewColourOpacity] = useState<number | ''>(0)
  const [newColourCurrency, setNewColourCurrency] = useState('AUD')

  const [newCoreType, setNewCoreType] = useState('')
  const [newCoreDescription, setNewCoreDescription] = useState('')
  const [newCoreCostPerM, setNewCoreCostPerM] = useState<number | ''>('')
  const [newCoreKgPerM, setNewCoreKgPerM] = useState<number | ''>('')
  const [newCoreCurrency, setNewCoreCurrency] = useState('AUD')

  const [newInkCode, setNewInkCode] = useState('')
  const [newInkName, setNewInkName] = useState('')

  const [newPlateCustomerId, setNewPlateCustomerId] = useState('')
  const [newPlateCode, setNewPlateCode] = useState('')
  const [newPlateDescription, setNewPlateDescription] = useState('')

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

  const canCreateAdditive = useMemo(() => {
    return !!newAdditiveCode.trim() && !!newAdditiveName.trim() && newAdditivePrice !== ''
  }, [newAdditiveCode, newAdditiveName, newAdditivePrice])

  const canCreateColour = useMemo(() => {
    return (
      !!newColourCode.trim() &&
      !!newColourName.trim() &&
      newColourPrice !== '' &&
      newColourOpacity !== '' &&
      !!newColourCurrency.trim()
    )
  }, [newColourCode, newColourCurrency, newColourName, newColourOpacity, newColourPrice])

  const canCreateCore = useMemo(() => {
    return !!newCoreType.trim() && newCoreCostPerM !== '' && newCoreKgPerM !== '' && !!newCoreCurrency.trim()
  }, [newCoreCostPerM, newCoreCurrency, newCoreKgPerM, newCoreType])

  const canCreateInk = useMemo(() => {
    return !!newInkCode.trim() && !!newInkName.trim()
  }, [newInkCode, newInkName])

  const canCreatePlate = useMemo(() => {
    return !!newPlateCustomerId.trim() && !!newPlateCode.trim()
  }, [newPlateCode, newPlateCustomerId])

  const canCreateBlend = useMemo(() => {
    if (!newBlendCode.trim() || !newBlendName.trim()) return false
    const comps = newBlendComponents.filter((c) => c.resin_code.trim() && c.pct !== '')
    if (comps.length === 0) return false
    const sum = comps.reduce((acc, c) => acc + Number(c.pct || 0), 0)
    return Math.abs(sum - 100) < 0.01
  }, [newBlendCode, newBlendComponents, newBlendName])

  const customersById = useMemo(() => {
    const m = new Map<string, CustomerSummary>()
    for (const c of customers || []) m.set(c.id, c)
    return m
  }, [customers])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const rows = await apiFetch<Resin[]>('/api/admin/rate-cards/resins')
        setResins(rows)
        const adds = await apiFetch<Additive[]>('/api/admin/rate-cards/additives')
        setAdditives(adds)
        const cols = await apiFetch<Colour[]>('/api/admin/rate-cards/colours')
        setColours(cols)
        const cs = await apiFetch<Core[]>('/api/admin/rate-cards/cores')
        setCores(cs)
        const inkRows = await apiFetch<Ink[]>('/api/admin/rate-cards/inks')
        setInks(inkRows)
        const plateRows = await apiFetch<Plate[]>('/api/admin/rate-cards/plates')
        setPlates(plateRows)
        const custRes = await apiFetch<{ items: CustomerSummary[] }>('/api/customers')
        setCustomers(custRes.items || [])
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

  async function saveAdditive(code: string, patch: Omit<Additive, 'additive_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingAdditiveCode(trimmed)
      const saved = await apiFetch<Additive>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setAdditives((cur) => {
        const idx = cur.findIndex((a) => a.additive_code === saved.additive_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.additive_code.localeCompare(b.additive_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save additive')
    } finally {
      setSavingAdditiveCode(null)
    }
  }

  async function saveColour(code: string, patch: Omit<Colour, 'colour_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingColourCode(trimmed)
      const saved = await apiFetch<Colour>(`/api/admin/rate-cards/colours/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setColours((cur) => {
        const idx = cur.findIndex((c) => c.colour_code === saved.colour_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.colour_code.localeCompare(b.colour_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save colour')
    } finally {
      setSavingColourCode(null)
    }
  }

  async function saveCore(coreType: string, patch: Omit<Core, 'core_type'>) {
    const trimmed = coreType.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingCoreType(trimmed)
      const saved = await apiFetch<Core>(`/api/admin/rate-cards/cores/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setCores((cur) => {
        const idx = cur.findIndex((c) => c.core_type === saved.core_type)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.core_type.localeCompare(b.core_type))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save core')
    } finally {
      setSavingCoreType(null)
    }
  }

  async function saveInk(code: string, patch: Omit<Ink, 'ink_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingInkCode(trimmed)
      const saved = await apiFetch<Ink>(`/api/admin/rate-cards/inks/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setInks((cur) => {
        const idx = cur.findIndex((i) => i.ink_code === saved.ink_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.ink_code.localeCompare(b.ink_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save ink')
    } finally {
      setSavingInkCode(null)
    }
  }

  async function savePlate(customerId: string, plateCode: string, patch: Omit<Plate, 'customer_id' | 'plate_code'>) {
    const cid = customerId.trim()
    const code = plateCode.trim()
    const key = `${cid}__${code}`
    if (!cid || !code) return
    try {
      setErr(null)
      setSavingPlateKey(key)
      const saved = await apiFetch<Plate>(
        `/api/admin/rate-cards/plates/${encodeURIComponent(cid)}/${encodeURIComponent(code)}`,
        {
          method: 'PUT',
          body: JSON.stringify(patch),
        },
      )
      setPlates((cur) => {
        const idx = cur.findIndex((p) => p.customer_id === saved.customer_id && p.plate_code === saved.plate_code)
        if (idx === -1) {
          return [...cur, saved].sort((a, b) => {
            const ak = `${customersById.get(a.customer_id)?.code || ''}__${a.plate_code}`
            const bk = `${customersById.get(b.customer_id)?.code || ''}__${b.plate_code}`
            return ak.localeCompare(bk)
          })
        }
        const next = cur.slice()
        next[idx] = saved
        return next
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save plate')
    } finally {
      setSavingPlateKey(null)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Admin
      </Typography>

      <Stack spacing={2}>
        {err && <Alert severity="error">{err}</Alert>}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
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
                        variant="outlined"
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

            <Box sx={{ mt: 1 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Additives
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add or update additive master data.
            </Typography>
            </Box>

          <Paper variant="outlined" sx={{ p: 2 }}>
            {loading ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 180 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 180 }}>Category</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {additives.map((a) => (
                    <AdditiveRow key={a.additive_code} additive={a} saving={savingAdditiveCode === a.additive_code} onSave={saveAdditive} />
                  ))}
                  <TableRow>
                    <TableCell>
                      <TextField size="small" label="Code" value={newAdditiveCode} onChange={(e) => setNewAdditiveCode(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth label="Name" value={newAdditiveName} onChange={(e) => setNewAdditiveName(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Price / kg"
                        type="number"
                        inputProps={{ step: 0.0001, min: 0 }}
                        value={newAdditivePrice}
                        onChange={(e) => setNewAdditivePrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" label="Category" value={newAdditiveCategory} onChange={(e) => setNewAdditiveCategory(e.target.value)} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!canCreateAdditive || savingAdditiveCode === newAdditiveCode.trim()}
                        onClick={() => {
                          if (!canCreateAdditive) return
                          void saveAdditive(newAdditiveCode, {
                            name: newAdditiveName.trim(),
                            price_per_kg: Number(newAdditivePrice),
                            category: newAdditiveCategory.trim() ? newAdditiveCategory.trim() : null,
                          }).then(() => {
                            setNewAdditiveCode('')
                            setNewAdditiveName('')
                            setNewAdditivePrice('')
                            setNewAdditiveCategory('process')
                          })
                        }}
                      >
                        Add additive
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </Paper>

            <Box sx={{ mt: 1 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Colours
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add or update colour master data.
            </Typography>
            </Box>

          <Paper variant="outlined" sx={{ p: 2 }}>
            {loading ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 180 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 160 }}>Opacity mult</TableCell>
                    <TableCell sx={{ width: 120 }}>Currency</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {colours.map((c) => (
                    <ColourRow key={c.colour_code} colour={c} saving={savingColourCode === c.colour_code} onSave={saveColour} />
                  ))}
                  <TableRow>
                    <TableCell>
                      <TextField size="small" label="Code" value={newColourCode} onChange={(e) => setNewColourCode(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth label="Name" value={newColourName} onChange={(e) => setNewColourName(e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Price / kg"
                        type="number"
                        inputProps={{ step: 0.0001, min: 0 }}
                        value={newColourPrice}
                        onChange={(e) => setNewColourPrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Opacity mult"
                        type="number"
                        inputProps={{ step: 0.001, min: 0 }}
                        value={newColourOpacity}
                        onChange={(e) => setNewColourOpacity(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" label="Currency" value={newColourCurrency} onChange={(e) => setNewColourCurrency(e.target.value)} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!canCreateColour || savingColourCode === newColourCode.trim()}
                        onClick={() => {
                          if (!canCreateColour) return
                          void saveColour(newColourCode, {
                            name: newColourName.trim(),
                            price_per_kg: Number(newColourPrice),
                            opacity_multiplier: Number(newColourOpacity),
                            currency: newColourCurrency.trim().toUpperCase(),
                          }).then(() => {
                            setNewColourCode('')
                            setNewColourName('')
                            setNewColourPrice('')
                            setNewColourOpacity(0)
                            setNewColourCurrency('AUD')
                          })
                        }}
                      >
                        Add colour
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

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Printing
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configure inks and customer plate libraries used by inline printing setup.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Ink
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                {loading ? (
                  <Typography color="text.secondary">Loading…</Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 200 }}>Ink code</TableCell>
                        <TableCell>Colour name</TableCell>
                        <TableCell sx={{ width: 140 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {inks.map((i) => (
                        <InkRow key={i.ink_code} ink={i} saving={savingInkCode === i.ink_code} onSave={saveInk} />
                      ))}
                      <TableRow>
                        <TableCell>
                          <TextField size="small" label="Ink code" value={newInkCode} onChange={(e) => setNewInkCode(e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" fullWidth label="Colour name" value={newInkName} onChange={(e) => setNewInkName(e.target.value)} />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!canCreateInk || savingInkCode === newInkCode.trim()}
                            onClick={() => {
                              if (!canCreateInk) return
                              void saveInk(newInkCode, { name: newInkName.trim() }).then(() => {
                                setNewInkCode('')
                                setNewInkName('')
                              })
                            }}
                          >
                            Add ink
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Plates
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                {loading ? (
                  <Typography color="text.secondary">Loading…</Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 220 }}>Customer code</TableCell>
                        <TableCell sx={{ width: 220 }}>Plate code</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell sx={{ width: 140 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plates
                        .slice()
                        .sort((a, b) => {
                          const ak = `${customersById.get(a.customer_id)?.code || ''}__${a.plate_code}`
                          const bk = `${customersById.get(b.customer_id)?.code || ''}__${b.plate_code}`
                          return ak.localeCompare(bk)
                        })
                        .map((p) => (
                          <PlateRow
                            key={`${p.customer_id}__${p.plate_code}`}
                            plate={p}
                            customerCode={customersById.get(p.customer_id)?.code || ''}
                            saving={savingPlateKey === `${p.customer_id}__${p.plate_code}`}
                            onSave={savePlate}
                          />
                        ))}
                      <TableRow>
                        <TableCell>
                          <TextField
                            size="small"
                            select
                            fullWidth
                            label="Customer"
                            value={newPlateCustomerId}
                            onChange={(e) => setNewPlateCustomerId(e.target.value)}
                          >
                            <MenuItem value="">-</MenuItem>
                            {customers
                              .slice()
                              .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
                              .map((c) => (
                                <MenuItem key={c.id} value={c.id}>
                                  {(c.code || '(no code)') + ' — ' + c.name}
                                </MenuItem>
                              ))}
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <TextField size="small" label="Plate code" value={newPlateCode} onChange={(e) => setNewPlateCode(e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            label="Description"
                            value={newPlateDescription}
                            onChange={(e) => setNewPlateDescription(e.target.value)}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!canCreatePlate || savingPlateKey === `${newPlateCustomerId.trim()}__${newPlateCode.trim()}`}
                            onClick={() => {
                              if (!canCreatePlate) return
                              void savePlate(newPlateCustomerId, newPlateCode, {
                                description: newPlateDescription.trim() ? newPlateDescription.trim() : null,
                              }).then(() => {
                                setNewPlateCustomerId('')
                                setNewPlateCode('')
                                setNewPlateDescription('')
                              })
                            }}
                          >
                            Add plate
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Cores
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add or update core master data (cost/kg per meter).
              </Typography>
            </Box>

            <Paper variant="outlined" sx={{ p: 2 }}>
              {loading ? (
                <Typography color="text.secondary">Loading…</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 140 }}>Type</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell sx={{ width: 170 }}>Cost / m</TableCell>
                      <TableCell sx={{ width: 170 }}>Kg / m</TableCell>
                      <TableCell sx={{ width: 120 }}>Currency</TableCell>
                      <TableCell sx={{ width: 140 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cores.map((c) => (
                      <CoreRow key={c.core_type} core={c} saving={savingCoreType === c.core_type} onSave={saveCore} />
                    ))}
                    <TableRow>
                      <TableCell>
                        <TextField size="small" label="Type" value={newCoreType} onChange={(e) => setNewCoreType(e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          label="Description"
                          value={newCoreDescription}
                          onChange={(e) => setNewCoreDescription(e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Cost / m"
                          type="number"
                          inputProps={{ step: 0.0001, min: 0 }}
                          value={newCoreCostPerM}
                          onChange={(e) => setNewCoreCostPerM(e.target.value ? parseFloat(e.target.value) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Kg / m"
                          type="number"
                          inputProps={{ step: 0.0001, min: 0 }}
                          value={newCoreKgPerM}
                          onChange={(e) => setNewCoreKgPerM(e.target.value ? parseFloat(e.target.value) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" label="Currency" value={newCoreCurrency} onChange={(e) => setNewCoreCurrency(e.target.value)} />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!canCreateCore || savingCoreType === newCoreType.trim()}
                          onClick={() => {
                            if (!canCreateCore) return
                            void saveCore(newCoreType, {
                              description: newCoreDescription.trim() ? newCoreDescription.trim() : null,
                              cost_per_meter: Number(newCoreCostPerM),
                              kg_per_meter: Number(newCoreKgPerM),
                              currency: newCoreCurrency.trim().toUpperCase(),
                            }).then(() => {
                              setNewCoreType('')
                              setNewCoreDescription('')
                              setNewCoreCostPerM('')
                              setNewCoreKgPerM('')
                              setNewCoreCurrency('AUD')
                            })
                          }}
                        >
                          Add core
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </Paper>
          </Stack>
        </Paper>
      </Stack>
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

function AdditiveRow(props: {
  additive: Additive
  saving: boolean
  onSave: (code: string, patch: Omit<Additive, 'additive_code'>) => Promise<void>
}) {
  const { additive, saving, onSave } = props
  const [name, setName] = useState(additive.name)
  const [price, setPrice] = useState<number | ''>(additive.price_per_kg)
  const [category, setCategory] = useState(additive.category || '')

  const dirty = name !== additive.name || price !== additive.price_per_kg || category !== (additive.category || '')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{additive.additive_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
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
        <TextField size="small" value={category} onChange={(e) => setCategory(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || !name.trim() || price === ''}
          onClick={() =>
            void onSave(additive.additive_code, {
              name: name.trim(),
              price_per_kg: Number(price),
              category: category.trim() ? category.trim() : null,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function ColourRow(props: {
  colour: Colour
  saving: boolean
  onSave: (code: string, patch: Omit<Colour, 'colour_code'>) => Promise<void>
}) {
  const { colour, saving, onSave } = props
  const [name, setName] = useState(colour.name)
  const [price, setPrice] = useState<number | ''>(colour.price_per_kg)
  const [opacity, setOpacity] = useState<number | ''>(colour.opacity_multiplier)
  const [currency, setCurrency] = useState(colour.currency)

  const dirty =
    name !== colour.name ||
    price !== colour.price_per_kg ||
    opacity !== colour.opacity_multiplier ||
    currency !== colour.currency

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{colour.colour_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
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
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 0.001, min: 0 }}
          value={opacity}
          onChange={(e) => setOpacity(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField size="small" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || !name.trim() || price === '' || opacity === '' || !currency.trim()}
          onClick={() =>
            void onSave(colour.colour_code, {
              name: name.trim(),
              price_per_kg: Number(price),
              opacity_multiplier: Number(opacity),
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

function CoreRow(props: {
  core: Core
  saving: boolean
  onSave: (coreType: string, patch: Omit<Core, 'core_type'>) => Promise<void>
}) {
  const { core, saving, onSave } = props
  const [description, setDescription] = useState(core.description || '')
  const [cost, setCost] = useState<number | ''>(core.cost_per_meter)
  const [kg, setKg] = useState<number | ''>(core.kg_per_meter)
  const [currency, setCurrency] = useState(core.currency)

  const dirty =
    description !== (core.description || '') ||
    cost !== core.cost_per_meter ||
    kg !== core.kg_per_meter ||
    currency !== core.currency

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{core.core_type}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={description} onChange={(e) => setDescription(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 0.0001, min: 0 }}
          value={cost}
          onChange={(e) => setCost(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ step: 0.0001, min: 0 }}
          value={kg}
          onChange={(e) => setKg(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField size="small" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || cost === '' || kg === '' || !currency.trim()}
          onClick={() =>
            void onSave(core.core_type, {
              description: description.trim() ? description.trim() : null,
              cost_per_meter: Number(cost),
              kg_per_meter: Number(kg),
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

function InkRow(props: {
  ink: Ink
  saving: boolean
  onSave: (code: string, patch: Omit<Ink, 'ink_code'>) => Promise<void>
}) {
  const { ink, saving, onSave } = props
  const [name, setName] = useState(ink.name)

  const dirty = name !== ink.name

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{ink.ink_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty || !name.trim()}
          onClick={() => void onSave(ink.ink_code, { name: name.trim() })}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function PlateRow(props: {
  plate: Plate
  customerCode: string
  saving: boolean
  onSave: (customerId: string, plateCode: string, patch: Omit<Plate, 'customer_id' | 'plate_code'>) => Promise<void>
}) {
  const { plate, customerCode, saving, onSave } = props
  const [description, setDescription] = useState(plate.description || '')

  const dirty = description !== (plate.description || '')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{customerCode || plate.customer_id}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace' }}>{plate.plate_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={description} onChange={(e) => setDescription(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Button
          size="small"
          variant="outlined"
          disabled={saving || !dirty}
          onClick={() =>
            void onSave(plate.customer_id, plate.plate_code, {
              description: description.trim() ? description.trim() : null,
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


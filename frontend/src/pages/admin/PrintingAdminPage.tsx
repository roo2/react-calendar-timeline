import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, MenuItem, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { CustomerSummary, Ink, Plate, PrintingPricingTier } from './types'

function tierKey(t: { method: string; max_print_width_mm: number; num_colours: number }) {
  const m = (t.method || '').trim().toLowerCase()
  return `${m}:${t.max_print_width_mm}:${t.num_colours}`
}

export function PrintingAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [tiers, setTiers] = useState<PrintingPricingTier[]>([])
  const [inks, setInks] = useState<Ink[]>([])
  const [plates, setPlates] = useState<Plate[]>([])
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [newMethod, setNewMethod] = useState<'inline' | 'uteco'>('inline')
  const [newMaxWidth, setNewMaxWidth] = useState<number | ''>('')
  const [newNumColours, setNewNumColours] = useState<number | ''>('')
  const [newMinMeters, setNewMinMeters] = useState<number | ''>('')
  const [newMinCharge, setNewMinCharge] = useState<number | ''>('')
  const [newSetupFee, setNewSetupFee] = useState<number | ''>('')
  const [newRate1000, setNewRate1000] = useState<number | ''>('')

  const canCreateTier = useMemo(() => {
    if (!newMethod) return false
    if (newMaxWidth === '' || Number(newMaxWidth) <= 0) return false
    if (newNumColours === '' || Number(newNumColours) < 1) return false
    if (newMinMeters === '' || Number(newMinMeters) < 0) return false
    if (newRate1000 === '' || Number(newRate1000) < 0) return false
    if (newMethod === 'inline') return newMinCharge !== '' && Number(newMinCharge) >= 0
    return newSetupFee !== '' && Number(newSetupFee) >= 0
  }, [newMaxWidth, newMethod, newMinCharge, newMinMeters, newNumColours, newRate1000, newSetupFee])

  const [newInkCode, setNewInkCode] = useState('')
  const [newInkName, setNewInkName] = useState('')
  const [newInkPrinterType, setNewInkPrinterType] = useState<'inline' | 'uteco' | 'both'>('inline')
  const canCreateInk = useMemo(() => !!newInkCode.trim() && !!newInkName.trim(), [newInkCode, newInkName])

  const [newPlateCustomerId, setNewPlateCustomerId] = useState('')
  const [newPlateCode, setNewPlateCode] = useState('')
  const [newPlateDescription, setNewPlateDescription] = useState('')
  const canCreatePlate = useMemo(() => !!newPlateCustomerId.trim() && !!newPlateCode.trim(), [newPlateCode, newPlateCustomerId])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const [pt, inkRows, plateRows, custRes] = await Promise.all([
          apiFetch<PrintingPricingTier[]>('/api/admin/rate-cards/printing-pricing-tiers'),
          apiFetch<Ink[]>('/api/admin/rate-cards/inks'),
          apiFetch<Plate[]>('/api/admin/rate-cards/plates'),
          apiFetch<{ items: CustomerSummary[] }>('/api/customers'),
        ])
        setTiers(pt)
        setInks(inkRows)
        setPlates(plateRows)
        setCustomers(custRes.items || [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load printing admin data')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveInk(code: string, patch: Omit<Ink, 'ink_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`ink:${trimmed}`)
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
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save ink')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteInk(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`ink '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingKey(`ink:${trimmed}`)
      await apiFetch<void>(`/api/admin/rate-cards/inks/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setInks((cur) => cur.filter((i) => i.ink_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete ink')
    } finally {
      setSavingKey(null)
    }
  }

  async function savePlate(customerId: string, plateCode: string, patch: Omit<Plate, 'customer_id' | 'plate_code'>) {
    const cid = customerId.trim()
    const code = plateCode.trim()
    const key = `plate:${cid}__${code}`
    if (!cid || !code) return
    try {
      setErr(null)
      setSavingKey(key)
      const saved = await apiFetch<Plate>(`/api/admin/rate-cards/plates/${encodeURIComponent(cid)}/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setPlates((cur) => {
        const idx = cur.findIndex((p) => p.customer_id === saved.customer_id && p.plate_code === saved.plate_code)
        if (idx === -1) return [...cur, saved]
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save plate')
    } finally {
      setSavingKey(null)
    }
  }

  async function deletePlate(customerId: string, plateCode: string) {
    const cid = customerId.trim()
    const code = plateCode.trim()
    const key = `plate:${cid}__${code}`
    if (!cid || !code) return
    if (!confirmDelete(`plate '${code}' for customer '${customersById.get(cid)?.code || cid}'`)) return
    try {
      setErr(null)
      setSavingKey(key)
      await apiFetch<void>(`/api/admin/rate-cards/plates/${encodeURIComponent(cid)}/${encodeURIComponent(code)}`, { method: 'DELETE' })
      setPlates((cur) => cur.filter((p) => !(p.customer_id === cid && p.plate_code === code)))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete plate')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveTier(
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<PrintingPricingTier, 'min_meters' | 'min_charge' | 'setup_fee' | 'cost_per_1000m'>,
  ) {
    const m = (key.method || '').trim().toLowerCase()
    if (!m) return
    const k = `tier:${tierKey({ method: m, max_print_width_mm: key.max_print_width_mm, num_colours: key.num_colours })}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<PrintingPricingTier>(
        `/api/admin/rate-cards/printing-pricing-tiers/${encodeURIComponent(m)}/${encodeURIComponent(String(key.max_print_width_mm))}/${encodeURIComponent(
          String(key.num_colours),
        )}`,
        {
          method: 'PUT',
          body: JSON.stringify(patch),
        },
      )
      setTiers((cur) => {
        const idx = cur.findIndex((t) => t.method === saved.method && t.max_print_width_mm === saved.max_print_width_mm && t.num_colours === saved.num_colours)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.method.localeCompare(b.method) || a.max_print_width_mm - b.max_print_width_mm || a.num_colours - b.num_colours)
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save printing tier')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteTier(key: { method: string; max_print_width_mm: number; num_colours: number }) {
    const m = (key.method || '').trim().toLowerCase()
    if (!m) return
    const k = tierKey({ method: m, max_print_width_mm: key.max_print_width_mm, num_colours: key.num_colours })
    if (!confirmDelete(`printing tier '${k}'`)) return
    const savingK = `tier:${k}`
    try {
      setErr(null)
      setSavingKey(savingK)
      await apiFetch<void>(
        `/api/admin/rate-cards/printing-pricing-tiers/${encodeURIComponent(m)}/${encodeURIComponent(String(key.max_print_width_mm))}/${encodeURIComponent(
          String(key.num_colours),
        )}`,
        { method: 'DELETE' },
      )
      setTiers((cur) => cur.filter((t) => !(t.method === m && t.max_print_width_mm === key.max_print_width_mm && t.num_colours === key.num_colours)))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete printing tier')
    } finally {
      setSavingKey(null)
    }
  }

  const tiersSorted = useMemo(() => {
    return (tiers || []).slice().sort((a, b) => a.method.localeCompare(b.method) || a.max_print_width_mm - b.max_print_width_mm || a.num_colours - b.num_colours)
  }, [tiers])

  const platesSorted = useMemo(() => {
    return (plates || []).slice().sort((a, b) => {
      const ak = `${customersById.get(a.customer_id)?.code || ''}__${a.plate_code}`
      const bk = `${customersById.get(b.customer_id)?.code || ''}__${b.plate_code}`
      return ak.localeCompare(bk)
    })
  }, [customersById, plates])

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Printing" subtitle="Printing pricing tiers, inks, and plates." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Printing pricing tiers
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>Method</TableCell>
                <TableCell sx={{ width: 160 }}>Max width (mm)</TableCell>
                <TableCell sx={{ width: 140 }}>Colours</TableCell>
                <TableCell sx={{ width: 140 }}>Min meters</TableCell>
                <TableCell sx={{ width: 160 }}>Min charge</TableCell>
                <TableCell sx={{ width: 160 }}>Setup fee</TableCell>
                <TableCell sx={{ width: 180 }}>Cost / 1000m</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {tiersSorted.map((t) => (
                <TierRow
                  key={tierKey(t)}
                  row={t}
                  saving={savingKey === `tier:${tierKey(t)}`}
                  onSave={saveTier}
                  onDelete={deleteTier}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField select size="small" label="Method" value={newMethod} onChange={(e) => setNewMethod(e.target.value as any)} sx={{ minWidth: 120 }}>
                    <MenuItem value="inline">inline</MenuItem>
                    <MenuItem value="uteco">uteco</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Max width" inputProps={{ inputMode: 'numeric' }} value={newMaxWidth} onChange={(e) => setNewMaxWidth(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Colours" inputProps={{ inputMode: 'numeric' }} value={newNumColours} onChange={(e) => setNewNumColours(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Min meters" inputProps={{ inputMode: 'numeric' }} value={newMinMeters} onChange={(e) => setNewMinMeters(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Min charge" inputProps={{ inputMode: 'numeric' }} disabled={newMethod !== 'inline'} value={newMinCharge} onChange={(e) => setNewMinCharge(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Setup fee" inputProps={{ inputMode: 'numeric' }} disabled={newMethod !== 'uteco'} value={newSetupFee} onChange={(e) => setNewSetupFee(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Cost / 1000m" inputProps={{ inputMode: 'numeric' }} value={newRate1000} onChange={(e) => setNewRate1000(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateTier}
                    onClick={() => {
                      if (!canCreateTier) return
                      void saveTier(
                        { method: newMethod, max_print_width_mm: Number(newMaxWidth), num_colours: Number(newNumColours) },
                        {
                          min_meters: Number(newMinMeters),
                          min_charge: newMethod === 'inline' ? Number(newMinCharge) : null,
                          setup_fee: newMethod === 'uteco' ? Number(newSetupFee) : null,
                          cost_per_1000m: Number(newRate1000),
                        },
                      ).then(() => {
                        setNewMaxWidth('')
                        setNewNumColours('')
                        setNewMinMeters('')
                        setNewMinCharge('')
                        setNewSetupFee('')
                        setNewRate1000('')
                      })
                    }}
                  >
                    Add tier
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Inks
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 160 }}>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 180 }}>Printer type</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {inks.map((i) => (
                <InkRow key={i.ink_code} row={i} saving={savingKey === `ink:${i.ink_code}`} onSave={saveInk} onDelete={deleteInk} />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newInkCode} onChange={(e) => setNewInkCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newInkName} onChange={(e) => setNewInkName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField select size="small" label="Printer type" value={newInkPrinterType} onChange={(e) => setNewInkPrinterType(e.target.value as any)} sx={{ minWidth: 160 }}>
                    <MenuItem value="inline">inline</MenuItem>
                    <MenuItem value="uteco">uteco</MenuItem>
                    <MenuItem value="both">both</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateInk || savingKey === `ink:${newInkCode.trim()}`}
                    onClick={() => {
                      if (!canCreateInk) return
                      void saveInk(newInkCode, { name: newInkName.trim(), printer_type: newInkPrinterType }).then(() => {
                        setNewInkCode('')
                        setNewInkName('')
                        setNewInkPrinterType('inline')
                      })
                    }}
                  >
                    Add ink
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Plates
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 240 }}>Customer</TableCell>
                <TableCell sx={{ width: 180 }}>Plate code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {platesSorted.map((p) => (
                <PlateRow
                  key={`${p.customer_id}__${p.plate_code}`}
                  row={p}
                  customersById={customersById}
                  saving={savingKey === `plate:${p.customer_id}__${p.plate_code}`}
                  onSave={savePlate}
                  onDelete={deletePlate}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField select size="small" label="Customer" value={newPlateCustomerId} onChange={(e) => setNewPlateCustomerId(e.target.value)} fullWidth>
                    <MenuItem value="">
                      <em>Select…</em>
                    </MenuItem>
                    {customers.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.code ? `${c.code} — ${c.name}` : c.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Plate code" value={newPlateCode} onChange={(e) => setNewPlateCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Description" value={newPlateDescription} onChange={(e) => setNewPlateDescription(e.target.value)} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreatePlate || savingKey === `plate:${newPlateCustomerId.trim()}__${newPlateCode.trim()}`}
                    onClick={() => {
                      if (!canCreatePlate) return
                      void savePlate(newPlateCustomerId, newPlateCode, { description: newPlateDescription.trim() || null }).then(() => {
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
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function TierRow(props: {
  row: PrintingPricingTier
  saving: boolean
  onSave: (
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<PrintingPricingTier, 'min_meters' | 'min_charge' | 'setup_fee' | 'cost_per_1000m'>,
  ) => Promise<void>
  onDelete: (key: { method: string; max_print_width_mm: number; num_colours: number }) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [minMeters, setMinMeters] = useState<number | ''>(row.min_meters)
  const [minCharge, setMinCharge] = useState<number | ''>(row.min_charge ?? '')
  const [setupFee, setSetupFee] = useState<number | ''>(row.setup_fee ?? '')
  const [rate, setRate] = useState<number | ''>(row.cost_per_1000m)
  const dirty = minMeters !== row.min_meters || minCharge !== (row.min_charge ?? '') || setupFee !== (row.setup_fee ?? '') || rate !== row.cost_per_1000m
  const key = { method: row.method, max_print_width_mm: row.max_print_width_mm, num_colours: row.num_colours }
  return (
    <TableRow hover>
      <TableCell>{row.method}</TableCell>
      <TableCell>{row.max_print_width_mm}</TableCell>
      <TableCell>{row.num_colours}</TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={minMeters} onChange={(e) => setMinMeters(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} disabled={row.method !== 'inline'} value={minCharge} onChange={(e) => setMinCharge(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} disabled={row.method !== 'uteco'} value={setupFee} onChange={(e) => setSetupFee(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={rate} onChange={(e) => setRate(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || minMeters === '' || rate === '' || (row.method === 'inline' && minCharge === '') || (row.method === 'uteco' && setupFee === '')}
            onClick={() =>
              void onSave(key, {
                min_meters: Number(minMeters),
                min_charge: row.method === 'inline' ? Number(minCharge) : null,
                setup_fee: row.method === 'uteco' ? Number(setupFee) : null,
                cost_per_1000m: Number(rate),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(key)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function InkRow(props: {
  row: Ink
  saving: boolean
  onSave: (code: string, patch: Omit<Ink, 'ink_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [printerType, setPrinterType] = useState(row.printer_type as any)
  const dirty = name !== row.name || printerType !== row.printer_type
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.ink_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField select size="small" value={printerType} onChange={(e) => setPrinterType(e.target.value as any)} sx={{ minWidth: 160 }}>
          <MenuItem value="inline">inline</MenuItem>
          <MenuItem value="uteco">uteco</MenuItem>
          <MenuItem value="both">both</MenuItem>
        </TextField>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" variant="outlined" disabled={saving || !dirty || !name.trim()} onClick={() => void onSave(row.ink_code, { name: name.trim(), printer_type: printerType })}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.ink_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function PlateRow(props: {
  row: Plate
  customersById: Map<string, CustomerSummary>
  saving: boolean
  onSave: (customerId: string, plateCode: string, patch: Omit<Plate, 'customer_id' | 'plate_code'>) => Promise<void>
  onDelete: (customerId: string, plateCode: string) => Promise<void>
}) {
  const { row, customersById, saving, onSave, onDelete } = props
  const cust = customersById.get(row.customer_id)
  const [desc, setDesc] = useState(row.description || '')
  const dirty = desc !== (row.description || '')
  return (
    <TableRow hover>
      <TableCell>{cust?.code ? `${cust.code} — ${cust.name}` : cust?.name || row.customer_id}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.plate_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={desc} onChange={(e) => setDesc(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" variant="outlined" disabled={saving || !dirty} onClick={() => void onSave(row.customer_id, row.plate_code, { description: desc.trim() || null })}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.customer_id, row.plate_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}


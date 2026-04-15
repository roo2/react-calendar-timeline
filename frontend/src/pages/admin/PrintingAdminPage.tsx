import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, MenuItem, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchCustomers } from '../../store/slices/customersSlice'
import {
  adminDeleteInk,
  adminDeletePlate,
  adminDeletePrintingTier,
  adminSaveInk,
  adminSavePlate,
  adminSavePrintingTier,
  fetchAdminPrintingBundle,
} from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { CustomerSummary, Ink, Plate, PrintingPricingTier } from './types'

function tierKey(t: { method: string; max_print_width_mm: number; num_colours: number }) {
  const m = (t.method || '').trim().toLowerCase()
  return `${m}:${t.max_print_width_mm}:${t.num_colours}`
}

export function PrintingAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const tiers = useAppSelector((s) => s.adminRateCards.printingPricingTiers.items)
  const inks = useAppSelector((s) => s.adminRateCards.inks.items)
  const plates = useAppSelector((s) => s.adminRateCards.plates.items)
  const customers = useAppSelector((s) => s.customers.list.items) as CustomerSummary[]
  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const { status, error: bundleErr } = useAppSelector((s) => s.adminRateCards.printingBundle)
  const loading = status === 'loading'

  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [niMaxW, setNiMaxW] = useState<number | ''>('')
  const [niColours, setNiColours] = useState<number | ''>('')
  const [niMinM, setNiMinM] = useState<number | ''>('')
  const [niMinCharge, setNiMinCharge] = useState<number | ''>('')
  const [niSetupCost, setNiSetupCost] = useState<number | ''>('')
  const [niSetupPrice, setNiSetupPrice] = useState<number | ''>('')
  const [niCostPer1000, setNiCostPer1000] = useState<number | ''>('')
  const [niPricePer1000, setNiPricePer1000] = useState<number | ''>('')

  const [nuMaxW, setNuMaxW] = useState<number | ''>('')
  const [nuColours, setNuColours] = useState<number | ''>('')
  const [nuMinM, setNuMinM] = useState<number | ''>('')
  const [nuSetupCost, setNuSetupCost] = useState<number | ''>('')
  const [nuSetupPrice, setNuSetupPrice] = useState<number | ''>('')
  const [nuCostPer1000, setNuCostPer1000] = useState<number | ''>('')
  const [nuPricePer1000, setNuPricePer1000] = useState<number | ''>('')
  const [nuMpm, setNuMpm] = useState<number | ''>('')

  const canCreateInlineTier = useMemo(() => {
    if (niMaxW === '' || Number(niMaxW) <= 0) return false
    if (niColours === '' || Number(niColours) < 1) return false
    if (niMinM === '' || Number(niMinM) < 0) return false
    if (niCostPer1000 === '' || Number(niCostPer1000) < 0) return false
    if (niPricePer1000 === '' || Number(niPricePer1000) < 0) return false
    return (
      niMinCharge !== '' &&
      Number(niMinCharge) >= 0 &&
      niSetupCost !== '' &&
      Number(niSetupCost) >= 0 &&
      niSetupPrice !== '' &&
      Number(niSetupPrice) >= 0
    )
  }, [niColours, niMaxW, niMinCharge, niMinM, niCostPer1000, niPricePer1000, niSetupCost, niSetupPrice])

  const canCreateUtecoTier = useMemo(() => {
    if (nuMaxW === '' || Number(nuMaxW) <= 0) return false
    if (nuColours === '' || Number(nuColours) < 1) return false
    if (nuMinM === '' || Number(nuMinM) < 0) return false
    if (nuCostPer1000 === '' || Number(nuCostPer1000) < 0) return false
    if (nuPricePer1000 === '' || Number(nuPricePer1000) < 0) return false
    return (
      nuSetupCost !== '' &&
      Number(nuSetupCost) >= 0 &&
      nuSetupPrice !== '' &&
      Number(nuSetupPrice) >= 0
    )
  }, [nuColours, nuMaxW, nuMinM, nuCostPer1000, nuPricePer1000, nuSetupCost, nuSetupPrice])

  const [newInkCode, setNewInkCode] = useState('')
  const [newInkName, setNewInkName] = useState('')
  const [newInkPrinterType, setNewInkPrinterType] = useState<'inline' | 'uteco' | 'both'>('inline')
  const canCreateInk = useMemo(() => !!newInkCode.trim() && !!newInkName.trim(), [newInkCode, newInkName])

  const [newPlateCustomerId, setNewPlateCustomerId] = useState('')
  const [newPlateCode, setNewPlateCode] = useState('')
  const [newPlateDescription, setNewPlateDescription] = useState('')
  const canCreatePlate = useMemo(() => !!newPlateCustomerId.trim() && !!newPlateCode.trim(), [newPlateCode, newPlateCustomerId])

  useEffect(() => {
    void dispatch(fetchAdminPrintingBundle())
    void dispatch(fetchCustomers(undefined))
  }, [dispatch])

  const displayErr = err || bundleErr

  async function saveInk(code: string, patch: Omit<Ink, 'ink_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`ink:${trimmed}`)
      await dispatch(adminSaveInk({ code: trimmed, patch })).unwrap()
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
      await dispatch(adminDeleteInk(trimmed)).unwrap()
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
      await dispatch(adminSavePlate({ customerId: cid, plateCode: code, patch })).unwrap()
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
      await dispatch(adminDeletePlate({ customerId: cid, plateCode: code })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete plate')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveTier(
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<
      PrintingPricingTier,
      'min_meters' | 'min_charge' | 'setup_cost' | 'setup_price' | 'cost_per_1000m' | 'price_per_1000m' | 'meters_per_min'
    >,
  ) {
    const m = (key.method || '').trim().toLowerCase()
    if (!m) return
    const k = `tier:${tierKey({ method: m, max_print_width_mm: key.max_print_width_mm, num_colours: key.num_colours })}`
    try {
      setErr(null)
      setSavingKey(k)
      await dispatch(adminSavePrintingTier({ key: { ...key, method: m }, patch })).unwrap()
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
      await dispatch(adminDeletePrintingTier({ ...key, method: m })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete printing tier')
    } finally {
      setSavingKey(null)
    }
  }

  const inlineTiers = useMemo(() => {
    return (tiers || [])
      .filter((t) => (t.method || '').toLowerCase() === 'inline')
      .slice()
      .sort((a, b) => a.max_print_width_mm - b.max_print_width_mm || a.num_colours - b.num_colours)
  }, [tiers])

  const utecoTiers = useMemo(() => {
    return (tiers || [])
      .filter((t) => (t.method || '').toLowerCase() === 'uteco')
      .slice()
      .sort((a, b) => a.max_print_width_mm - b.max_print_width_mm || a.num_colours - b.num_colours)
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
      <AdminPageHeader
        title="Printing"
        subtitle="Inline and Uteco printing pricing, inks, and plates."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Inline printing — pricing tiers
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Cost columns drive quote cost; price columns drive quote sell-side printing. Inline price uses the greater of min
          charge or length-based price (per 1000m).
        </Typography>
        {loading && tiers.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>Max width (mm)</TableCell>
                <TableCell sx={{ width: 100 }}>Colours</TableCell>
                <TableCell sx={{ width: 120 }}>Min meters</TableCell>
                <TableCell sx={{ width: 120 }}>Min charge</TableCell>
                <TableCell sx={{ width: 120 }}>Setup cost</TableCell>
                <TableCell sx={{ width: 120 }}>Setup price</TableCell>
                <TableCell sx={{ width: 120 }}>Cost / 1000m</TableCell>
                <TableCell sx={{ width: 120 }}>Price / 1000m</TableCell>
                <TableCell sx={{ width: 200 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {inlineTiers.map((t) => (
                <TierRow
                  key={tierKey(t)}
                  tierVariant="inline"
                  row={t}
                  saving={savingKey === `tier:${tierKey(t)}`}
                  onSave={saveTier}
                  onDelete={deleteTier}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Max width" inputProps={{ inputMode: 'numeric' }} value={niMaxW} onChange={(e) => setNiMaxW(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Colours" inputProps={{ inputMode: 'numeric' }} value={niColours} onChange={(e) => setNiColours(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Min meters" inputProps={{ inputMode: 'numeric' }} value={niMinM} onChange={(e) => setNiMinM(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Min charge" inputProps={{ inputMode: 'numeric' }} value={niMinCharge} onChange={(e) => setNiMinCharge(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Setup cost" inputProps={{ inputMode: 'numeric' }} value={niSetupCost} onChange={(e) => setNiSetupCost(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Setup price" inputProps={{ inputMode: 'numeric' }} value={niSetupPrice} onChange={(e) => setNiSetupPrice(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Cost / 1000m" inputProps={{ inputMode: 'numeric' }} value={niCostPer1000} onChange={(e) => setNiCostPer1000(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Price / 1000m" inputProps={{ inputMode: 'numeric' }} value={niPricePer1000} onChange={(e) => setNiPricePer1000(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateInlineTier}
                    onClick={() => {
                      if (!canCreateInlineTier) return
                      void saveTier(
                        { method: 'inline', max_print_width_mm: Number(niMaxW), num_colours: Number(niColours) },
                        {
                          min_meters: Number(niMinM),
                          min_charge: Number(niMinCharge),
                          setup_cost: Number(niSetupCost),
                          setup_price: Number(niSetupPrice),
                          cost_per_1000m: Number(niCostPer1000),
                          price_per_1000m: Number(niPricePer1000),
                          meters_per_min: null,
                        },
                      ).then(() => {
                        setNiMaxW('')
                        setNiColours('')
                        setNiMinM('')
                        setNiMinCharge('')
                        setNiSetupCost('')
                        setNiSetupPrice('')
                        setNiCostPer1000('')
                        setNiPricePer1000('')
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
          Uteco printing — pricing tiers
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Cost vs price columns as for Inline. Min charge is not used for Uteco. M/min drives Uteco bar length on the schedule
          (job web meters ÷ m/min).
        </Typography>
        {loading && tiers.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>Max width (mm)</TableCell>
                <TableCell sx={{ width: 100 }}>Colours</TableCell>
                <TableCell sx={{ width: 120 }}>Min meters</TableCell>
                <TableCell sx={{ width: 120 }}>Setup cost</TableCell>
                <TableCell sx={{ width: 120 }}>Setup price</TableCell>
                <TableCell sx={{ width: 120 }}>Cost / 1000m</TableCell>
                <TableCell sx={{ width: 120 }}>Price / 1000m</TableCell>
                <TableCell sx={{ width: 100 }}>M/min</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {utecoTiers.map((t) => (
                <TierRow
                  key={tierKey(t)}
                  tierVariant="uteco"
                  row={t}
                  saving={savingKey === `tier:${tierKey(t)}`}
                  onSave={saveTier}
                  onDelete={deleteTier}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Max width" inputProps={{ inputMode: 'numeric' }} value={nuMaxW} onChange={(e) => setNuMaxW(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Colours" inputProps={{ inputMode: 'numeric' }} value={nuColours} onChange={(e) => setNuColours(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Min meters" inputProps={{ inputMode: 'numeric' }} value={nuMinM} onChange={(e) => setNuMinM(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Setup cost" inputProps={{ inputMode: 'numeric' }} value={nuSetupCost} onChange={(e) => setNuSetupCost(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Setup price" inputProps={{ inputMode: 'numeric' }} value={nuSetupPrice} onChange={(e) => setNuSetupPrice(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Cost / 1000m" inputProps={{ inputMode: 'numeric' }} value={nuCostPer1000} onChange={(e) => setNuCostPer1000(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Price / 1000m" inputProps={{ inputMode: 'numeric' }} value={nuPricePer1000} onChange={(e) => setNuPricePer1000(e.target.value ? parseFloat(e.target.value) : '')} />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="M/min"
                    inputProps={{ inputMode: 'decimal', min: 0, step: 'any' }}
                    value={nuMpm}
                    onChange={(e) => setNuMpm(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateUtecoTier}
                    onClick={() => {
                      if (!canCreateUtecoTier) return
                      void saveTier(
                        { method: 'uteco', max_print_width_mm: Number(nuMaxW), num_colours: Number(nuColours) },
                        {
                          min_meters: Number(nuMinM),
                          min_charge: null,
                          setup_cost: Number(nuSetupCost),
                          setup_price: Number(nuSetupPrice),
                          cost_per_1000m: Number(nuCostPer1000),
                          price_per_1000m: Number(nuPricePer1000),
                          meters_per_min: nuMpm === '' ? null : Number(nuMpm),
                        },
                      ).then(() => {
                        setNuMaxW('')
                        setNuColours('')
                        setNuMinM('')
                        setNuSetupCost('')
                        setNuSetupPrice('')
                        setNuCostPer1000('')
                        setNuPricePer1000('')
                        setNuMpm('')
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
        {loading && inks.length === 0 ? (
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
        {loading && plates.length === 0 ? (
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
  tierVariant: 'inline' | 'uteco'
  row: PrintingPricingTier
  saving: boolean
  onSave: (
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<
      PrintingPricingTier,
      'min_meters' | 'min_charge' | 'setup_cost' | 'setup_price' | 'cost_per_1000m' | 'price_per_1000m' | 'meters_per_min'
    >,
  ) => Promise<void>
  onDelete: (key: { method: string; max_print_width_mm: number; num_colours: number }) => Promise<void>
}) {
  const { tierVariant, row, saving, onSave, onDelete } = props
  const [minMeters, setMinMeters] = useState<number | ''>(row.min_meters)
  const [minCharge, setMinCharge] = useState<number | ''>(row.min_charge ?? '')
  const [setupCost, setSetupCost] = useState<number | ''>(Number(row.setup_cost ?? 0))
  const [setupPrice, setSetupPrice] = useState<number | ''>(row.setup_price != null ? Number(row.setup_price) : '')
  const [costPer1000, setCostPer1000] = useState<number | ''>(row.cost_per_1000m)
  const [pricePer1000, setPricePer1000] = useState<number | ''>(row.price_per_1000m)
  const [metersPerMin, setMetersPerMin] = useState<number | ''>(row.meters_per_min ?? '')
  const isInline = tierVariant === 'inline'

  useEffect(() => {
    setMinMeters(row.min_meters)
    setMinCharge(row.min_charge ?? '')
    setSetupCost(Number(row.setup_cost ?? 0))
    setSetupPrice(row.setup_price != null ? Number(row.setup_price) : '')
    setCostPer1000(row.cost_per_1000m)
    setPricePer1000(row.price_per_1000m)
    setMetersPerMin(row.meters_per_min ?? '')
  }, [
    row.method,
    row.max_print_width_mm,
    row.num_colours,
    row.min_meters,
    row.min_charge,
    row.setup_cost,
    row.setup_price,
    row.cost_per_1000m,
    row.price_per_1000m,
    row.meters_per_min,
  ])

  const dirty =
    minMeters !== row.min_meters ||
    minCharge !== (row.min_charge ?? '') ||
    setupCost !== Number(row.setup_cost ?? 0) ||
    setupPrice !== (row.setup_price != null ? Number(row.setup_price) : '') ||
    costPer1000 !== row.cost_per_1000m ||
    pricePer1000 !== row.price_per_1000m ||
    (!isInline && metersPerMin !== (row.meters_per_min ?? ''))
  const key = { method: row.method, max_print_width_mm: row.max_print_width_mm, num_colours: row.num_colours }
  return (
    <TableRow hover>
      <TableCell>{row.max_print_width_mm}</TableCell>
      <TableCell>{row.num_colours}</TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={minMeters} onChange={(e) => setMinMeters(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      {isInline ? (
        <TableCell>
          <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={minCharge} onChange={(e) => setMinCharge(e.target.value ? parseFloat(e.target.value) : '')} />
        </TableCell>
      ) : null}
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={setupCost} onChange={(e) => setSetupCost(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={setupPrice} onChange={(e) => setSetupPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={costPer1000} onChange={(e) => setCostPer1000(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={pricePer1000} onChange={(e) => setPricePer1000(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      {!isInline ? (
        <TableCell>
          <TextField
            size="small"
            inputProps={{ inputMode: 'decimal', min: 0, step: 'any' }}
            value={metersPerMin}
            onChange={(e) => setMetersPerMin(e.target.value ? parseFloat(e.target.value) : '')}
            placeholder="—"
          />
        </TableCell>
      ) : null}
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={
              saving ||
              !dirty ||
              minMeters === '' ||
              costPer1000 === '' ||
              pricePer1000 === '' ||
              setupCost === '' ||
              setupPrice === '' ||
              (isInline && minCharge === '')
            }
            onClick={() =>
              void onSave(key, {
                min_meters: Number(minMeters),
                min_charge: isInline ? Number(minCharge) : null,
                setup_cost: Number(setupCost),
                setup_price: Number(setupPrice),
                cost_per_1000m: Number(costPer1000),
                price_per_1000m: Number(pricePer1000),
                meters_per_min: isInline ? null : metersPerMin === '' ? null : Number(metersPerMin),
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


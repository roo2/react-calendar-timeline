import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { ResinSelect, type ResinOption } from '../components/ResinSelect'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchCustomers } from '../store/slices/customersSlice'
import {
  adminDeleteAdditive,
  adminDeleteColour,
  adminDeleteCore,
  adminDeleteExtruder,
  adminDeleteExtrusionWasteFactor,
  adminDeleteInk,
  adminDeletePlate,
  adminDeletePrintingTier,
  adminDeleteResin,
  adminDeleteResinBlend,
  adminSaveAdditive,
  adminSaveColour,
  adminSaveCore,
  adminSaveExtruder,
  adminSaveExtrusionWasteFactor,
  adminSaveInk,
  adminSavePlate,
  adminSavePrintingTier,
  adminSaveResin,
  adminSaveResinBlend,
  fetchAdminHub,
} from '../store/slices/adminRateCardsSlice'
import type {
  Additive,
  Colour,
  Core,
  CustomerSummary,
  Extruder,
  ExtrusionWasteFactor,
  Ink,
  Plate,
  PrintingPricingTier,
  Resin,
  ResinBlend,
} from './admin/types'

function AdminDataTable(props: { children: ReactNode }) {
  return (
    <Table size="small" sx={{ width: '100%' }}>
      {props.children}
    </Table>
  )
}

export function AdminPage() {
  const dispatch = useAppDispatch()
  const resins = useAppSelector((s) => s.adminRateCards.resins.items)
  const additives = useAppSelector((s) => s.adminRateCards.additives.items)
  const colours = useAppSelector((s) => s.adminRateCards.colours.items)
  const cores = useAppSelector((s) => s.adminRateCards.cores.items)
  const extruders = useAppSelector((s) => s.adminRateCards.extruders.items)
  const extrusionWasteFactors = useAppSelector((s) => s.adminRateCards.extrusionWasteFactors.items)
  const inks = useAppSelector((s) => s.adminRateCards.inks.items)
  const plates = useAppSelector((s) => s.adminRateCards.plates.items)
  const printingPricingTiers = useAppSelector((s) => s.adminRateCards.printingPricingTiers.items)
  const customers = useAppSelector((s) => s.customers.list.items) as CustomerSummary[]
  const { status: hubStatus, error: hubErr } = useAppSelector((s) => s.adminRateCards.hub)
  const custListErr = useAppSelector((s) => s.customers.list.error)
  const loading = hubStatus === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [savingAdditiveCode, setSavingAdditiveCode] = useState<string | null>(null)
  const [savingColourCode, setSavingColourCode] = useState<string | null>(null)
  const [savingCoreType, setSavingCoreType] = useState<string | null>(null)
  const [savingExtruderCode, setSavingExtruderCode] = useState<string | null>(null)
  const [savingExtrusionWasteFactor, setSavingExtrusionWasteFactor] = useState<string | null>(null)
  const [savingInkCode, setSavingInkCode] = useState<string | null>(null)
  const [savingPlateKey, setSavingPlateKey] = useState<string | null>(null)
  const [savingPrintingTierKey, setSavingPrintingTierKey] = useState<string | null>(null)
  const resinBlends = useAppSelector((s) => s.adminRateCards.resinBlends.items)
  const [savingBlendCode, setSavingBlendCode] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newDensity, setNewDensity] = useState<number | ''>('')
  const [newPrice, setNewPrice] = useState<number | ''>('')

  const [newAdditiveCode, setNewAdditiveCode] = useState('')
  const [newAdditiveName, setNewAdditiveName] = useState('')
  const [newAdditivePrice, setNewAdditivePrice] = useState<number | ''>('')

  const [newColourCode, setNewColourCode] = useState('')
  const [newColourName, setNewColourName] = useState('')
  const [newColourPrice, setNewColourPrice] = useState<number | ''>('')
  const [newColourShortCode, setNewColourShortCode] = useState('')

  const [newCoreType, setNewCoreType] = useState('')
  const [newCoreDescription, setNewCoreDescription] = useState('')
  const [newCoreCostPerM, setNewCoreCostPerM] = useState<number | ''>('')
  const [newCoreKgPerM, setNewCoreKgPerM] = useState<number | ''>('')

  const [newInkCode, setNewInkCode] = useState('')
  const [newInkName, setNewInkName] = useState('')
  const [newInkPrinterType, setNewInkPrinterType] = useState<'inline' | 'uteco' | 'both'>('inline')

  const [newPlateCustomerId, setNewPlateCustomerId] = useState('')
  const [newPlateCode, setNewPlateCode] = useState('')
  const [newPlateDescription, setNewPlateDescription] = useState('')

  const [newExtruderCode, setNewExtruderCode] = useState('')
  const [newExtruderModel, setNewExtruderModel] = useState('')
  const [newExtruderWMin, setNewExtruderWMin] = useState<number | ''>('')
  const [newExtruderWMax, setNewExtruderWMax] = useState<number | ''>('')
  const [newExtruderDecisionW, setNewExtruderDecisionW] = useState<number | ''>('')
  const [newExtruderAvgKgHr, setNewExtruderAvgKgHr] = useState<number | ''>('')
  const [newExtruderAveW, setNewExtruderAveW] = useState<number | ''>('')
  const [newExtruderCostPerHr, setNewExtruderCostPerHr] = useState<number | ''>('')

  const [newPrintingTierMethod, setNewPrintingTierMethod] = useState<'inline' | 'uteco'>('inline')
  const [newPrintingTierMaxWidthMm, setNewPrintingTierMaxWidthMm] = useState<number | ''>('')
  const [newPrintingTierNumColours, setNewPrintingTierNumColours] = useState<number | ''>('')
  const [newPrintingTierMinMeters, setNewPrintingTierMinMeters] = useState<number | ''>('')
  const [newPrintingTierMinCharge, setNewPrintingTierMinCharge] = useState<number | ''>('')
  const [newPrintingTierSetupFee, setNewPrintingTierSetupFee] = useState<number | ''>('')
  const [newPrintingTierRate1000, setNewPrintingTierRate1000] = useState<number | ''>('')

  const [newWasteFactor, setNewWasteFactor] = useState('')
  const [newWasteMinutes, setNewWasteMinutes] = useState('')

  const [newBlendCode, setNewBlendCode] = useState('')
  const [newBlendName, setNewBlendName] = useState('')
  const [newBlendComponents, setNewBlendComponents] = useState<Array<{ resin_code: string; pct: number | '' }>>([
    { resin_code: '', pct: 100 },
  ])

  function confirmDelete(label: string) {
    return window.confirm(`Delete ${label}? This cannot be undone.`)
  }

  const resinOptions: ResinOption[] = useMemo(
    () =>
      (resins || []).map((r) => ({
        resin_code: r.resin_code,
        name: r.name,
      })),
    [resins],
  )

  const canCreate = useMemo(() => {
    return !!newCode.trim() && !!newName.trim() && newDensity !== '' && newPrice !== ''
  }, [newCode, newDensity, newName, newPrice])

  const canCreateAdditive = useMemo(() => {
    return !!newAdditiveCode.trim() && !!newAdditiveName.trim() && newAdditivePrice !== ''
  }, [newAdditiveCode, newAdditiveName, newAdditivePrice])

  const canCreateColour = useMemo(() => {
    return !!newColourCode.trim() && !!newColourName.trim() && newColourPrice !== ''
  }, [newColourCode, newColourName, newColourPrice])

  const canCreateCore = useMemo(() => {
    return !!newCoreType.trim() && newCoreCostPerM !== '' && newCoreKgPerM !== ''
  }, [newCoreCostPerM, newCoreKgPerM, newCoreType])

  const canCreateInk = useMemo(() => {
    return !!newInkCode.trim() && !!newInkName.trim()
  }, [newInkCode, newInkName])

  const canCreatePlate = useMemo(() => {
    return !!newPlateCustomerId.trim() && !!newPlateCode.trim()
  }, [newPlateCode, newPlateCustomerId])

  const canCreateExtruder = useMemo(() => {
    return !!newExtruderCode.trim()
  }, [newExtruderCode])

  const canCreatePrintingTier = useMemo(() => {
    return (
      !!newPrintingTierMethod &&
      newPrintingTierMaxWidthMm !== '' &&
      Number(newPrintingTierMaxWidthMm) > 0 &&
      newPrintingTierNumColours !== '' &&
      Number(newPrintingTierNumColours) >= 1 &&
      newPrintingTierMinMeters !== '' &&
      Number(newPrintingTierMinMeters) >= 0 &&
      newPrintingTierRate1000 !== '' &&
      Number(newPrintingTierRate1000) >= 0 &&
      (newPrintingTierMethod !== 'inline' || (newPrintingTierMinCharge !== '' && Number(newPrintingTierMinCharge) >= 0)) &&
      (newPrintingTierMethod !== 'uteco' || (newPrintingTierSetupFee !== '' && Number(newPrintingTierSetupFee) >= 0))
    )
  }, [
    newPrintingTierMaxWidthMm,
    newPrintingTierMethod,
    newPrintingTierMinCharge,
    newPrintingTierMinMeters,
    newPrintingTierNumColours,
    newPrintingTierRate1000,
    newPrintingTierSetupFee,
  ])

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
    void dispatch(fetchAdminHub())
    void dispatch(fetchCustomers(undefined))
  }, [dispatch])

  const displayErr = err || hubErr || custListErr

  async function saveResin(code: string, patch: Omit<Resin, 'resin_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingCode(trimmed)
      await dispatch(adminSaveResin({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin')
    } finally {
      setSavingCode(null)
    }
  }

  async function deleteResin(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`resin '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingCode(trimmed)
      await dispatch(adminDeleteResin(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete resin')
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
      await dispatch(adminSaveResinBlend({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin blend')
    } finally {
      setSavingBlendCode(null)
    }
  }

  async function deleteBlend(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`resin blend '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingBlendCode(trimmed)
      await dispatch(adminDeleteResinBlend(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete resin blend')
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
      await dispatch(adminSaveAdditive({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save additive')
    } finally {
      setSavingAdditiveCode(null)
    }
  }

  async function deleteAdditive(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`additive '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingAdditiveCode(trimmed)
      await dispatch(adminDeleteAdditive(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete additive')
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
      await dispatch(adminSaveColour({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save colour')
    } finally {
      setSavingColourCode(null)
    }
  }

  async function deleteColour(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`colour '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingColourCode(trimmed)
      await dispatch(adminDeleteColour(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete colour')
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
      await dispatch(adminSaveCore({ coreType: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save core')
    } finally {
      setSavingCoreType(null)
    }
  }

  async function deleteCore(coreType: string) {
    const trimmed = coreType.trim()
    if (!trimmed) return
    if (!confirmDelete(`core '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingCoreType(trimmed)
      await dispatch(adminDeleteCore(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete core')
    } finally {
      setSavingCoreType(null)
    }
  }

  async function saveExtruder(code: string, patch: Omit<Extruder, 'extruder_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingExtruderCode(trimmed)
      await dispatch(adminSaveExtruder({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save extruder')
    } finally {
      setSavingExtruderCode(null)
    }
  }

  async function deleteExtruder(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`extruder '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingExtruderCode(trimmed)
      await dispatch(adminDeleteExtruder(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete extruder')
    } finally {
      setSavingExtruderCode(null)
    }
  }

  async function saveExtrusionWasteFactor(factor: string, patch: Omit<ExtrusionWasteFactor, 'factor'>) {
    const trimmed = factor.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingExtrusionWasteFactor(trimmed)
      await dispatch(adminSaveExtrusionWasteFactor({ factor: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save waste factor')
    } finally {
      setSavingExtrusionWasteFactor(null)
    }
  }

  async function deleteExtrusionWasteFactor(factor: string) {
    const trimmed = factor.trim()
    if (!trimmed) return
    if (!confirmDelete(`waste factor '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingExtrusionWasteFactor(trimmed)
      await dispatch(adminDeleteExtrusionWasteFactor(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete waste factor')
    } finally {
      setSavingExtrusionWasteFactor(null)
    }
  }

  async function saveInk(code: string, patch: Omit<Ink, 'ink_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingInkCode(trimmed)
      await dispatch(adminSaveInk({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save ink')
    } finally {
      setSavingInkCode(null)
    }
  }

  async function deleteInk(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`ink '${trimmed}'`)) return
    try {
      setErr(null)
      setSavingInkCode(trimmed)
      await dispatch(adminDeleteInk(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete ink')
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
      await dispatch(adminSavePlate({ customerId: cid, plateCode: code, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save plate')
    } finally {
      setSavingPlateKey(null)
    }
  }

  async function deletePlate(customerId: string, plateCode: string) {
    const cid = customerId.trim()
    const code = plateCode.trim()
    const key = `${cid}__${code}`
    if (!cid || !code) return
    if (!confirmDelete(`plate '${code}' for customer '${customersById.get(cid)?.code || cid}'`)) return
    try {
      setErr(null)
      setSavingPlateKey(key)
      await dispatch(adminDeletePlate({ customerId: cid, plateCode: code })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete plate')
    } finally {
      setSavingPlateKey(null)
    }
  }

  async function savePrintingPricingTier(
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<PrintingPricingTier, 'min_meters' | 'min_charge' | 'setup_fee' | 'cost_per_1000m'>,
  ) {
    const m = (key.method || '').trim().toLowerCase()
    if (!m) return
    try {
      setErr(null)
      const k = `${m}:${key.max_print_width_mm}:${key.num_colours}`
      setSavingPrintingTierKey(k)
      await dispatch(adminSavePrintingTier({ key: { ...key, method: m }, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save printing tier')
    } finally {
      setSavingPrintingTierKey(null)
    }
  }

  async function deletePrintingPricingTier(key: { method: string; max_print_width_mm: number; num_colours: number }) {
    const m = (key.method || '').trim().toLowerCase()
    if (!m) return
    const k = `${m}:${key.max_print_width_mm}:${key.num_colours}`
    if (!confirmDelete(`printing tier '${k}'`)) return
    try {
      setErr(null)
      setSavingPrintingTierKey(k)
      await dispatch(adminDeletePrintingTier({ ...key, method: m })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete printing tier')
    } finally {
      setSavingPrintingTierKey(null)
    }
  }

  return (
    <Box
      sx={{
        '& .MuiTableCell-root': { px: 1, py: 0.5 },
        '& .MuiTextField-root .MuiInputBase-input': { px: 1, py: 1 },
      }}
    >
      <Typography variant="h5" sx={{ mb: 2 }}>
        Admin
      </Typography>

      <Stack spacing={2}>
        {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

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
              <AdminDataTable>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 140 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 140 }}>Density</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {resins.map((r) => (
                    <ResinRow
                      key={r.resin_code}
                      resin={r}
                      saving={savingCode === r.resin_code}
                      onSave={saveResin}
                      onDelete={deleteResin}
                    />
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
                        inputProps={{ inputMode: 'decimal' }}
                        value={newDensity}
                        onChange={(e) => setNewDensity(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Price / kg"
                        inputProps={{ inputMode: 'decimal' }}
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
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
                          }).then(() => {
                            setNewCode('')
                            setNewName('')
                            setNewDensity('')
                            setNewPrice('')
                          })
                        }}
                      >
                        Add resin
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </AdminDataTable>
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
              <AdminDataTable>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 180 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {additives.map((a) => (
                    <AdditiveRow
                      key={a.additive_code}
                      additive={a}
                      saving={savingAdditiveCode === a.additive_code}
                      onSave={saveAdditive}
                      onDelete={deleteAdditive}
                    />
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
                        inputProps={{ inputMode: 'decimal' }}
                        value={newAdditivePrice}
                        onChange={(e) => setNewAdditivePrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
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
                          }).then(() => {
                            setNewAdditiveCode('')
                            setNewAdditiveName('')
                            setNewAdditivePrice('')
                          })
                        }}
                      >
                        Add additive
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </AdminDataTable>
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
              <AdminDataTable>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 180 }}>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                    <TableCell sx={{ width: 80 }}>Short</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {colours.map((c) => (
                    <ColourRow
                      key={c.colour_code}
                      colour={c}
                      saving={savingColourCode === c.colour_code}
                      onSave={saveColour}
                      onDelete={deleteColour}
                    />
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
                        inputProps={{ inputMode: 'decimal' }}
                        value={newColourPrice}
                        onChange={(e) => setNewColourPrice(e.target.value ? parseFloat(e.target.value) : '')}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Short"
                        value={newColourShortCode}
                        onChange={(e) => setNewColourShortCode((e.target.value || '').slice(0, 3))}
                        inputProps={{ maxLength: 3 }}
                      />
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
                            sort_order: colours.length,
                            short_code: newColourShortCode.trim() || null,
                          }).then(() => {
                            setNewColourCode('')
                            setNewColourName('')
                            setNewColourPrice('')
                            setNewColourShortCode('')
                          })
                        }}
                      >
                        Add colour
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </AdminDataTable>
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
              <Paper variant="outlined" sx={{ p: 2 }}>
                <AdminDataTable>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 180 }}>Code</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Components</TableCell>
                      <TableCell sx={{ width: 180 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {resinBlends.map((b) => (
                      <ResinBlendRow
                        key={b.blend_code}
                        blend={b}
                        saving={savingBlendCode === b.blend_code}
                        onSave={saveBlend}
                        onDelete={deleteBlend}
                        resinOptions={resinOptions}
                      />
                    ))}
                    <ResinBlendRow
                      key="__new__"
                      blend={{
                        blend_code: newBlendCode,
                        name: newBlendName,
                        components: newBlendComponents
                          .filter((c) => c.resin_code.trim() && c.pct !== '')
                          .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) || 0 })),
                      }}
                      saving={savingBlendCode === newBlendCode.trim()}
                      resinOptions={resinOptions}
                      isNewRow
                      canSave={canCreateBlend}
                      onChangeNew={(next) => {
                        setNewBlendCode(next.blend_code)
                        setNewBlendName(next.name)
                        setNewBlendComponents(
                          (next.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct === 0 ? '' : c.pct })),
                        )
                      }}
                      onSave={() =>
                        saveBlend(newBlendCode, {
                          name: newBlendName.trim(),
                          components: newBlendComponents
                            .filter((c) => c.resin_code.trim() && c.pct !== '')
                            .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
                        }).then(() => {
                          setNewBlendCode('')
                          setNewBlendName('')
                          setNewBlendComponents([{ resin_code: '', pct: 100 }])
                        })
                      }
                      onDelete={async () => {
                        setNewBlendCode('')
                        setNewBlendName('')
                        setNewBlendComponents([{ resin_code: '', pct: 100 }])
                      }}
                    />
                  </TableBody>
                </AdminDataTable>
              </Paper>
            )}
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Extrusion
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Master data for extrusion planning and waste.
              </Typography>
            </Box>

            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Extruders
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {loading ? (
                <Typography color="text.secondary">Loading…</Typography>
              ) : (
                <AdminDataTable>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 110 }}>Code</TableCell>
                      <TableCell sx={{ width: 120 }}>Model</TableCell>
                      <TableCell sx={{ width: 110 }}>W min</TableCell>
                      <TableCell sx={{ width: 110 }}>W max</TableCell>
                      <TableCell sx={{ width: 130 }}>Decision W</TableCell>
                      <TableCell sx={{ width: 140 }}>Avg (kg/hr)</TableCell>
                      <TableCell sx={{ width: 110 }}>Ave W</TableCell>
                      <TableCell sx={{ width: 100 }}>Cost/hr ($)</TableCell>
                      <TableCell sx={{ width: 140 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {extruders.map((e) => (
                      <ExtruderRow
                        key={e.extruder_code}
                        extruder={e}
                        saving={savingExtruderCode === e.extruder_code}
                        onSave={saveExtruder}
                        onDelete={deleteExtruder}
                      />
                    ))}
                    <TableRow>
                      <TableCell>
                        <TextField size="small" label="Code" value={newExtruderCode} onChange={(ev) => setNewExtruderCode(ev.target.value)} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" label="Model" value={newExtruderModel} onChange={(e) => setNewExtruderModel(e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="W min"
                          inputProps={{ inputMode: 'numeric' }}
                          value={newExtruderWMin}
                          onChange={(e) => setNewExtruderWMin(e.target.value ? parseInt(e.target.value, 10) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="W max"
                          inputProps={{ inputMode: 'numeric' }}
                          value={newExtruderWMax}
                          onChange={(e) => setNewExtruderWMax(e.target.value ? parseInt(e.target.value, 10) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Decision W"
                          inputProps={{ inputMode: 'numeric' }}
                          value={newExtruderDecisionW}
                          onChange={(e) => setNewExtruderDecisionW(e.target.value ? parseInt(e.target.value, 10) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Avg"
                          inputProps={{ inputMode: 'numeric' }}
                          value={newExtruderAvgKgHr}
                          onChange={(e) => setNewExtruderAvgKgHr(e.target.value ? parseInt(e.target.value, 10) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Ave W"
                          inputProps={{ inputMode: 'decimal' }}
                          value={newExtruderAveW}
                          onChange={(e) => setNewExtruderAveW(e.target.value ? parseFloat(e.target.value) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Cost/hr ($)"
                          inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }}
                          value={newExtruderCostPerHr}
                          onChange={(e) => setNewExtruderCostPerHr(e.target.value ? parseFloat(e.target.value) : '')}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!canCreateExtruder || savingExtruderCode === newExtruderCode.trim()}
                          onClick={() => {
                            const code = newExtruderCode.trim()
                            if (!code) return
                            void saveExtruder(code, {
                              model: newExtruderModel.trim() ? newExtruderModel.trim() : null,
                              film_width_min_mm: newExtruderWMin === '' ? null : Number(newExtruderWMin),
                              film_width_max_mm: newExtruderWMax === '' ? null : Number(newExtruderWMax),
                              decision_width_mm: newExtruderDecisionW === '' ? null : Number(newExtruderDecisionW),
                              average_kg_hr: newExtruderAvgKgHr === '' ? null : Number(newExtruderAvgKgHr),
                              ave_width: newExtruderAveW === '' ? null : Number(newExtruderAveW),
                              cost_per_hr: newExtruderCostPerHr === '' ? null : Number(newExtruderCostPerHr),
                            }).then(() => {
                              setNewExtruderCode('')
                              setNewExtruderModel('')
                              setNewExtruderWMin('')
                              setNewExtruderWMax('')
                              setNewExtruderDecisionW('')
                              setNewExtruderAvgKgHr('')
                              setNewExtruderAveW('')
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

            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Extrusion waste factors
            </Typography>

            <Paper variant="outlined" sx={{ p: 2 }}>
              {loading ? (
                <Typography color="text.secondary">Loading…</Typography>
              ) : (
                <AdminDataTable>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 320 }}>Factor</TableCell>
                      <TableCell sx={{ width: 160 }}>Minutes</TableCell>
                      <TableCell sx={{ width: 140 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {extrusionWasteFactors.map((w) => (
                      <ExtrusionWasteFactorRow
                        key={w.factor}
                        wasteFactor={w}
                        saving={savingExtrusionWasteFactor === w.factor}
                        onSave={saveExtrusionWasteFactor}
                        onDelete={deleteExtrusionWasteFactor}
                      />
                    ))}
                    <TableRow>
                      <TableCell>
                        <TextField size="small" label="Factor" value={newWasteFactor} onChange={(ev) => setNewWasteFactor(ev.target.value)} />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Minutes"
                          inputProps={{ inputMode: 'numeric' }}
                          value={newWasteMinutes}
                          onChange={(ev) => setNewWasteMinutes(ev.target.value)}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={
                            !newWasteFactor.trim() ||
                            !newWasteMinutes.trim() ||
                            savingExtrusionWasteFactor === newWasteFactor.trim()
                          }
                          onClick={() => {
                            const f = newWasteFactor.trim()
                            const m = Number(newWasteMinutes)
                            if (!f || !Number.isFinite(m) || m < 0) return
                            void saveExtrusionWasteFactor(f, { minutes: Math.round(m) }).then(() => {
                              setNewWasteFactor('')
                              setNewWasteMinutes('')
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
                Printing pricing tiers
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                {loading ? (
                  <Typography color="text.secondary">Loading…</Typography>
                ) : (
                  <AdminDataTable>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 90 }}>Method</TableCell>
                        <TableCell sx={{ width: 110 }}>Max width</TableCell>
                        <TableCell sx={{ width: 90 }}>Colours</TableCell>
                        <TableCell sx={{ width: 120 }}>Min meters</TableCell>
                        <TableCell sx={{ width: 140 }}>Min charge</TableCell>
                        <TableCell sx={{ width: 140 }}>Setup fee</TableCell>
                        <TableCell sx={{ width: 140 }}>$ / 1000m</TableCell>
                        <TableCell sx={{ width: 140 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {printingPricingTiers.map((t) => (
                        <PrintingPricingTierRow
                          key={`${t.method}:${t.max_print_width_mm}:${t.num_colours}`}
                          tier={t}
                          saving={savingPrintingTierKey === `${t.method}:${t.max_print_width_mm}:${t.num_colours}`}
                          onSave={savePrintingPricingTier}
                          onDelete={deletePrintingPricingTier}
                        />
                      ))}
                      <TableRow>
                        <TableCell>
                          <TextField
                            size="small"
                            select
                            label="Method"
                            value={newPrintingTierMethod}
                            onChange={(e) => setNewPrintingTierMethod(e.target.value as any)}
                            sx={{ minWidth: 80 }}
                          >
                            <MenuItem value="inline">inline</MenuItem>
                            <MenuItem value="uteco">uteco</MenuItem>
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="Max width"
                            inputProps={{ inputMode: 'numeric' }}
                            value={newPrintingTierMaxWidthMm}
                            onChange={(e) => setNewPrintingTierMaxWidthMm(e.target.value ? parseInt(e.target.value, 10) : '')}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="Colours"
                            inputProps={{ inputMode: 'numeric' }}
                            value={newPrintingTierNumColours}
                            onChange={(e) => setNewPrintingTierNumColours(e.target.value ? parseInt(e.target.value, 10) : '')}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="Min meters"
                            inputProps={{ inputMode: 'numeric' }}
                            value={newPrintingTierMinMeters}
                            onChange={(e) => setNewPrintingTierMinMeters(e.target.value ? parseInt(e.target.value, 10) : '')}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="Min charge"
                            inputProps={{ inputMode: 'decimal' }}
                            value={newPrintingTierMethod === 'inline' ? newPrintingTierMinCharge : ''}
                            disabled={newPrintingTierMethod !== 'inline'}
                            onChange={(e) => setNewPrintingTierMinCharge(e.target.value ? parseFloat(e.target.value) : '')}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="Setup fee"
                            inputProps={{ inputMode: 'decimal' }}
                            value={newPrintingTierMethod === 'uteco' ? newPrintingTierSetupFee : ''}
                            disabled={newPrintingTierMethod !== 'uteco'}
                            onChange={(e) => setNewPrintingTierSetupFee(e.target.value ? parseFloat(e.target.value) : '')}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            label="$ / 1000m"
                            inputProps={{ inputMode: 'decimal' }}
                            value={newPrintingTierRate1000}
                            onChange={(e) => setNewPrintingTierRate1000(e.target.value ? parseFloat(e.target.value) : '')}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!canCreatePrintingTier || savingPrintingTierKey === `${newPrintingTierMethod}:${newPrintingTierMaxWidthMm}:${newPrintingTierNumColours}`}
                            onClick={() => {
                              if (!canCreatePrintingTier) return
                              const maxW = Number(newPrintingTierMaxWidthMm)
                              const nc = Number(newPrintingTierNumColours)
                              void savePrintingPricingTier(
                                { method: newPrintingTierMethod, max_print_width_mm: maxW, num_colours: nc },
                                {
                                  min_meters: Number(newPrintingTierMinMeters),
                                  min_charge: newPrintingTierMethod === 'inline' ? Number(newPrintingTierMinCharge) : null,
                                  setup_fee: newPrintingTierMethod === 'uteco' ? Number(newPrintingTierSetupFee) : null,
                                  cost_per_1000m: Number(newPrintingTierRate1000),
                                },
                              ).then(() => {
                                setNewPrintingTierMaxWidthMm('')
                                setNewPrintingTierNumColours('')
                                setNewPrintingTierMinMeters('')
                                setNewPrintingTierMinCharge('')
                                setNewPrintingTierSetupFee('')
                                setNewPrintingTierRate1000('')
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
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Ink
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                {loading ? (
                  <Typography color="text.secondary">Loading…</Typography>
                ) : (
                  <AdminDataTable>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 200 }}>Ink code</TableCell>
                        <TableCell>Colour name</TableCell>
                        <TableCell sx={{ width: 140 }}>Printer</TableCell>
                        <TableCell sx={{ width: 140 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {inks.map((i) => (
                        <InkRow
                          key={i.ink_code}
                          ink={i}
                          saving={savingInkCode === i.ink_code}
                          onSave={saveInk}
                          onDelete={deleteInk}
                        />
                      ))}
                      <TableRow>
                        <TableCell>
                          <TextField size="small" label="Ink code" value={newInkCode} onChange={(e) => setNewInkCode(e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" fullWidth label="Colour name" value={newInkName} onChange={(e) => setNewInkName(e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            select
                            label="Printer"
                            value={newInkPrinterType}
                            onChange={(e) => setNewInkPrinterType(e.target.value as any)}
                            sx={{ minWidth: 120 }}
                          >
                            <MenuItem value="inline">Inline</MenuItem>
                            <MenuItem value="uteco">Uteco</MenuItem>
                            <MenuItem value="both">Both</MenuItem>
                          </TextField>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!canCreateInk || savingInkCode === newInkCode.trim()}
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
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Plates
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                {loading ? (
                  <Typography color="text.secondary">Loading…</Typography>
                ) : (
                  <AdminDataTable>
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
                            onDelete={deletePlate}
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
                  </AdminDataTable>
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
                <AdminDataTable>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 140 }}>Type</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell sx={{ width: 170 }}>Cost / m</TableCell>
                      <TableCell sx={{ width: 170 }}>Kg / m</TableCell>
                      <TableCell sx={{ width: 140 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cores.map((c) => (
                      <CoreRow
                        key={c.core_type}
                        core={c}
                        saving={savingCoreType === c.core_type}
                        onSave={saveCore}
                        onDelete={deleteCore}
                      />
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
                          inputProps={{ inputMode: 'decimal' }}
                          value={newCoreCostPerM}
                          onChange={(e) => setNewCoreCostPerM(e.target.value ? parseFloat(e.target.value) : '')}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          label="Kg / m"
                          inputProps={{ inputMode: 'decimal' }}
                          value={newCoreKgPerM}
                          onChange={(e) => setNewCoreKgPerM(e.target.value ? parseFloat(e.target.value) : '')}
                        />
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
                            }).then(() => {
                              setNewCoreType('')
                              setNewCoreDescription('')
                              setNewCoreCostPerM('')
                              setNewCoreKgPerM('')
                            })
                          }}
                        >
                          Add core
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </AdminDataTable>
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
  onDelete: (code: string) => Promise<void>
}) {
  const { resin, saving, onSave, onDelete } = props
  const [name, setName] = useState(resin.name)
  const [density, setDensity] = useState<number | ''>(resin.density)
  const [price, setPrice] = useState<number | ''>(resin.price_per_kg)

  const dirty = name !== resin.name || density !== resin.density || price !== resin.price_per_kg

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{resin.resin_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={density}
          onChange={(e) => setDensity(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={price}
          onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || density === '' || price === ''}
            onClick={() =>
              void onSave(resin.resin_code, {
                name: name.trim(),
                density: Number(density),
                price_per_kg: Number(price),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(resin.resin_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function AdditiveRow(props: {
  additive: Additive
  saving: boolean
  onSave: (code: string, patch: Omit<Additive, 'additive_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { additive, saving, onSave, onDelete } = props
  const [name, setName] = useState(additive.name)
  const [price, setPrice] = useState<number | ''>(additive.price_per_kg)

  const dirty = name !== additive.name || price !== additive.price_per_kg

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{additive.additive_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={price}
          onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || price === ''}
            onClick={() =>
              void onSave(additive.additive_code, {
                name: name.trim(),
                price_per_kg: Number(price),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(additive.additive_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function ColourRow(props: {
  colour: Colour
  saving: boolean
  onSave: (code: string, patch: Omit<Colour, 'colour_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { colour, saving, onSave, onDelete } = props
  const [name, setName] = useState(colour.name)
  const [price, setPrice] = useState<number | ''>(colour.price_per_kg)
  const [shortCode, setShortCode] = useState(colour.short_code ?? '')

  useEffect(() => {
    setName(colour.name)
    setPrice(colour.price_per_kg)
    setShortCode(colour.short_code ?? '')
  }, [colour.colour_code, colour.name, colour.price_per_kg, colour.short_code])

  const dirty =
    name !== colour.name || price !== colour.price_per_kg || shortCode !== (colour.short_code ?? '')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{colour.colour_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={price}
          onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          sx={{ width: 72 }}
          value={shortCode}
          onChange={(e) => setShortCode((e.target.value || '').slice(0, 3))}
          inputProps={{ maxLength: 3 }}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || price === ''}
            onClick={() =>
              void onSave(colour.colour_code, {
                name: name.trim(),
                price_per_kg: Number(price),
                sort_order: colour.sort_order,
                short_code: shortCode.trim() || null,
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(colour.colour_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function CoreRow(props: {
  core: Core
  saving: boolean
  onSave: (coreType: string, patch: Omit<Core, 'core_type'>) => Promise<void>
  onDelete: (coreType: string) => Promise<void>
}) {
  const { core, saving, onSave, onDelete } = props
  const [description, setDescription] = useState(core.description || '')
  const [cost, setCost] = useState<number | ''>(core.cost_per_meter)
  const [kg, setKg] = useState<number | ''>(core.kg_per_meter)

  const dirty = description !== (core.description || '') || cost !== core.cost_per_meter || kg !== core.kg_per_meter

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{core.core_type}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={description} onChange={(e) => setDescription(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={cost}
          onChange={(e) => setCost(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          value={kg}
          onChange={(e) => setKg(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || cost === '' || kg === ''}
            onClick={() =>
              void onSave(core.core_type, {
                description: description.trim() ? description.trim() : null,
                cost_per_meter: Number(cost),
                kg_per_meter: Number(kg),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(core.core_type)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function ExtruderRow(props: {
  extruder: Extruder
  saving: boolean
  onSave: (code: string, patch: Omit<Extruder, 'extruder_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { extruder, saving, onSave, onDelete } = props
  const [model, setModel] = useState(extruder.model || '')
  const [wMin, setWMin] = useState<number | ''>(extruder.film_width_min_mm ?? '')
  const [wMax, setWMax] = useState<number | ''>(extruder.film_width_max_mm ?? '')
  const [wDec, setWDec] = useState<number | ''>(extruder.decision_width_mm ?? '')
  const [avg, setAvg] = useState<number | ''>(extruder.average_kg_hr ?? '')
  const [aveWidth, setAveWidth] = useState<number | ''>(extruder.ave_width ?? '')
  const [costPerHr, setCostPerHr] = useState<number | ''>(extruder.cost_per_hr ?? '')

  const dirty =
    model !== (extruder.model || '') ||
    wMin !== (extruder.film_width_min_mm ?? '') ||
    wMax !== (extruder.film_width_max_mm ?? '') ||
    wDec !== (extruder.decision_width_mm ?? '') ||
    avg !== (extruder.average_kg_hr ?? '') ||
    aveWidth !== (extruder.ave_width ?? '') ||
    costPerHr !== (extruder.cost_per_hr ?? '')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{extruder.extruder_code}</TableCell>
      <TableCell>
        <TextField size="small" value={model} onChange={(e) => setModel(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={wMin} onChange={(e) => setWMin(e.target.value ? parseInt(e.target.value, 10) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={wMax} onChange={(e) => setWMax(e.target.value ? parseInt(e.target.value, 10) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={wDec} onChange={(e) => setWDec(e.target.value ? parseInt(e.target.value, 10) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'numeric' }} value={avg} onChange={(e) => setAvg(e.target.value ? parseInt(e.target.value, 10) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={aveWidth} onChange={(e) => setAveWidth(e.target.value ? parseFloat(e.target.value) : '')} />
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
              void onSave(extruder.extruder_code, {
                model: model.trim() ? model.trim() : null,
                film_width_min_mm: wMin === '' ? null : Number(wMin),
                film_width_max_mm: wMax === '' ? null : Number(wMax),
                decision_width_mm: wDec === '' ? null : Number(wDec),
                average_kg_hr: avg === '' ? null : Number(avg),
                ave_width: aveWidth === '' ? null : Number(aveWidth),
                cost_per_hr: costPerHr === '' ? null : Number(costPerHr),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={saving}
            onClick={() => void onDelete(extruder.extruder_code)}
          >
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function ExtrusionWasteFactorRow(props: {
  wasteFactor: ExtrusionWasteFactor
  saving: boolean
  onSave: (factor: string, patch: Omit<ExtrusionWasteFactor, 'factor'>) => Promise<void>
  onDelete: (factor: string) => Promise<void>
}) {
  const { wasteFactor, saving, onSave, onDelete } = props
  const [minutes, setMinutes] = useState<number | ''>(wasteFactor.minutes)
  const dirty = minutes !== wasteFactor.minutes
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{wasteFactor.factor}</TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'numeric' }}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value ? parseInt(e.target.value, 10) : '')}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || minutes === '' || Number(minutes) < 0}
            onClick={() => void onSave(wasteFactor.factor, { minutes: Number(minutes) })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={saving}
            onClick={() => void onDelete(wasteFactor.factor)}
          >
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function PrintingPricingTierRow(props: {
  tier: PrintingPricingTier
  saving: boolean
  onSave: (
    key: { method: string; max_print_width_mm: number; num_colours: number },
    patch: Pick<PrintingPricingTier, 'min_meters' | 'min_charge' | 'setup_fee' | 'cost_per_1000m'>,
  ) => Promise<void>
  onDelete: (key: { method: string; max_print_width_mm: number; num_colours: number }) => Promise<void>
}) {
  const { tier, saving, onSave, onDelete } = props
  const [minMeters, setMinMeters] = useState<number | ''>(tier.min_meters)
  const [minCharge, setMinCharge] = useState<number | ''>(tier.min_charge ?? '')
  const [setupFee, setSetupFee] = useState<number | ''>(tier.setup_fee ?? '')
  const [rate, setRate] = useState<number | ''>(tier.cost_per_1000m)

  const isInline = tier.method === 'inline'
  const isUteco = tier.method === 'uteco'

  const dirty =
    minMeters !== tier.min_meters ||
    (isInline ? minCharge !== (tier.min_charge ?? '') : false) ||
    (isUteco ? setupFee !== (tier.setup_fee ?? '') : false) ||
    rate !== tier.cost_per_1000m

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{tier.method}</TableCell>
      <TableCell>{tier.max_print_width_mm}</TableCell>
      <TableCell>{tier.num_colours}</TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'numeric', min: 0, step: 1 }}
          value={minMeters}
          onChange={(e) => setMinMeters(e.target.value ? parseInt(e.target.value, 10) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }}
          value={isInline ? minCharge : ''}
          disabled={!isInline}
          onChange={(e) => setMinCharge(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }}
          value={isUteco ? setupFee : ''}
          disabled={!isUteco}
          onChange={(e) => setSetupFee(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }}
          value={rate}
          onChange={(e) => setRate(e.target.value ? parseFloat(e.target.value) : '')}
        />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || minMeters === '' || rate === ''}
            onClick={() =>
              void onSave(
                { method: tier.method, max_print_width_mm: tier.max_print_width_mm, num_colours: tier.num_colours },
                {
                  min_meters: Number(minMeters),
                  min_charge: isInline ? (minCharge === '' ? null : Number(minCharge)) : null,
                  setup_fee: isUteco ? (setupFee === '' ? null : Number(setupFee)) : null,
                  cost_per_1000m: Number(rate),
                },
              )
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={saving}
            onClick={() => void onDelete({ method: tier.method, max_print_width_mm: tier.max_print_width_mm, num_colours: tier.num_colours })}
          >
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function InkRow(props: {
  ink: Ink
  saving: boolean
  onSave: (code: string, patch: Omit<Ink, 'ink_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { ink, saving, onSave, onDelete } = props
  const [name, setName] = useState(ink.name)
  const [printerType, setPrinterType] = useState<(typeof ink)['printer_type']>(ink.printer_type || 'inline')

  const dirty = name !== ink.name || printerType !== (ink.printer_type || 'inline')

  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{ink.ink_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField select size="small" value={printerType} onChange={(e) => setPrinterType(e.target.value as any)}>
          <MenuItem value="inline">Inline</MenuItem>
          <MenuItem value="uteco">Uteco</MenuItem>
          <MenuItem value="both">Both</MenuItem>
        </TextField>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim()}
            onClick={() => void onSave(ink.ink_code, { name: name.trim(), printer_type: printerType })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(ink.ink_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function PlateRow(props: {
  plate: Plate
  customerCode: string
  saving: boolean
  onSave: (customerId: string, plateCode: string, patch: Omit<Plate, 'customer_id' | 'plate_code'>) => Promise<void>
  onDelete: (customerId: string, plateCode: string) => Promise<void>
}) {
  const { plate, customerCode, saving, onSave, onDelete } = props
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
        <Stack direction="row" spacing={1} justifyContent="flex-end">
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
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={saving}
            onClick={() => void onDelete(plate.customer_id, plate.plate_code)}
          >
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function ResinBlendRow(props: {
  blend: ResinBlend
  saving: boolean
  resinOptions: ResinOption[]
  onSave: (code: string, patch: Omit<ResinBlend, 'blend_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
  isNewRow?: boolean
  canSave?: boolean
  onChangeNew?: (next: ResinBlend) => void
}) {
  const { blend, saving, resinOptions, onSave, onDelete, isNewRow, canSave, onChangeNew } = props
  const [expanded, setExpanded] = useState(false)

  const [name, setName] = useState(blend.name)
  const [components, setComponents] = useState<Array<{ resin_code: string; pct: number | '' }>>(
    (blend.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct })),
  )

  useEffect(() => {
    if (!isNewRow) {
      setName(blend.name)
      setComponents((blend.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend.blend_code])

  const sum = components
    .filter((c) => c.resin_code.trim() && c.pct !== '')
    .reduce((acc, c) => acc + Number(c.pct || 0), 0)

  const dirty =
    name !== blend.name ||
    JSON.stringify(components) !== JSON.stringify((blend.components || []).map((c) => ({ resin_code: c.resin_code, pct: c.pct })))

  const canSaveExisting =
    !!name.trim() &&
    components.filter((c) => c.resin_code.trim() && c.pct !== '').length > 0 &&
    Math.abs(sum - 100) < 0.01

  const canSaveRow = isNewRow ? !!canSave : canSaveExisting

  const componentSummary = components
    .filter((c) => c.resin_code.trim() && c.pct !== '')
    .map((c) => `${c.resin_code.trim()} ${Number(c.pct || 0).toFixed(0)}%`)
    .join(', ')

  function updateNew(next: Partial<ResinBlend>) {
    if (!onChangeNew) return
    onChangeNew({
      blend_code: next.blend_code ?? blend.blend_code,
      name: next.name ?? name,
      components:
        next.components ??
        components
          .filter((c) => c.resin_code.trim() && c.pct !== '')
          .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct || 0) })),
    })
  }

  return (
    <>
      <TableRow hover>
        <TableCell sx={{ fontFamily: 'monospace' }}>
          {isNewRow ? (
            <TextField
              size="small"
              label="Code"
              value={blend.blend_code}
              onChange={(e) => updateNew({ blend_code: e.target.value })}
            />
          ) : (
            blend.blend_code
          )}
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            fullWidth
            label={isNewRow ? 'Name' : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (isNewRow) updateNew({ name: e.target.value })
            }}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {componentSummary || '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" variant="outlined" disabled={saving} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Hide' : 'Details'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={saving || !dirty || !canSaveRow || !name.trim()}
              onClick={() =>
                void onSave(blend.blend_code, {
                  name: name.trim(),
                  components: components
                    .filter((c) => c.resin_code.trim() && c.pct !== '')
                    .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
                })
              }
            >
              {saving ? 'Saving…' : isNewRow ? 'Add' : 'Save'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={saving}
              onClick={() => void onDelete(blend.blend_code)}
            >
              {isNewRow ? 'Clear' : 'Delete'}
            </Button>
          </Stack>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={4}>
            <BlendComponentsEditor
              components={components}
              onChange={(next) => {
                setComponents(next)
                if (isNewRow) updateNew({ components: next.filter((c) => c.resin_code.trim() && c.pct !== '').map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct || 0) })) })
              }}
              resinOptions={resinOptions}
            />
            <Typography variant="caption" color={Math.abs(sum - 100) < 0.01 ? 'text.secondary' : 'error'} sx={{ display: 'block', mt: 1 }}>
              Total: {sum.toFixed(2)}% {Math.abs(sum - 100) < 0.01 ? '(OK)' : '(must sum to 100%)'}
            </Typography>
          </TableCell>
        </TableRow>
      ) : null}
    </>
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
              reserveHelperTextSpace={false}
              onChangeCode={(nextCode) =>
                onChange(components.map((x, i) => (i === idx ? { ...x, resin_code: nextCode } : x)))
              }
            />

            <TextField
              size="small"
              label="Pct"
              inputProps={{ inputMode: 'decimal' }}
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


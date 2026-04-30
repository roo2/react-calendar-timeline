import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminDeleteExtruder,
  adminSaveExtruder,
  adminSaveExtrusionWasteFactor,
  adminSaveMaterialsRetailBands,
  adminSaveQuoteDefaults,
  fetchAdminExtrusionTab,
  fetchAdminQuoteDefaults,
  type MaterialsRetailBand,
  type QuoteDefaultsSettings,
} from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import type { Extruder, ExtrusionWasteFactor } from './types'

const MATERIAL_GROUPS: Array<{ key: MaterialsRetailBand['product_group']; title: string }> = [
  { key: 'tube', title: 'Tube' },
  { key: 'centerfold', title: 'Centerfold' },
  { key: 'sheet', title: 'Sheet' },
  { key: 'u_film', title: 'U-Film' },
  { key: 'bag', title: 'Bag' },
]

function numOrNull(v: string): number | null {
  const s = v.trim()
  if (s === '' || s === '—') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function fmtCell(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return String(n)
}

type NewMaterialsBandPayload = Omit<MaterialsRetailBand, 'id'>

function NewMaterialsBandRow(props: {
  group: MaterialsRetailBand['product_group']
  disabled: boolean
  onAdd: (row: NewMaterialsBandPayload) => void
}) {
  const { group, disabled, onAdd } = props
  const [wmin, setWmin] = useState('')
  const [wmax, setWmax] = useState('')
  const [moqPlain, setMoqPlain] = useState('')
  const [moqPrinted, setMoqPrinted] = useState('')
  const [retail, setRetail] = useState('')

  const canAdd = useMemo(() => {
    const wminN = Number(wmin)
    const wmaxN = Number(wmax)
    if (wmin === '' || wmax === '') return false
    if (!Number.isFinite(wminN) || !Number.isFinite(wmaxN)) return false
    if (wminN < 0) return false
    if (wmaxN < wminN) return false
    return true
  }, [wmin, wmax])

  function submit() {
    if (!canAdd || disabled) return
    const wminN = Math.round(Number(wmin))
    const wmaxN = Math.round(Number(wmax))
    const rt = retail.trim()
    const retailN = rt === '' || rt === '—' ? null : Number(rt)
    onAdd({
      product_group: group,
      width_min_mm: wminN,
      width_max_mm: wmaxN,
      moq_plain_kg: numOrNull(moqPlain),
      retail_price_per_kg: retailN != null && Number.isFinite(retailN) ? retailN : null,
      moq_printed_kg: numOrNull(moqPrinted),
    })
    setWmin('')
    setWmax('')
    setMoqPlain('')
    setMoqPrinted('')
    setRetail('')
  }

  return (
    <TableRow>
      <TableCell>
        <TextField
          size="small"
          label="Width min (mm)"
          inputProps={{ inputMode: 'numeric' }}
          value={wmin}
          onChange={(e) => setWmin(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          label="Width max (mm)"
          inputProps={{ inputMode: 'numeric' }}
          value={wmax}
          onChange={(e) => setWmax(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          label="MOQ plain (kg)"
          placeholder="—"
          value={moqPlain}
          onChange={(e) => setMoqPlain(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          label="Retail ($/kg)"
          placeholder="—"
          inputProps={{ inputMode: 'decimal' }}
          value={retail}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^(\d+(\.\d*)?|\.\d*)$/.test(v)) setRetail(v)
          }}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          label="MOQ printed (kg)"
          placeholder="—"
          value={moqPrinted}
          onChange={(e) => setMoqPrinted(e.target.value)}
        />
      </TableCell>
      <TableCell align="right">
        <Button size="small" variant="outlined" disabled={disabled || !canAdd} onClick={() => submit()}>
          Add band
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function ExtrusionAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const extruders = useAppSelector((s) => s.adminRateCards.extruders.items)
  const wasteFactors = useAppSelector((s) => s.adminRateCards.extrusionWasteFactors.items)
  const serverBands = useAppSelector((s) => s.adminRateCards.materialsRetailBands.items)
  const {
    data: quoteDefaults,
    status: quoteDefaultsStatus,
    error: quoteDefaultsErr,
  } = useAppSelector((s) => s.adminRateCards.quoteDefaults)
  const { status, error: tabErr } = useAppSelector((s) => s.adminRateCards.extrusionTab)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [draftBands, setDraftBands] = useState<MaterialsRetailBand[]>([])
  /** In-progress retail $/kg text keyed by band id (allows typing `4.` before blur). */
  const [retailPriceText, setRetailPriceText] = useState<Record<number, string>>({})
  const [savingBands, setSavingBands] = useState(false)

  const [newExtruderCode, setNewExtruderCode] = useState('')
  const [newExtruderModel, setNewExtruderModel] = useState('')
  const [newExtruderWMin, setNewExtruderWMin] = useState<number | ''>('')
  const [newExtruderWMax, setNewExtruderWMax] = useState<number | ''>('')
  const [newExtruderDecisionW, setNewExtruderDecisionW] = useState<number | ''>('')
  const [newExtruderAvgKgHr, setNewExtruderAvgKgHr] = useState<number | ''>('')
  const [newExtruderAveWidth, setNewExtruderAveWidth] = useState<number | ''>('')
  const [newExtruderCostPerHr, setNewExtruderCostPerHr] = useState<number | ''>('')
  const [savingFeatureRetails, setSavingFeatureRetails] = useState(false)
  const [gussetRetailPerKg, setGussetRetailPerKg] = useState('')
  const [punchedRetailPerKg, setPunchedRetailPerKg] = useState('')

  const canCreateExtruder = useMemo(() => !!newExtruderCode.trim(), [newExtruderCode])

  useEffect(() => {
    void dispatch(fetchAdminExtrusionTab())
    void dispatch(fetchAdminQuoteDefaults())
  }, [dispatch])

  useEffect(() => {
    setDraftBands((serverBands || []).map((b) => ({ ...b })))
    setRetailPriceText({})
  }, [serverBands])

  useEffect(() => {
    if (!quoteDefaults) return
    setGussetRetailPerKg(String(quoteDefaults.extrusion_gusset_retail_per_kg))
    setPunchedRetailPerKg(String(quoteDefaults.extrusion_punched_retail_per_kg))
  }, [quoteDefaults])

  const extrusionFeatureRetailDirty =
    quoteDefaults != null &&
    (Number(gussetRetailPerKg) !== quoteDefaults.extrusion_gusset_retail_per_kg ||
      Number(punchedRetailPerKg) !== quoteDefaults.extrusion_punched_retail_per_kg)

  const bandsDirty = useMemo(() => {
    const a = JSON.stringify(draftBands || [])
    const b = JSON.stringify(serverBands || [])
    const overlayDirty = Object.keys(retailPriceText).length > 0
    return a !== b || overlayDirty
  }, [draftBands, serverBands, retailPriceText])

  const displayErr = err || tabErr || quoteDefaultsErr

  function retailPricePerKgForSave(r: MaterialsRetailBand): number | null {
    if (Object.prototype.hasOwnProperty.call(retailPriceText, r.id)) {
      const s = String(retailPriceText[r.id] ?? '').trim()
      if (s === '' || s === '—') return null
      const n = Number(s)
      return Number.isFinite(n) ? n : r.retail_price_per_kg ?? null
    }
    return r.retail_price_per_kg ?? null
  }

  async function saveExtrusionFeatureRetails() {
    const base = quoteDefaults
    if (!base) return
    const g = Number(gussetRetailPerKg)
    const p = Number(punchedRetailPerKg)
    if (!Number.isFinite(g) || g < 0 || !Number.isFinite(p) || p < 0) {
      setErr('Gusset and punched rates must be non-negative numbers.')
      return
    }
    try {
      setErr(null)
      setSavingFeatureRetails(true)
      const payload: QuoteDefaultsSettings = {
        ...base,
        extrusion_gusset_retail_per_kg: g,
        extrusion_punched_retail_per_kg: p,
      }
      await dispatch(adminSaveQuoteDefaults(payload)).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save extrusion feature pricing')
    } finally {
      setSavingFeatureRetails(false)
    }
  }

  async function saveMaterialsBands() {
    try {
      setErr(null)
      setSavingBands(true)
      const payload = (draftBands || []).map((r) => ({
        product_group: r.product_group,
        width_min_mm: Math.round(Number(r.width_min_mm || 0)),
        width_max_mm: Math.round(Number(r.width_max_mm || 0)),
        moq_plain_kg: r.moq_plain_kg,
        retail_price_per_kg: retailPricePerKgForSave(r),
        moq_printed_kg: r.moq_printed_kg,
      }))
      await dispatch(adminSaveMaterialsRetailBands(payload)).unwrap()
      setRetailPriceText({})
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save materials retail bands')
    } finally {
      setSavingBands(false)
    }
  }

  function updateBandRow(id: number, patch: Partial<MaterialsRetailBand>) {
    setDirty(true)
    setDraftBands((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function appendMaterialsBand(row: NewMaterialsBandPayload) {
    setDirty(true)
    const negIds = draftBands.map((b) => b.id).filter((x) => x < 0)
    const nextId = (negIds.length ? Math.min(...negIds) : 0) - 1
    setDraftBands((cur) => [...cur, { id: nextId, ...row }])
  }

  function removeBandRow(id: number) {
    setDirty(true)
    setRetailPriceText((cur) => {
      const next = { ...cur }
      delete next[id]
      return next
    })
    setDraftBands((cur) => cur.filter((r) => r.id !== id))
  }

  async function saveExtruder(code: string, patch: Omit<Extruder, 'extruder_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSavingKey(`extruder:${trimmed}`)
      await dispatch(adminSaveExtruder({ code: trimmed, patch })).unwrap()
      setDirty(false)
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
      await dispatch(adminDeleteExtruder(trimmed)).unwrap()
      setDirty(false)
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
      await dispatch(adminSaveExtrusionWasteFactor({ factor: trimmed, patch })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save waste factor')
    } finally {
      setSavingKey(null)
    }
  }

  const extrudersSorted = useMemo(() => {
    return (extruders || [])
      .slice()
      .sort((a, b) => {
        const aw = a.decision_width_mm
        const bw = b.decision_width_mm
        if (aw == null && bw == null) return a.extruder_code.localeCompare(b.extruder_code)
        if (aw == null) return 1
        if (bw == null) return -1
        if (aw !== bw) return aw - bw
        return a.extruder_code.localeCompare(b.extruder_code)
      })
  }, [extruders])

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Extrusion"
        subtitle="Extruder properties, extrusion waste factors, and quote materials retail bands."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 560 }}>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          Quote extrusion feature pricing
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sell-side add-ons on quotes: <b>$/kg × billed job kg</b> when the product uses gusset geometry (with gusset width) or hole punching.
        </Typography>
        {quoteDefaultsStatus === 'loading' && !quoteDefaults ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <TextField
              size="small"
              label="Gusset ($/kg)"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={gussetRetailPerKg}
              onChange={(e) => {
                setGussetRetailPerKg(e.target.value)
                setDirty(true)
              }}
              helperText="Default 0.50 ($/kg)"
            />
            <TextField
              size="small"
              label="Hole punched ($/kg)"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={punchedRetailPerKg}
              onChange={(e) => {
                setPunchedRetailPerKg(e.target.value)
                setDirty(true)
              }}
              helperText="Default 0.20 ($/kg)"
            />
            <Button
              variant="contained"
              disabled={savingFeatureRetails || !extrusionFeatureRetailDirty || !quoteDefaults}
              onClick={() => void saveExtrusionFeatureRetails()}
            >
              {savingFeatureRetails ? 'Saving…' : 'Save extrusion feature pricing'}
            </Button>
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2} sx={{ mb: 1 }}>
          <Box>
            <Typography variant="subtitle1">Quote materials retail (width bands)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 900, mt: 0.5 }}>
              Film size is matched against <b>product width</b> (mm) on the quote. Tube pricing uses the Tube table;{' '}
              <b>Sleeve</b> uses the same rows as Tube. Sell-side material $/kg uses <b>Retail price ($/kg)</b> when set;
              otherwise it falls back to blended resin cost. Minimum order quantities drive the Quantity panel hints on
              quotes.
            </Typography>
          </Box>
          <Button variant="contained" disabled={savingBands || !bandsDirty} onClick={() => void saveMaterialsBands()}>
            {savingBands ? 'Saving…' : 'Save materials bands'}
          </Button>
        </Stack>

        {loading && draftBands.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={3}>
            {MATERIAL_GROUPS.map((g) => {
              const rows = draftBands.filter((b) => b.product_group === g.key).sort((a, b) => a.width_min_mm - b.width_min_mm)
              return (
                <Box key={g.key}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {g.title}
                  </Typography>
                  <AdminDataTable>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 120 }}>Width min (mm)</TableCell>
                        <TableCell sx={{ width: 120 }}>Width max (mm)</TableCell>
                        <TableCell sx={{ width: 170 }}>Minimum order quantity (kg)</TableCell>
                        <TableCell sx={{ width: 160 }}>Retail price ($/kg)</TableCell>
                        <TableCell sx={{ width: 220 }}>Minimum order quantity (printed) (kg)</TableCell>
                        <TableCell sx={{ width: 120 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                          <TableRow key={`${r.id}-${r.product_group}-${r.width_min_mm}-${r.width_max_mm}`} hover>
                            <TableCell>
                              <TextField
                                size="small"
                                inputProps={{ inputMode: 'numeric' }}
                                value={String(r.width_min_mm)}
                                onChange={(e) => updateBandRow(r.id, { width_min_mm: Math.round(Number(e.target.value || 0)) })}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                inputProps={{ inputMode: 'numeric' }}
                                value={String(r.width_max_mm)}
                                onChange={(e) => updateBandRow(r.id, { width_max_mm: Math.round(Number(e.target.value || 0)) })}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                placeholder="—"
                                value={fmtCell(r.moq_plain_kg)}
                                onChange={(e) => updateBandRow(r.id, { moq_plain_kg: numOrNull(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                placeholder="—"
                                inputProps={{ inputMode: 'decimal' }}
                                value={Object.prototype.hasOwnProperty.call(retailPriceText, r.id) ? retailPriceText[r.id] : fmtCell(r.retail_price_per_kg)}
                                onFocus={() => {
                                  setRetailPriceText((cur) => ({
                                    ...cur,
                                    [r.id]: fmtCell(r.retail_price_per_kg),
                                  }))
                                }}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === '' || /^(\d+(\.\d*)?|\.\d*)$/.test(v)) {
                                    setDirty(true)
                                    setRetailPriceText((cur) => ({ ...cur, [r.id]: v }))
                                  }
                                }}
                                onBlur={() => {
                                  const raw = (retailPriceText[r.id] ?? fmtCell(r.retail_price_per_kg)).trim()
                                  setRetailPriceText((cur) => {
                                    const next = { ...cur }
                                    delete next[r.id]
                                    return next
                                  })
                                  const parsed = raw === '' || raw === '—' ? null : Number(raw)
                                  const nextVal = parsed != null && Number.isFinite(parsed) ? parsed : null
                                  const prev = r.retail_price_per_kg ?? null
                                  if (nextVal !== prev) {
                                    updateBandRow(r.id, { retail_price_per_kg: nextVal })
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                placeholder="—"
                                value={fmtCell(r.moq_printed_kg)}
                                onChange={(e) => updateBandRow(r.id, { moq_printed_kg: numOrNull(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Button size="small" color="error" variant="outlined" onClick={() => removeBandRow(r.id)}>
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      <NewMaterialsBandRow group={g.key} disabled={savingBands} onAdd={appendMaterialsBand} />
                    </TableBody>
                  </AdminDataTable>
                </Box>
              )
            })}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Extruders
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
          Running costs (e.g. cost per hour) are intended to cover wages, maintenance, and electricity.
        </Typography>
        {loading && extruders.length === 0 ? (
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
                <TableCell sx={{ width: 100 }}>Cost/hr ($)</TableCell>
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
                <TableCell>
                  <TextField size="small" inputProps={{ inputMode: 'decimal', min: 0, step: 0.01 }} value={newExtruderCostPerHr} onChange={(e) => setNewExtruderCostPerHr(e.target.value ? parseFloat(e.target.value) : '')} />
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
                        cost_per_hr: newExtruderCostPerHr === '' ? null : Number(newExtruderCostPerHr),
                      }).then(() => {
                        setNewExtruderCode('')
                        setNewExtruderModel('')
                        setNewExtruderWMin('')
                        setNewExtruderWMax('')
                        setNewExtruderDecisionW('')
                        setNewExtruderAvgKgHr('')
                        setNewExtruderAveWidth('')
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

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Extrusion waste factors
        </Typography>
        {loading && wasteFactors.length === 0 ? (
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
                <WasteFactorRow key={r.factor} row={r} saving={savingKey === `wf:${r.factor}`} onSave={saveWasteFactor} />
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
  const [costPerHr, setCostPerHr] = useState<number | ''>(row.cost_per_hr ?? '')
  useEffect(() => {
    setModel(row.model || '')
    setWMin(row.film_width_min_mm ?? '')
    setWMax(row.film_width_max_mm ?? '')
    setDecisionW(row.decision_width_mm ?? '')
    setAvgKgHr(row.average_kg_hr ?? '')
    setAveWidth(row.ave_width ?? '')
    setCostPerHr(row.cost_per_hr ?? '')
  }, [row.model, row.film_width_min_mm, row.film_width_max_mm, row.decision_width_mm, row.average_kg_hr, row.ave_width, row.cost_per_hr])

  const dirty =
    model !== (row.model || '') ||
    wMin !== (row.film_width_min_mm ?? '') ||
    wMax !== (row.film_width_max_mm ?? '') ||
    decisionW !== (row.decision_width_mm ?? '') ||
    avgKgHr !== (row.average_kg_hr ?? '') ||
    aveWidth !== (row.ave_width ?? '') ||
    costPerHr !== (row.cost_per_hr ?? '')

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
              void onSave(row.extruder_code, {
                model: model.trim() || null,
                film_width_min_mm: wMin === '' ? null : Number(wMin),
                film_width_max_mm: wMax === '' ? null : Number(wMax),
                decision_width_mm: decisionW === '' ? null : Number(decisionW),
                average_kg_hr: avgKgHr === '' ? null : Number(avgKgHr),
                ave_width: aveWidth === '' ? null : Number(aveWidth),
                cost_per_hr: costPerHr === '' ? null : Number(costPerHr),
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

import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import {
  Alert,
  Box,
  Button,
  Divider,
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

function fmtMoney(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return n.toFixed(2)
}

function QuotePreview({ preview }: { preview: any }) {
  const p = preview
  if (!p) return null
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Quote Preview
      </Typography>
      <Typography variant="body2">
        Total cost: {fmtMoney(p.total_cost)} {p.currency}
      </Typography>
      <Typography variant="body2">
        Final price (with margin {Math.round(Number(p.margin) * 100)}%):{' '}
        <strong>
          {fmtMoney(p.final_price)} {p.currency}
        </strong>
      </Typography>
      {p.unit_price != null && (
        <Typography variant="body2">
          Unit price: {Number(p.unit_price).toFixed(4)} {p.currency}
        </Typography>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Breakdown
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Stage</TableCell>
            <TableCell>Cost ({p.currency})</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Material</TableCell>
            <TableCell>{fmtMoney(p.cost_breakdown?.material_cost)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Printing</TableCell>
            <TableCell>{fmtMoney(p.cost_breakdown?.printing_cost)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Conversion</TableCell>
            <TableCell>{fmtMoney(p.cost_breakdown?.conversion_cost)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Core</TableCell>
            <TableCell>{fmtMoney(p.cost_breakdown?.core_cost)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Waste</TableCell>
            <TableCell>{fmtMoney(p.cost_breakdown?.waste_cost)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  )
}

export function QuotesPage() {
  const [bootstrap, setBootstrap] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  // Product quote
  const [pvId, setPvId] = useState('')
  const [qtyUnits, setQtyUnits] = useState('')
  const [qtyKg, setQtyKg] = useState('')
  const [qtyM, setQtyM] = useState('')
  const [qtyRolls, setQtyRolls] = useState('')
  const [currency, setCurrency] = useState('AUD')
  const [margin, setMargin] = useState('0.20')
  const [productPreview, setProductPreview] = useState<any>(null)

  // Quick quote
  const [productType, setProductType] = useState('Bag')
  const [geometry, setGeometry] = useState('Flat')
  const [baseWidth, setBaseWidth] = useState('')
  const [thickness, setThickness] = useState('')
  const [continuousRoll, setContinuousRoll] = useState(false)
  const [baseLength, setBaseLength] = useState('')
  const [gusset, setGusset] = useState('')
  const [resinCode, setResinCode] = useState('')
  const [colourCode, setColourCode] = useState('')
  const [colourStrengthPct, setColourStrengthPct] = useState('2.0')
  const [opaque, setOpaque] = useState(false)
  const [additiveCode, setAdditiveCode] = useState('')
  const [additivePct, setAdditivePct] = useState('')
  const [printMethod, setPrintMethod] = useState('None')
  const [numColours, setNumColours] = useState('')
  const [finishMode, setFinishMode] = useState('Rolls')
  const [coreType, setCoreType] = useState('')
  const [qtyType, setQtyType] = useState<'units' | 'kg' | 'm' | 'rolls'>('units')
  const [quickCurrency, setQuickCurrency] = useState('AUD')
  const [quickMargin, setQuickMargin] = useState('0.20')
  const [quickPreview, setQuickPreview] = useState<any>(null)

  const showGusset = geometry === 'Gusset' || geometry === 'BottomGusset'
  const showNumColours = printMethod && printMethod !== 'None'
  const showColourFields = !!colourCode

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        const b = await apiFetch<any>('/api/quotes/bootstrap')
        setBootstrap(b)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load quote data')
      }
    })()
  }, [])

  function productQuantityPayload() {
    const q: any = {}
    if (qtyUnits) q.units = Number(qtyUnits)
    else if (qtyKg) q.total_kg = qtyKg
    else if (qtyM) q.total_m = qtyM
    else if (qtyRolls) q.rolls = Number(qtyRolls)
    return q
  }

  async function calcProduct() {
    setErr(null)
    try {
      const payload = {
        product_version_id: pvId,
        currency,
        requested_margin: margin,
        quantity: productQuantityPayload(),
      }
      const res = await apiFetch<any>('/api/quotes/calculate', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setProductPreview(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to calculate quote')
    }
  }

  async function calcQuick() {
    setErr(null)
    try {
      const qty: any = {}
      if (qtyType === 'units') qty.units = Number(qtyUnits || 0)
      if (qtyType === 'kg') qty.total_kg = qtyKg
      if (qtyType === 'm') qty.total_m = qtyM
      if (qtyType === 'rolls') qty.rolls = Number(qtyRolls || 0)

      const payload: any = {
        product_type: productType,
        geometry,
        base_width_mm: Number(baseWidth),
        thickness_um: Number(thickness),
        continuous_roll: continuousRoll,
        base_length_mm: continuousRoll ? null : Number(baseLength || 0),
        gusset_mm: showGusset ? Number(gusset || 0) : null,
        resin_code: resinCode || null,
        colour_code: colourCode || null,
        colour_strength_pct: showColourFields ? colourStrengthPct : null,
        opaque,
        additive_code: additiveCode || null,
        additive_pct: additivePct || null,
        print_method: printMethod,
        num_colours: showNumColours ? Number(numColours || 0) : 0,
        finish_mode: finishMode,
        core_type: coreType || null,
        quantity: qty,
        currency: quickCurrency,
        requested_margin: quickMargin,
      }
      const res = await apiFetch<any>('/api/quotes/quick/calculate', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setQuickPreview(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to calculate quick quote')
    }
  }

  const productVersions = bootstrap?.product_versions || []
  const resins = bootstrap?.resins || []
  const colours = bootstrap?.colours || []
  const additives = bootstrap?.additives || []
  const cores = bootstrap?.cores || []
  const productTypes = bootstrap?.product_types || ['Bag']
  const geometries = bootstrap?.geometries || ['Flat']
  const printMethods = bootstrap?.print_methods || ['None']
  const finishModes = bootstrap?.finish_modes || ['Rolls']

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Quote Calculator</Typography>
        <Typography variant="body2" color="text.secondary">
          Create a quote from an existing product, or try a quick quote below.
        </Typography>
      </Box>

      {err && <Alert severity="error">{err}</Alert>}

      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Quote from Product
          </Typography>

          <Stack spacing={2}>
            <TextField
              select
              label="Product Version"
              value={pvId}
              onChange={(e) => setPvId(e.target.value)}
            >
              <MenuItem value="">-- Select Product Version --</MenuItem>
              {productVersions.map((pv: any) => (
                <MenuItem key={pv.version_id} value={pv.version_id}>
                  {pv.display_name}
                </MenuItem>
              ))}
            </TextField>

            <Typography variant="subtitle1">Quantity</Typography>
            <Typography variant="body2" color="text.secondary">
              Enter quantity in one of the following ways (only one field should be filled).
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
              <TextField label="Units (bags/cartons)" type="number" value={qtyUnits} onChange={(e) => setQtyUnits(e.target.value)} />
              <TextField label="Total Weight (kg)" type="number" value={qtyKg} onChange={(e) => setQtyKg(e.target.value)} />
              <TextField label="Total Length (meters)" type="number" value={qtyM} onChange={(e) => setQtyM(e.target.value)} />
              <TextField label="Number of Rolls" type="number" value={qtyRolls} onChange={(e) => setQtyRolls(e.target.value)} />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
              <TextField select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <MenuItem value="AUD">AUD - Australian Dollar</MenuItem>
                <MenuItem value="USD">USD - US Dollar</MenuItem>
              </TextField>
              <TextField
                label="Margin (decimal)"
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.01 }}
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                helperText="Default: 0.20. Enter as decimal (e.g., 0.25 = 25%)"
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={calcProduct} disabled={!pvId}>
                Calculate Quote
              </Button>
              <Button variant="outlined" onClick={() => setProductPreview(null)}>
                Clear
              </Button>
            </Box>

            {productPreview ? (
              <QuotePreview preview={productPreview} />
            ) : (
              <Typography color="text.secondary">Select a product version and calculate to see pricing.</Typography>
            )}
          </Stack>
        </Paper>

        <Divider />

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Quick Quote (No Product Yet)
          </Typography>
          <Stack spacing={2}>
            <Typography variant="subtitle1">Dimensions (Required)</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField select label="Product Type" value={productType} onChange={(e) => setProductType(e.target.value)}>
                {productTypes.map((pt: string) => (
                  <MenuItem key={pt} value={pt}>
                    {pt}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Geometry" value={geometry} onChange={(e) => setGeometry(e.target.value)}>
                {geometries.map((g: string) => (
                  <MenuItem key={g} value={g}>
                    {g}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Base Width (mm)" type="number" value={baseWidth} onChange={(e) => setBaseWidth(e.target.value)} />
              <TextField label="Thickness (µm)" type="number" value={thickness} onChange={(e) => setThickness(e.target.value)} />
              <TextField
                select
                label="Product Format"
                value={continuousRoll ? 'roll' : 'bag'}
                onChange={(e) => setContinuousRoll(e.target.value === 'roll')}
              >
                <MenuItem value="bag">Bag</MenuItem>
                <MenuItem value="roll">Roll</MenuItem>
              </TextField>
              {!continuousRoll && (
                <TextField label="Base Length (mm)" type="number" value={baseLength} onChange={(e) => setBaseLength(e.target.value)} />
              )}
              {showGusset && (
                <TextField
                  label="Gusset Size (mm)"
                  type="number"
                  value={gusset}
                  onChange={(e) => setGusset(e.target.value)}
                  helperText="Required for Gusset/BottomGusset"
                />
              )}
            </Box>

            <Typography variant="subtitle1">Materials &amp; Formulation (Optional)</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField select label="Resin" value={resinCode} onChange={(e) => setResinCode(e.target.value)}>
                <MenuItem value="">-- Default (standard LDPE) --</MenuItem>
                {resins.map((r: any) => (
                  <MenuItem key={r.code} value={r.code}>
                    {r.code} - {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Colour" value={colourCode} onChange={(e) => setColourCode(e.target.value)}>
                <MenuItem value="">None (Natural)</MenuItem>
                {colours.map((c: any) => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.code} - {c.name}
                  </MenuItem>
                ))}
              </TextField>
              {showColourFields && (
                <TextField
                  label="Colour Strength (%)"
                  type="number"
                  value={colourStrengthPct}
                  onChange={(e) => setColourStrengthPct(e.target.value)}
                />
              )}
              {showColourFields && (
                <TextField
                  select
                  label="Opaque"
                  value={opaque ? 'yes' : 'no'}
                  onChange={(e) => setOpaque(e.target.value === 'yes')}
                >
                  <MenuItem value="no">No</MenuItem>
                  <MenuItem value="yes">Yes</MenuItem>
                </TextField>
              )}
              <TextField select label="Additive" value={additiveCode} onChange={(e) => setAdditiveCode(e.target.value)}>
                <MenuItem value="">None</MenuItem>
                {additives.map((a: any) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.code} - {a.name}
                    {a.category ? ` (${a.category})` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Additive Strength (%)"
                type="number"
                value={additivePct}
                onChange={(e) => setAdditivePct(e.target.value)}
              />
            </Box>

            <Typography variant="subtitle1">Printing (Optional)</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField select label="Printing Method" value={printMethod} onChange={(e) => setPrintMethod(e.target.value)}>
                {printMethods.map((pm: string) => (
                  <MenuItem key={pm} value={pm}>
                    {pm}
                  </MenuItem>
                ))}
              </TextField>
              {showNumColours && (
                <TextField
                  label="Number of Colours"
                  type="number"
                  value={numColours}
                  onChange={(e) => setNumColours(e.target.value)}
                />
              )}
            </Box>

            <Typography variant="subtitle1">Packaging (Optional)</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField select label="Finish Mode" value={finishMode} onChange={(e) => setFinishMode(e.target.value)}>
                {finishModes.map((fm: string) => (
                  <MenuItem key={fm} value={fm}>
                    {fm}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Core Type" value={coreType} onChange={(e) => setCoreType(e.target.value)}>
                <MenuItem value="">None</MenuItem>
                {cores.map((c: any) => (
                  <MenuItem key={c.type} value={c.type}>
                    {c.type}
                    {c.description ? ` - ${c.description}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <Typography variant="subtitle1">Quantity &amp; Pricing</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField select label="Quantity Type" value={qtyType} onChange={(e) => setQtyType(e.target.value as any)}>
                {(['units', 'kg', 'm', 'rolls'] as const).map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              {qtyType === 'units' && (
                <TextField label="Units" type="number" value={qtyUnits} onChange={(e) => setQtyUnits(e.target.value)} />
              )}
              {qtyType === 'kg' && (
                <TextField label="Total Weight (kg)" type="number" value={qtyKg} onChange={(e) => setQtyKg(e.target.value)} />
              )}
              {qtyType === 'm' && (
                <TextField label="Total Length (meters)" type="number" value={qtyM} onChange={(e) => setQtyM(e.target.value)} />
              )}
              {qtyType === 'rolls' && (
                <TextField label="Number of Rolls" type="number" value={qtyRolls} onChange={(e) => setQtyRolls(e.target.value)} />
              )}
              <TextField select label="Currency" value={quickCurrency} onChange={(e) => setQuickCurrency(e.target.value)}>
                <MenuItem value="AUD">AUD - Australian Dollar</MenuItem>
                <MenuItem value="USD">USD - US Dollar</MenuItem>
              </TextField>
              <TextField
                label="Margin (decimal)"
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.01 }}
                value={quickMargin}
                onChange={(e) => setQuickMargin(e.target.value)}
                helperText="Enter as decimal (e.g., 0.25 = 25%)"
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={calcQuick}>
                Calculate Quote
              </Button>
              <Button variant="outlined" onClick={() => setQuickPreview(null)}>
                Clear
              </Button>
            </Box>

            {quickPreview ? (
              <QuotePreview preview={quickPreview} />
            ) : (
              <Typography color="text.secondary">Fill in the quick form and calculate to see pricing.</Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Stack>
  )
}


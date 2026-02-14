import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
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
import { ResinSelect, type ResinOption } from './ResinSelect'
import { ColourSelect, type ColourOption } from './ColourSelect'
import { AdditiveSelect, type AdditiveOption } from './AdditiveSelect'
import { InkSelect, type InkOption } from './InkSelect'
import { PlateSelect, type PlateOption } from './PlateSelect'

type DerivedDimensions = {
  layflat_mm: number
}

export type SpecPayload = any

type ResinBlendPreset = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
}

const PRODUCT_TYPE = {
  Bag: 'Bag',
  Tube: 'Tube',
  Sleeve: 'Sleeve',
  Sheet: 'Sheet',
  Centerfold: 'Centerfold',
  UFilm: 'U-Film',
} as const

type ProductType = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE]

const PRODUCT_TYPES: ProductType[] = [
  PRODUCT_TYPE.Bag,
  PRODUCT_TYPE.Tube,
  PRODUCT_TYPE.Sleeve,
  PRODUCT_TYPE.Sheet,
  PRODUCT_TYPE.Centerfold,
  PRODUCT_TYPE.UFilm,
]

function clone<T>(v: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any).structuredClone as undefined | ((x: any) => any)
  if (typeof sc === 'function') return sc(v)
  return JSON.parse(JSON.stringify(v)) as T
}

function csvToList(s: string): string[] {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function listToCsv(xs: unknown): string {
  return Array.isArray(xs) ? xs.join(', ') : ''
}

export function makeDefaultSpec(): SpecPayload {
  return {
    identity: {
      product_type: PRODUCT_TYPE.Bag,
      finish_mode: 'Rolls',
      trim_pct: null,
      roll_weight_billing: 'core_included',
      industry_flags: [],
      notes: null,
    },
    dimensions: {
      base_width_mm: 200,
      base_length_mm: null,
      thickness_um: 50,
      geometry: 'Flat',
      gusset_mm: null,
    },
    formulation: {
      blend_type: 'LD',
      blend: [{ resin_code: 'LDPE', pct: 100 }],
      colour: null,
      colour_components: [],
      additives: [],
    },
    printing: {
      method: 'None',
      num_colours: 0,
      print_description: null,
      ink_codes: [],
      plate_codes: [],
      side: null,
      artwork_refs: [],
      front_ink_plate: [],
      back_ink_plate: [],
    },
    quality_expectations: {
      flags: [],
      known_issues: null,
    },
    run_requirements: {
      preferred_extruders: [],
      preferred_printer: null,
      preferred_converter: null,
      slit: 'none',
      treat_inside_outside: 'none',
      inline_perforation: false,
      hole_punched: false,
      inline_seal: false,
      notes: null,
    },
    packaging: {
      pack_mode: 'Rolls',
      core_type: '7mm',
      core_policy: 'Include',
      bags_per_carton: null,
      pallet_type: 'Chep',
      wrapped: false,
    },
    tool_requirements: [],
  }
}

export function SpecPayloadForm(props: {
  value: SpecPayload
  onChange: (next: SpecPayload) => void
  fieldErrors?: Record<string, string>
  customerId?: string
}) {
  const { value, onChange, fieldErrors, customerId } = props

  const spec = useMemo(() => value || makeDefaultSpec(), [value])

  function normalizeSpec(d: SpecPayload) {
    const flags = Array.isArray(d?.identity?.industry_flags) ? d.identity.industry_flags : []
    // "non_food" is redundant (inverse of food_contact) and should not be persisted.
    d.identity.industry_flags = Array.from(new Set(flags)).filter((x) => x !== 'non_food')
  }

  function update(mut: (draft: SpecPayload) => void) {
    const next = clone(spec)
    mut(next)
    normalizeSpec(next)
    onChange(next)
  }

  const identity = spec.identity || {}
  const dimensions = spec.dimensions || {}
  const formulation = spec.formulation || {}
  const printing = spec.printing || {}
  const quality = spec.quality_expectations || {}
  const run = spec.run_requirements || {}
  const packaging = spec.packaging || {}

  const industryFlags = new Set<string>(Array.isArray(identity.industry_flags) ? identity.industry_flags : [])
  const qualityFlags = new Set<string>(Array.isArray(quality.flags) ? quality.flags : [])

  const blend = Array.isArray(formulation.blend) ? formulation.blend : []
  const additives = Array.isArray(formulation.additives) ? formulation.additives : []
  const legacyColourRow =
    formulation.colour?.colour_code || formulation.colour?.strength_pct != null
      ? [{ colour_code: formulation.colour?.colour_code || '', strength_pct: formulation.colour?.strength_pct ?? null }]
      : []
  const colourComponents =
    Array.isArray(formulation.colour_components) && formulation.colour_components.length > 0 ? formulation.colour_components : legacyColourRow

  const printingEnabled = printing.method && printing.method !== 'None'
  const finishMode = identity.finish_mode || 'Rolls'

  const productType: ProductType = (identity.product_type as ProductType) || PRODUCT_TYPE.Bag
  const canHaveGusset = productType === PRODUCT_TYPE.Bag || productType === PRODUCT_TYPE.Tube
  const isUFilm = productType === PRODUCT_TYPE.UFilm

  const [resinBlends, setResinBlends] = useState<ResinBlendPreset[]>([])
  const [resinBlendsErr, setResinBlendsErr] = useState<string | null>(null)
  const [resins, setResins] = useState<ResinOption[]>([])
  const [resinsErr, setResinsErr] = useState<string | null>(null)
  const [colours, setColours] = useState<ColourOption[]>([])
  const [coloursErr, setColoursErr] = useState<string | null>(null)
  const [additiveOptions, setAdditiveOptions] = useState<AdditiveOption[]>([])
  const [additivesErr, setAdditivesErr] = useState<string | null>(null)
  const [inks, setInks] = useState<InkOption[]>([])
  const [inksErr, setInksErr] = useState<string | null>(null)
  const [plates, setPlates] = useState<PlateOption[]>([])
  const [platesErr, setPlatesErr] = useState<string | null>(null)

  const computedTrimSelect = useMemo(() => {
    const v = identity.trim_pct
    if (v == null) return ''
    const n = Number(v)
    if ([5, 10, 20].includes(n)) return String(n)
    return 'custom'
  }, [identity.trim_pct])
  const [trimSelect, setTrimSelect] = useState<string>(computedTrimSelect)

  useEffect(() => {
    // Keep dropdown in sync with identity.trim_pct, except when the user is
    // actively in "custom" mode (trim_pct may temporarily equal 5/10/20).
    setTrimSelect((prev) => (prev === 'custom' ? 'custom' : computedTrimSelect))
  }, [computedTrimSelect])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setResinBlendsErr(null)
        const rows = await apiFetch<ResinBlendPreset[]>('/api/rate-cards/resin-blends')
        if (cancelled) return
        setResinBlends(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setResinBlendsErr(e instanceof Error ? e.message : 'Failed to load resin blends')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!Array.isArray(resinBlends) || resinBlends.length === 0) return
    const preset = resinBlends.find((b) => b.blend_code === 'LD')
    if (!preset) return
    const curType = formulation.blend_type || 'Custom'
    if (curType !== 'LD') return
    const curBlend = Array.isArray(formulation.blend) ? formulation.blend : []
    const looksPlaceholder =
      curBlend.length === 0 ||
      (curBlend.length === 1 && curBlend[0]?.resin_code === 'LDPE' && Math.abs(Number(curBlend[0]?.pct || 0) - 100) < 0.0001)
    if (!looksPlaceholder) return

    update((d) => {
      d.formulation.blend_type = 'LD'
      d.formulation.blend = preset.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resinBlends])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setResinsErr(null)
        const rows = await apiFetch<ResinOption[]>('/api/rate-cards/resins')
        if (cancelled) return
        setResins(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setResinsErr(e instanceof Error ? e.message : 'Failed to load resins')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setColoursErr(null)
        const rows = await apiFetch<ColourOption[]>('/api/rate-cards/colours')
        if (cancelled) return
        setColours(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setColoursErr(e instanceof Error ? e.message : 'Failed to load colours')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setAdditivesErr(null)
        const rows = await apiFetch<AdditiveOption[]>('/api/rate-cards/additives')
        if (cancelled) return
        setAdditiveOptions(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setAdditivesErr(e instanceof Error ? e.message : 'Failed to load additives')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setInksErr(null)
        const rows = await apiFetch<InkOption[]>('/api/rate-cards/inks')
        if (cancelled) return
        setInks(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setInksErr(e instanceof Error ? e.message : 'Failed to load inks')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setPlatesErr(null)
        const q = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''
        const rows = await apiFetch<Array<{ plate_code: string; description?: string | null }>>(`/api/rate-cards/plates${q}`)
        if (cancelled) return
        setPlates(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setPlatesErr(e instanceof Error ? e.message : 'Failed to load plates')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [customerId])

  function ensureFixedInkPlateRows(d: SpecPayload) {
    const p = d.printing || {}
    if (p.method !== 'Inline') return
    for (const key of ['front_ink_plate', 'back_ink_plate'] as const) {
      const cur = Array.isArray(p[key]) ? p[key].slice(0, 4) : []
      while (cur.length < 4) cur.push({ ink_code: '', plate_code: '' })
      p[key] = cur
    }
  }

  function syncLegacyInkPlateFromPairs(d: SpecPayload) {
    const p = d.printing || {}
    if (p.method !== 'Inline') return
    const front = Array.isArray(p.front_ink_plate) ? p.front_ink_plate : []
    const back = Array.isArray(p.back_ink_plate) ? p.back_ink_plate : []
    const all = [...front, ...back]
    p.ink_codes = all.map((r: any) => (r?.ink_code || '').trim()).filter(Boolean)
    p.plate_codes = all.map((r: any) => (r?.plate_code || '').trim()).filter(Boolean)
  }

  useEffect(() => {
    if (printing.method !== 'Inline') return
    const fl = Array.isArray(printing.front_ink_plate) ? printing.front_ink_plate.length : 0
    const bl = Array.isArray(printing.back_ink_plate) ? printing.back_ink_plate.length : 0
    if (fl === 4 && bl === 4) return
    update((d) => {
      ensureFixedInkPlateRows(d)
      syncLegacyInkPlateFromPairs(d)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing.method])

  function syncLegacyColourFromComponents(d: SpecPayload) {
    const comps = Array.isArray(d?.formulation?.colour_components) ? d.formulation.colour_components : []
    const first = comps[0]
    const cc = (first?.colour_code || '').trim()
    const sp = first?.strength_pct
    if (!cc && (sp == null || sp === '')) {
      d.formulation.colour = null
      return
    }
    d.formulation.colour = d.formulation.colour || { opaque: false }
    d.formulation.colour.colour_code = cc || null
    d.formulation.colour.strength_pct = typeof sp === 'number' ? sp : sp ? parseFloat(String(sp)) : null
    // Keep existing opaque fields if they were set previously; otherwise default.
    if (d.formulation.colour.opaque == null) d.formulation.colour.opaque = false
  }

  const derived: DerivedDimensions = useMemo(() => {
    const baseWidth = typeof dimensions.base_width_mm === 'number' ? dimensions.base_width_mm : 0
    const gussetOrSide = typeof dimensions.gusset_mm === 'number' ? dimensions.gusset_mm : 0

    let layflat = baseWidth
    if (productType === PRODUCT_TYPE.Centerfold) {
      layflat = 0.5 * baseWidth
    } else if (productType === PRODUCT_TYPE.UFilm) {
      layflat = baseWidth + 2 * gussetOrSide
    } else if (canHaveGusset && gussetOrSide > 0) {
      layflat = baseWidth + 2 * gussetOrSide
    }

    return {
      layflat_mm: layflat,
    }
  }, [canHaveGusset, dimensions.base_width_mm, dimensions.gusset_mm, productType])

  function onProductTypeChange(nextTypeRaw: string) {
    const nextType = nextTypeRaw as ProductType
    update((d) => {
      d.identity.product_type = nextType

      // Centerfold implies CentreFold geometry and no gusset.
      if (nextType === PRODUCT_TYPE.Centerfold) {
        d.dimensions.geometry = 'CentreFold'
        d.dimensions.gusset_mm = null
        return
      }

      // If leaving Centerfold, fall back to Flat.
      if (d.dimensions.geometry === 'CentreFold') d.dimensions.geometry = 'Flat'

      // Gusset only allowed for Bag/Tube.
      const allowGusset = nextType === PRODUCT_TYPE.Bag || nextType === PRODUCT_TYPE.Tube
      if (!allowGusset) {
        d.dimensions.geometry = 'Flat'
        // For U-Film we repurpose gusset_mm as "Side Width"; don't clear it.
        if (nextType !== PRODUCT_TYPE.UFilm) d.dimensions.gusset_mm = null
      }

      // Tubes are always rolls in our simplified UI (length disabled for Tube).
      if (nextType === PRODUCT_TYPE.Tube) {
        d.identity.finish_mode = 'Rolls'
        d.packaging.pack_mode = 'Rolls'
        d.dimensions.base_length_mm = null
      }
    })
  }

  function errorFor(key: string): string | undefined {
    return fieldErrors?.[key]
  }

  function firstErrorForPrefix(prefix: string): string | undefined {
    if (!fieldErrors) return undefined
    for (const [k, v] of Object.entries(fieldErrors)) {
      if (k === prefix || k.startsWith(prefix + '.') || k.startsWith(prefix + '[')) return v
    }
    return undefined
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Product Identity
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <TextField
            select
            label="Product Type"
            value={identity.product_type || PRODUCT_TYPE.Bag}
            onChange={(e) => onProductTypeChange(e.target.value)}
            required
            error={!!errorFor('spec.identity.product_type')}
            helperText={errorFor('spec.identity.product_type') || ''}
          >
            {PRODUCT_TYPES.map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Finish Mode"
            value={identity.finish_mode || 'Rolls'}
            onChange={(e) => {
              const v = e.target.value
              update((d) => {
                d.identity.finish_mode = v
                d.packaging.pack_mode = v
              })
            }}
            required
            error={!!errorFor('spec.identity.finish_mode')}
            helperText={errorFor('spec.identity.finish_mode') || ''}
          >
            <MenuItem value="Rolls">Rolls</MenuItem>
            <MenuItem value="Cartons">Cartons</MenuItem>
          </TextField>

          <TextField
            select
            label="Trim"
            value={trimSelect}
            onChange={(e) => {
              const v = e.target.value
              setTrimSelect(v)
              update((d) => {
                if (!v) d.identity.trim_pct = null
                else if (v === 'custom') d.identity.trim_pct = d.identity.trim_pct ?? 5
                else d.identity.trim_pct = parseFloat(v)
              })
            }}
          >
            <MenuItem value="">-</MenuItem>
            <MenuItem value="5">5%</MenuItem>
            <MenuItem value="10">10%</MenuItem>
            <MenuItem value="20">20%</MenuItem>
            <MenuItem value="custom">Custom…</MenuItem>
          </TextField>

          {trimSelect === 'custom' ? (
            <TextField
              label="Custom trim (%)"
              type="number"
              inputProps={{ min: 0, step: 0.1 }}
              value={identity.trim_pct ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.identity.trim_pct = e.target.value ? parseFloat(e.target.value) : null
                })
              }
            />
          ) : null}

          <TextField
            label="Notes"
            value={identity.notes || ''}
            onChange={(e) => update((d) => (d.identity.notes = e.target.value || null))}
            multiline
            minRows={3}
            error={!!errorFor('spec.identity.notes')}
            helperText={errorFor('spec.identity.notes') || ''}
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Volume calculations
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField
              select
              label="Roll weight billing"
              value={identity.roll_weight_billing || 'core_included'}
              onChange={(e) => update((d) => (d.identity.roll_weight_billing = e.target.value))}
              helperText="How core weight is treated when billing a customer."
              error={!!errorFor('spec.identity.roll_weight_billing')}
            >
              <MenuItem value="core_included">Core included in weight of roll</MenuItem>
              <MenuItem value="core_off">Take core weight off weight</MenuItem>
              <MenuItem value="core_half_off">Take half of core weight off</MenuItem>
            </TextField>
          </Box>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Industry / Compliance Intent
          </Typography>
          <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {[
              { id: 'food_contact', label: 'Food Contact' },
              { id: 'medical', label: 'Medical' },
              { id: 'chemical_industrial', label: 'Chemical / Industrial' },
            ].map((f) => (
              <FormControlLabel
                key={f.id}
                control={
                  <Checkbox
                    checked={industryFlags.has(f.id)}
                    onChange={(e) =>
                      update((d) => {
                        const cur = new Set<string>(d.identity.industry_flags || [])
                        if (e.target.checked) cur.add(f.id)
                        else cur.delete(f.id)
                        d.identity.industry_flags = Array.from(cur)
                      })
                    }
                  />
                }
                label={f.label}
              />
            ))}
          </FormGroup>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Dimensions &amp; Geometry
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, gridColumn: '1 / -1' }}>
          <TextField
            label="Base Width (mm)"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={dimensions.base_width_mm ?? ''}
            onChange={(e) => update((d) => (d.dimensions.base_width_mm = parseInt(e.target.value || '0')))}
            required
            error={!!errorFor('spec.dimensions.base_width_mm')}
            helperText={errorFor('spec.dimensions.base_width_mm') || ''}
          />

          {isUFilm ? (
            <TextField
              label="Side Width (mm)"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={dimensions.gusset_mm ?? ''}
              onChange={(e) => update((d) => (d.dimensions.gusset_mm = e.target.value ? parseInt(e.target.value) : null))}
              error={!!errorFor('spec.dimensions.gusset_mm')}
              helperText={errorFor('spec.dimensions.gusset_mm') || ''}
            />
          ) : (
            <TextField
              label="Gusset Size (mm)"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={dimensions.gusset_mm ?? ''}
              disabled={!canHaveGusset}
              onChange={(e) => {
                const raw = e.target.value
                const next = raw ? parseInt(raw) : null
                update((d) => {
                  d.dimensions.gusset_mm = next
                })
              }}
              error={!!errorFor('spec.dimensions.gusset_mm')}
              helperText={
                errorFor('spec.dimensions.gusset_mm') ||
                (!canHaveGusset
                  ? `Not used for ${productType}`
                  : '')
              }
            />
          )}
          </Box>

          <TextField
            label="Length (mm)"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={dimensions.base_length_mm ?? ''}
            onChange={(e) =>
              update((d) => (d.dimensions.base_length_mm = e.target.value ? parseInt(e.target.value) : null))
            }
            disabled={productType === PRODUCT_TYPE.Tube}
            helperText={
              productType === PRODUCT_TYPE.Tube
                ? 'Not used for tubes'
                : finishMode === 'Cartons'
                  ? 'Required when Finish Mode = Cartons'
                  : ''
            }
            error={!!errorFor('spec.dimensions.base_length_mm')}
          />

          <TextField
            label="Thickness (µm)"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={dimensions.thickness_um ?? ''}
            onChange={(e) => update((d) => (d.dimensions.thickness_um = parseInt(e.target.value || '0')))}
            required
            error={!!errorFor('spec.dimensions.thickness_um')}
            helperText={errorFor('spec.dimensions.thickness_um') || ''}
          />
        </Box>
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
          <Typography variant="body2">
            Layflat (mm): <strong>{derived.layflat_mm}</strong>
          </Typography>
        </Paper>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Materials &amp; Formulation
        </Typography>

        {resinsErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Resins unavailable: {resinsErr}
          </Alert>
        )}

        {resinBlendsErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Resin blends unavailable: {resinBlendsErr}
          </Alert>
        )}

        {coloursErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Colours unavailable: {coloursErr}
          </Alert>
        )}

        {additivesErr && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Additives unavailable: {additivesErr}
          </Alert>
        )}

        {firstErrorForPrefix('spec.formulation.blend') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.formulation.blend')}
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Resin Blend
          </Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2, mb: 2 }}>
              <TextField
                select
                label="Resin Blend"
                value={formulation.blend_type || 'Custom'}
                onChange={(e) => {
                  const v = e.target.value
                  update((d) => {
                    d.formulation.blend_type = v
                    if (v === 'Custom') return
                    const preset = resinBlends.find((b) => b.blend_code === v)
                    if (!preset) return
                    d.formulation.blend = preset.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct }))
                  })
                }}
              >
                <MenuItem value="Custom">Custom</MenuItem>
                {resinBlends.map((b) => (
                  <MenuItem key={b.blend_code} value={b.blend_code}>
                    {b.name}
                  </MenuItem>
                ))}
                {(() => {
                  const cur = formulation.blend_type
                  if (!cur || cur === 'Custom') return null
                  const known = resinBlends.some((b) => b.blend_code === cur)
                  if (known) return null
                  return (
                    <MenuItem value={cur} disabled>
                      {cur}
                    </MenuItem>
                  )
                })()}
              </TextField>
            </Box>

            <Table
              size="small"
              sx={{
                tableLayout: 'fixed',
                '& th, & td': { borderBottom: 'none' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Resin</TableCell>
                  <TableCell sx={{ width: 160 }}>Pct</TableCell>
                  <TableCell sx={{ width: 140 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {blend.map((row: any, idx: number) => (
                  <TableRow key={idx} hover>
                    <TableCell>
                      <ResinSelect
                        options={resins}
                        valueCode={row.resin_code || ''}
                        error={
                          !!errorFor(`spec.formulation.blend[${idx}].resin_code`) || !!firstErrorForPrefix('spec.formulation.blend')
                        }
                        helperText={
                          errorFor(`spec.formulation.blend[${idx}].resin_code`) ||
                          (idx === 0 ? firstErrorForPrefix('spec.formulation.blend') || '' : '')
                        }
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend[idx].resin_code = nextCode
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Pct"
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        value={row.pct ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend[idx].pct = e.target.value ? parseFloat(e.target.value) : 0
                          })
                        }
                        error={!!errorFor(`spec.formulation.blend[${idx}].pct`) || !!firstErrorForPrefix('spec.formulation.blend')}
                        helperText={errorFor(`spec.formulation.blend[${idx}].pct`) || ''}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        type="button"
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() =>
                          update((d) => {
                            d.formulation.blend_type = 'Custom'
                            d.formulation.blend.splice(idx, 1)
                            if (d.formulation.blend.length === 0) d.formulation.blend.push({ resin_code: '', pct: 100 })
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow>
                  <TableCell />
                  <TableCell />
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      sx={{ whiteSpace: 'nowrap' }}
                      onClick={() =>
                        update((d) => {
                          d.formulation.blend_type = 'Custom'
                          d.formulation.blend.push({ resin_code: '', pct: 0 })
                        })
                      }
                    >
                      Add component
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {(() => {
              const total = (blend || []).reduce((acc: number, r: any) => acc + Number(r?.pct || 0), 0)
              const ok = Math.abs(total - 100) < 0.01
              return (
                <Typography variant="caption" color={ok ? 'text.secondary' : 'error'} sx={{ display: 'block', mt: 1 }}>
                  Total: {total.toFixed(2)}% {ok ? '(OK)' : '(must sum to 100%)'}
                </Typography>
              )
            })()}
          </Paper>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Colour Components &amp; Additives (Pct values do not need to sum to 100%.)
          </Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Colour Components
            </Typography>
            <Table
              size="small"
              sx={{
                tableLayout: 'fixed',
                '& th, & td': { borderBottom: 'none' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Colour</TableCell>
                  <TableCell sx={{ width: 160 }}>Pct</TableCell>
                  <TableCell sx={{ width: 140 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {colourComponents.map((row: any, idx: number) => (
                  <TableRow key={idx} hover>
                    <TableCell>
                      <ColourSelect
                        options={colours}
                        valueCode={row.colour_code || ''}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.colour_components)) d.formulation.colour_components = []
                            d.formulation.colour_components[idx] = {
                              ...(d.formulation.colour_components[idx] || {}),
                              colour_code: nextCode,
                            }
                            syncLegacyColourFromComponents(d)
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Pct"
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        value={row.strength_pct ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.colour_components)) d.formulation.colour_components = []
                            d.formulation.colour_components[idx] = {
                              ...(d.formulation.colour_components[idx] || {}),
                              strength_pct: e.target.value ? parseFloat(e.target.value) : null,
                            }
                            syncLegacyColourFromComponents(d)
                          })
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        type="button"
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.colour_components)) d.formulation.colour_components = []
                            d.formulation.colour_components.splice(idx, 1)
                            syncLegacyColourFromComponents(d)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow>
                  <TableCell />
                  <TableCell />
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      sx={{ whiteSpace: 'nowrap' }}
                      onClick={() =>
                        update((d) => {
                          if (!Array.isArray(d.formulation.colour_components)) d.formulation.colour_components = []
                          d.formulation.colour_components.push({ colour_code: '', strength_pct: null })
                          syncLegacyColourFromComponents(d)
                        })
                      }
                    >
                      Add Colour
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <Box sx={{ mt: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Additives
            </Typography>
            <Table
              size="small"
              sx={{
                tableLayout: 'fixed',
                '& th, & td': { borderBottom: 'none' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Additive</TableCell>
                  <TableCell sx={{ width: 160 }}>Pct</TableCell>
                  <TableCell sx={{ width: 140 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {additives.map((row: any, idx: number) => (
                  <TableRow key={idx} hover>
                    <TableCell>
                      <AdditiveSelect
                        options={additiveOptions}
                        valueCode={row.additive_code || ''}
                        onChangeCode={(nextCode) =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.additives)) d.formulation.additives = []
                            d.formulation.additives[idx] = { ...(d.formulation.additives[idx] || {}), additive_code: nextCode }
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        label="Pct"
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        value={row.pct ?? ''}
                        onChange={(e) =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.additives)) d.formulation.additives = []
                            d.formulation.additives[idx] = {
                              ...(d.formulation.additives[idx] || {}),
                              pct: e.target.value ? parseFloat(e.target.value) : 0,
                            }
                          })
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        type="button"
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() =>
                          update((d) => {
                            if (!Array.isArray(d.formulation.additives)) d.formulation.additives = []
                            d.formulation.additives.splice(idx, 1)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow>
                  <TableCell />
                  <TableCell />
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      sx={{ whiteSpace: 'nowrap' }}
                      onClick={() =>
                        update((d) => {
                          if (!Array.isArray(d.formulation.additives)) d.formulation.additives = []
                          const defaultCode = additiveOptions[0]?.additive_code || ''
                          d.formulation.additives.push({ additive_code: defaultCode, pct: 0 })
                        })
                      }
                    >
                      Add Additive
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Printing &amp; Artwork
        </Typography>

        {firstErrorForPrefix('spec.printing') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.printing')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <TextField
            select
            label="Printing Method"
            value={printing.method || 'None'}
            onChange={(e) =>
              update((d) => {
                const next = e.target.value
                d.printing.method = next
                if (next === 'Inline' && !d.printing.side) d.printing.side = 'front'
              })
            }
            error={!!errorFor('spec.printing.method') || !!firstErrorForPrefix('spec.printing')}
            helperText={errorFor('spec.printing.method') || ''}
          >
            <MenuItem value="None">None</MenuItem>
            <MenuItem value="Inline">Inline</MenuItem>
            <MenuItem value="Uteco">Uteco</MenuItem>
          </TextField>

          <TextField
            select
            label="Print Side"
            value={printing.side || ''}
            onChange={(e) => update((d) => (d.printing.side = e.target.value || null))}
            disabled={!printingEnabled}
          >
            <MenuItem value="">-</MenuItem>
            <MenuItem value="front">front</MenuItem>
            <MenuItem value="back">back</MenuItem>
            <MenuItem value="both">both</MenuItem>
          </TextField>

          <TextField
            label="Print Description"
            value={printing.print_description || ''}
            onChange={(e) => update((d) => (d.printing.print_description = e.target.value || null))}
            disabled={!printingEnabled}
            multiline
            minRows={2}
          >
          </TextField>
        </Box>

        {printingEnabled && printing.method === 'Inline' ? (
          <Box sx={{ mt: 2 }}>
            {(printing.side === 'front' || printing.side === 'both') && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Front print (Ink | Plate)
                </Typography>
                {(inksErr || platesErr) && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    {inksErr || platesErr}
                  </Alert>
                )}
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <Table size="small" sx={{ tableLayout: 'fixed' }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: '50%' }}>Ink</TableCell>
                        <TableCell sx={{ width: '50%' }}>Plate</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[0, 1, 2, 3].map((idx) => {
                        const row: any = (Array.isArray(printing.front_ink_plate) ? printing.front_ink_plate[idx] : null) || {}
                        return (
                          <TableRow key={idx} hover>
                            <TableCell>
                              <InkSelect
                                options={inks}
                                valueCode={row?.ink_code || ''}
                                label={`Ink ${idx + 1}`}
                                onChangeCode={(nextCode) =>
                                  update((d) => {
                                    ensureFixedInkPlateRows(d)
                                    d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), ink_code: nextCode }
                                    syncLegacyInkPlateFromPairs(d)
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <PlateSelect
                                options={plates}
                                valueCode={row?.plate_code || ''}
                                label={`Plate ${idx + 1}`}
                                onChangeCode={(nextCode) =>
                                  update((d) => {
                                    ensureFixedInkPlateRows(d)
                                    d.printing.front_ink_plate[idx] = { ...(d.printing.front_ink_plate[idx] || {}), plate_code: nextCode }
                                    syncLegacyInkPlateFromPairs(d)
                                  })
                                }
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              </Box>
            )}

            {(printing.side === 'back' || printing.side === 'both') && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Back print (Ink | Plate)
                </Typography>
                {(inksErr || platesErr) && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    {inksErr || platesErr}
                  </Alert>
                )}
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <Table size="small" sx={{ tableLayout: 'fixed' }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: '50%' }}>Ink</TableCell>
                        <TableCell sx={{ width: '50%' }}>Plate</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[0, 1, 2, 3].map((idx) => {
                        const row: any = (Array.isArray(printing.back_ink_plate) ? printing.back_ink_plate[idx] : null) || {}
                        return (
                          <TableRow key={idx} hover>
                            <TableCell>
                              <InkSelect
                                options={inks}
                                valueCode={row?.ink_code || ''}
                                label={`Ink ${idx + 1}`}
                                onChangeCode={(nextCode) =>
                                  update((d) => {
                                    ensureFixedInkPlateRows(d)
                                    d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), ink_code: nextCode }
                                    syncLegacyInkPlateFromPairs(d)
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <PlateSelect
                                options={plates}
                                valueCode={row?.plate_code || ''}
                                label={`Plate ${idx + 1}`}
                                onChangeCode={(nextCode) =>
                                  update((d) => {
                                    ensureFixedInkPlateRows(d)
                                    d.printing.back_ink_plate[idx] = { ...(d.printing.back_ink_plate[idx] || {}), plate_code: nextCode }
                                    syncLegacyInkPlateFromPairs(d)
                                  })
                                }
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              </Box>
            )}
          </Box>
        ) : null}

        {printingEnabled && printing.method === 'Uteco' ? (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField
                label="Ink Codes (comma-separated)"
                value={listToCsv(printing.ink_codes)}
                onChange={(e) => update((d) => (d.printing.ink_codes = csvToList(e.target.value)))}
                disabled={!printingEnabled}
              />
              <TextField
                label="Plate Codes (comma-separated)"
                value={listToCsv(printing.plate_codes)}
                onChange={(e) => update((d) => (d.printing.plate_codes = csvToList(e.target.value)))}
                disabled={!printingEnabled}
              />
            </Box>
          </Box>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Quality Expectations
        </Typography>

        <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {[
            { id: 'tight_gauge', label: 'Tight gauge tolerance' },
            { id: 'seal_integrity', label: 'Seal integrity critical' },
            { id: 'cosmetic', label: 'Cosmetic critical' },
            { id: 'colour', label: 'Colour critical' },
          ].map((f) => (
            <FormControlLabel
              key={f.id}
              control={
                <Checkbox
                  checked={qualityFlags.has(f.id)}
                  onChange={(e) =>
                    update((d) => {
                      const cur = new Set<string>(d.quality_expectations.flags || [])
                      if (e.target.checked) cur.add(f.id)
                      else cur.delete(f.id)
                      d.quality_expectations.flags = Array.from(cur)
                    })
                  }
                />
              }
              label={f.label}
            />
          ))}
        </FormGroup>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Known Issues"
            value={quality.known_issues || ''}
            onChange={(e) => update((d) => (d.quality_expectations.known_issues = e.target.value || null))}
            multiline
            minRows={3}
            fullWidth
            error={!!errorFor('spec.quality_expectations.known_issues')}
            helperText={errorFor('spec.quality_expectations.known_issues') || ''}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Run Requirements
        </Typography>

        {firstErrorForPrefix('spec.run_requirements') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.run_requirements')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <TextField
            select
            label="Slit"
            value={run.slit || 'none'}
            onChange={(e) => update((d) => (d.run_requirements.slit = e.target.value))}
            error={!!errorFor('spec.run_requirements.slit')}
            helperText={errorFor('spec.run_requirements.slit') || ''}
          >
            <MenuItem value="none">none</MenuItem>
            <MenuItem value="one_side">Slit one side</MenuItem>
            <MenuItem value="both_sides">Slit both sides</MenuItem>
            <MenuItem value="middle">slit up middle</MenuItem>
          </TextField>
          <TextField
            select
            label="Treat Inside/Outside"
            value={run.treat_inside_outside || 'none'}
            onChange={(e) => update((d) => (d.run_requirements.treat_inside_outside = e.target.value))}
            error={!!errorFor('spec.run_requirements.treat_inside_outside')}
            helperText={errorFor('spec.run_requirements.treat_inside_outside') || ''}
          >
            <MenuItem value="none">none</MenuItem>
            <MenuItem value="inside">inside</MenuItem>
            <MenuItem value="outside">outside</MenuItem>
          </TextField>
        </Box>

        <Box sx={{ mt: 2 }}>
          <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!run.inline_perforation}
                  onChange={(e) => update((d) => (d.run_requirements.inline_perforation = e.target.checked))}
                />
              }
              label="Inline Perforation"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!run.hole_punched}
                  onChange={(e) => update((d) => (d.run_requirements.hole_punched = e.target.checked))}
                />
              }
              label="Hole punched"
            />
            <FormControlLabel
              control={
                <Checkbox checked={!!run.inline_seal} onChange={(e) => update((d) => (d.run_requirements.inline_seal = e.target.checked))} />
              }
              label="Inline Seal"
            />
          </FormGroup>
        </Box>

        <Box sx={{ mt: 2 }}>
          <TextField
            label="Notes"
            value={run.notes || ''}
            onChange={(e) => update((d) => (d.run_requirements.notes = e.target.value || null))}
            multiline
            minRows={3}
            fullWidth
            error={!!errorFor('spec.run_requirements.notes')}
            helperText={errorFor('spec.run_requirements.notes') || ''}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Packaging &amp; Logistics
        </Typography>

        {firstErrorForPrefix('spec.packaging') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.packaging')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <TextField
            select
            label="Pack Mode"
            value={packaging.pack_mode || finishMode}
            onChange={(e) => update((d) => (d.packaging.pack_mode = e.target.value))}
            error={!!errorFor('spec.packaging.pack_mode')}
            helperText={errorFor('spec.packaging.pack_mode') || ''}
          >
            <MenuItem value="Rolls">Rolls</MenuItem>
            <MenuItem value="Cartons">Cartons</MenuItem>
          </TextField>

          <TextField
            select
            label="Core Type"
            value={packaging.core_type || '7mm'}
            onChange={(e) => update((d) => (d.packaging.core_type = e.target.value))}
          >
            {['7mm', '13mm', 'PVC', 'None'].map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Core Policy"
            value={packaging.core_policy || 'Include'}
            onChange={(e) => update((d) => (d.packaging.core_policy = e.target.value))}
          >
            <MenuItem value="Include">Include</MenuItem>
            <MenuItem value="Half">Half</MenuItem>
            <MenuItem value="Exclude">Exclude</MenuItem>
          </TextField>

          <TextField
            label="Bags per Carton"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={packaging.bags_per_carton ?? ''}
            onChange={(e) =>
              update((d) => (d.packaging.bags_per_carton = e.target.value ? parseInt(e.target.value) : null))
            }
            disabled={(packaging.pack_mode || finishMode) === 'Rolls'}
            helperText={
              (packaging.pack_mode || finishMode) === 'Rolls' ? 'Not used for Rolls' : 'Required when pack_mode = Cartons'
            }
            error={!!errorFor('spec.packaging.bags_per_carton')}
          />

          <TextField
            select
            label="Pallet Type"
            value={packaging.pallet_type || 'Chep'}
            onChange={(e) => update((d) => (d.packaging.pallet_type = e.target.value))}
          >
            {['Chep', 'Plain', 'Resin', 'None'].map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={<Checkbox checked={!!packaging.wrapped} onChange={(e) => update((d) => (d.packaging.wrapped = e.target.checked))} />}
            label="Wrapped"
          />
        </Box>
      </Paper>

    </Stack>
  )
}


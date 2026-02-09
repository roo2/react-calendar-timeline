import { useMemo } from 'react'
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
  TextField,
  Typography,
} from '@mui/material'

type DerivedDimensions = {
  layflat_mm: number
  decision_width_mm: number
  area_per_unit_mm2?: number | null
}

export type SpecPayload = any

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
      product_type: 'Bag',
      finish_mode: 'Rolls',
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
      blend_type: 'Custom',
      blend: [{ resin_code: 'LDPE', pct: 100 }],
      colour: null,
      additives: [],
    },
    printing: {
      method: 'None',
      num_colours: 0,
      ink_codes: [],
      plate_codes: [],
      side: null,
      artwork_refs: [],
    },
    quality_expectations: {
      flags: [],
      known_issues: null,
    },
    run_requirements: {
      preferred_extruders: [],
      preferred_printer: null,
      preferred_converter: null,
      treat_inside_outside: 'none',
      inline_perforation: false,
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
  onPreviewDerived?: () => void
  derived?: DerivedDimensions | null
  fieldErrors?: Record<string, string>
}) {
  const { value, onChange, onPreviewDerived, derived, fieldErrors } = props

  const spec = useMemo(() => value || makeDefaultSpec(), [value])

  function update(mut: (draft: SpecPayload) => void) {
    const next = clone(spec)
    mut(next)
    onChange(next)
  }

  const identity = spec.identity || {}
  const dimensions = spec.dimensions || {}
  const formulation = spec.formulation || {}
  const printing = spec.printing || {}
  const quality = spec.quality_expectations || {}
  const run = spec.run_requirements || {}
  const packaging = spec.packaging || {}
  const tools = Array.isArray(spec.tool_requirements) ? spec.tool_requirements : []

  const industryFlags = new Set<string>(Array.isArray(identity.industry_flags) ? identity.industry_flags : [])
  const qualityFlags = new Set<string>(Array.isArray(quality.flags) ? quality.flags : [])

  const blend = Array.isArray(formulation.blend) ? formulation.blend : []
  const additives = Array.isArray(formulation.additives) ? formulation.additives : []

  const printingEnabled = printing.method && printing.method !== 'None'
  const finishMode = identity.finish_mode || 'Rolls'

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
            value={identity.product_type || 'Bag'}
            onChange={(e) => update((d) => (d.identity.product_type = e.target.value))}
            required
            error={!!errorFor('spec.identity.product_type')}
            helperText={errorFor('spec.identity.product_type') || ''}
          >
            {['Bag', 'BagOnRoll', 'Tube', 'Sleeve', 'Sheet', 'Centerfold', 'U-Film'].map((v) => (
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
                if (v === 'Rolls') d.dimensions.base_length_mm = null
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
            Industry / Compliance Intent
          </Typography>
          <FormGroup row sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {[
              { id: 'food_contact', label: 'Food Contact' },
              { id: 'non_food', label: 'Non-Food' },
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

          <TextField
            label="Base Length (mm)"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={dimensions.base_length_mm ?? ''}
            onChange={(e) =>
              update((d) => (d.dimensions.base_length_mm = e.target.value ? parseInt(e.target.value) : null))
            }
            disabled={finishMode === 'Rolls'}
            helperText={finishMode === 'Rolls' ? 'Not used for Rolls' : 'Required when Finish Mode = Cartons'}
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

          <TextField
            select
            label="Geometry"
            value={dimensions.geometry || 'Flat'}
            onChange={(e) => update((d) => (d.dimensions.geometry = e.target.value))}
            required
            error={!!errorFor('spec.dimensions.geometry')}
            helperText={errorFor('spec.dimensions.geometry') || ''}
          >
            {['Flat', 'Gusset', 'BottomGusset', 'CentreFold'].map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Gusset Size (mm)"
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={dimensions.gusset_mm ?? ''}
            onChange={(e) => update((d) => (d.dimensions.gusset_mm = e.target.value ? parseInt(e.target.value) : null))}
            error={!!errorFor('spec.dimensions.gusset_mm')}
            helperText={errorFor('spec.dimensions.gusset_mm') || ''}
          />
        </Box>

        {onPreviewDerived && (
          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="button" variant="outlined" size="small" onClick={onPreviewDerived}>
              Preview Dimensions
            </Button>
            <Typography variant="body2" color="text.secondary">
              Computes derived dimensions from the current spec
            </Typography>
          </Box>
        )}

        {derived && (
          <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
            <Typography variant="body2">
              Layflat (mm): <strong>{derived.layflat_mm}</strong>
            </Typography>
            <Typography variant="body2">
              Decision Width (mm): <strong>{derived.decision_width_mm}</strong>
            </Typography>
            {derived.area_per_unit_mm2 != null && (
              <Typography variant="body2">
                Area per unit (mm²): <strong>{derived.area_per_unit_mm2}</strong>
              </Typography>
            )}
          </Paper>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Materials &amp; Formulation
        </Typography>

        {firstErrorForPrefix('spec.formulation.blend') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {firstErrorForPrefix('spec.formulation.blend')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
          <TextField
            select
            label="Blend Type"
            value={formulation.blend_type || 'Custom'}
            onChange={(e) => update((d) => (d.formulation.blend_type = e.target.value))}
            helperText="Resin blend must sum to 100%"
            error={!!errorFor('spec.formulation.blend_type')}
          >
            <MenuItem value="LD">LD</MenuItem>
            <MenuItem value="MD">MD</MenuItem>
            <MenuItem value="Custom">Custom</MenuItem>
          </TextField>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Resin Blend
          </Typography>

          <Stack spacing={1}>
            {blend.map((row: any, idx: number) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Resin code"
                    value={row.resin_code || ''}
                    onChange={(e) =>
                      update((d) => {
                        d.formulation.blend[idx].resin_code = e.target.value
                      })
                    }
                    error={!!errorFor(`spec.formulation.blend[${idx}].resin_code`) || !!firstErrorForPrefix('spec.formulation.blend')}
                    helperText={
                      errorFor(`spec.formulation.blend[${idx}].resin_code`) || (idx === 0 ? firstErrorForPrefix('spec.formulation.blend') || '' : '')
                    }
                  />
                  <TextField
                    label="Pct"
                    type="number"
                    inputProps={{ min: 0, step: 0.01 }}
                    value={row.pct ?? ''}
                    onChange={(e) =>
                      update((d) => {
                        d.formulation.blend[idx].pct = e.target.value ? parseFloat(e.target.value) : 0
                      })
                    }
                    error={!!errorFor(`spec.formulation.blend[${idx}].pct`) || !!firstErrorForPrefix('spec.formulation.blend')}
                    helperText={errorFor(`spec.formulation.blend[${idx}].pct`) || ''}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Button
                      type="button"
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() =>
                        update((d) => {
                          d.formulation.blend.splice(idx, 1)
                          if (d.formulation.blend.length === 0) d.formulation.blend.push({ resin_code: '', pct: 100 })
                        })
                      }
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
              </Paper>
            ))}
          </Stack>

          <Box sx={{ mt: 2 }}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => update((d) => d.formulation.blend.push({ resin_code: '', pct: 0 }))}
            >
              Add Component
            </Button>
          </Box>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Colour
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
            <TextField
              label="Colour code"
              value={formulation.colour?.colour_code || ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || { opaque: false }
                  d.formulation.colour.colour_code = e.target.value || null
                })
              }
            />
            <TextField
              label="Strength pct"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={formulation.colour?.strength_pct ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || { opaque: false }
                  d.formulation.colour.strength_pct = e.target.value ? parseFloat(e.target.value) : null
                })
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!formulation.colour?.opaque}
                  onChange={(e) =>
                    update((d) => {
                      d.formulation.colour = d.formulation.colour || {}
                      d.formulation.colour.opaque = e.target.checked
                    })
                  }
                />
              }
              label="Opaque"
            />
            <TextField
              label="Opaque strength pct"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={formulation.colour?.opaque_strength_pct ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || {}
                  d.formulation.colour.opaque_strength_pct = e.target.value ? parseFloat(e.target.value) : null
                })
              }
            />
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() =>
                  update((d) => {
                    d.formulation.colour = null
                  })
                }
              >
                Clear colour
              </Button>
            </Box>
          </Box>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            Additives
          </Typography>

          <Stack spacing={1}>
            {additives.map((row: any, idx: number) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Additive code"
                    value={row.additive_code || ''}
                    onChange={(e) =>
                      update((d) => {
                        d.formulation.additives[idx].additive_code = e.target.value
                      })
                    }
                  />
                  <TextField
                    label="Pct"
                    type="number"
                    inputProps={{ min: 0, step: 0.01 }}
                    value={row.pct ?? ''}
                    onChange={(e) =>
                      update((d) => {
                        d.formulation.additives[idx].pct = e.target.value ? parseFloat(e.target.value) : 0
                      })
                    }
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Button
                      type="button"
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() =>
                        update((d) => {
                          d.formulation.additives.splice(idx, 1)
                        })
                      }
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
              </Paper>
            ))}
          </Stack>

          <Box sx={{ mt: 2 }}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => update((d) => d.formulation.additives.push({ additive_code: '', pct: 0 }))}
            >
              Add Additive
            </Button>
          </Box>
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
            onChange={(e) => update((d) => (d.printing.method = e.target.value))}
            error={!!errorFor('spec.printing.method') || !!firstErrorForPrefix('spec.printing')}
            helperText={errorFor('spec.printing.method') || ''}
          >
            <MenuItem value="None">None</MenuItem>
            <MenuItem value="Inline">Inline</MenuItem>
            <MenuItem value="Uteco">Uteco</MenuItem>
          </TextField>

          <TextField
            label="Number of Colours"
            type="number"
            inputProps={{ min: 0, step: 1 }}
            value={printing.num_colours ?? 0}
            onChange={(e) => update((d) => (d.printing.num_colours = e.target.value ? parseInt(e.target.value) : 0))}
            disabled={!printingEnabled}
            error={!!errorFor('spec.printing.num_colours') || !!firstErrorForPrefix('spec.printing')}
            helperText={errorFor('spec.printing.num_colours') || ''}
          />

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
            label="Artwork Refs (comma-separated)"
            value={listToCsv(printing.artwork_refs)}
            onChange={(e) => update((d) => (d.printing.artwork_refs = csvToList(e.target.value)))}
            disabled={!printingEnabled}
            helperText={printingEnabled ? 'Required when printing is enabled' : ''}
          />
        </Box>
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
            label="Preferred Extruders (comma-separated)"
            value={listToCsv(run.preferred_extruders)}
            onChange={(e) => update((d) => (d.run_requirements.preferred_extruders = csvToList(e.target.value)))}
            error={!!errorFor('spec.run_requirements.preferred_extruders')}
            helperText={errorFor('spec.run_requirements.preferred_extruders') || ''}
          />
          <TextField
            label="Preferred Printer"
            value={run.preferred_printer || ''}
            onChange={(e) => update((d) => (d.run_requirements.preferred_printer = e.target.value || null))}
            error={!!errorFor('spec.run_requirements.preferred_printer')}
            helperText={errorFor('spec.run_requirements.preferred_printer') || ''}
          />
          <TextField
            label="Preferred Converter"
            value={run.preferred_converter || ''}
            onChange={(e) => update((d) => (d.run_requirements.preferred_converter = e.target.value || null))}
            error={!!errorFor('spec.run_requirements.preferred_converter')}
            helperText={errorFor('spec.run_requirements.preferred_converter') || ''}
          />
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

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Tool Requirements
        </Typography>

        <Stack spacing={1}>
          {tools.map((t: any, idx: number) => (
            <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                <TextField
                  select
                  label="Stage"
                  value={t.stage || 'extrusion'}
                  onChange={(e) => update((d) => (d.tool_requirements[idx].stage = e.target.value))}
                >
                  <MenuItem value="extrusion">extrusion</MenuItem>
                  <MenuItem value="conversion">conversion</MenuItem>
                </TextField>
                <TextField
                  label="Tool type"
                  value={t.tool_type || ''}
                  onChange={(e) => update((d) => (d.tool_requirements[idx].tool_type = e.target.value))}
                />
                <TextField
                  label="Quantity"
                  type="number"
                  inputProps={{ min: 1, step: 1 }}
                  value={t.quantity ?? 1}
                  onChange={(e) =>
                    update((d) => (d.tool_requirements[idx].quantity = e.target.value ? parseInt(e.target.value) : 1))
                  }
                />
                <TextField
                  label="Preferred machine IDs (comma-separated)"
                  value={listToCsv(t.preferred_machine_ids)}
                  onChange={(e) => update((d) => (d.tool_requirements[idx].preferred_machine_ids = csvToList(e.target.value)))}
                />
                <TextField
                  label="Notes"
                  value={t.notes || ''}
                  onChange={(e) => update((d) => (d.tool_requirements[idx].notes = e.target.value || null))}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Button type="button" variant="outlined" color="error" size="small" onClick={() => update((d) => d.tool_requirements.splice(idx, 1))}>
                    Remove
                  </Button>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>

        <Box sx={{ mt: 2 }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() =>
              update((d) =>
                d.tool_requirements.push({
                  stage: 'extrusion',
                  tool_type: '',
                  quantity: 1,
                  preferred_machine_ids: [],
                  notes: null,
                }),
              )
            }
          >
            Add Tool Requirement
          </Button>
        </Box>
      </Paper>
    </Stack>
  )
}


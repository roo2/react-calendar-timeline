import { useMemo } from 'react'
import { Box, Button, Paper, Typography } from '@mui/material'

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
}) {
  const { value, onChange, onPreviewDerived, derived } = props

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

  return (
    <div>
      <fieldset>
        <legend>Section 1: Product Identity</legend>
        <div>
          <label>Product Type</label>
          <select
            value={identity.product_type || 'Bag'}
            onChange={(e) => update((d) => (d.identity.product_type = e.target.value))}
            required
          >
            <option value="Bag">Bag</option>
            <option value="BagOnRoll">BagOnRoll</option>
            <option value="Tube">Tube</option>
            <option value="Sleeve">Sleeve</option>
            <option value="Sheet">Sheet</option>
            <option value="Centerfold">Centerfold</option>
            <option value="U-Film">U-Film</option>
          </select>
        </div>
        <div>
          <label>Finish Mode</label>
          <select
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
          >
            <option value="Rolls">Rolls</option>
            <option value="Cartons">Cartons</option>
          </select>
        </div>
        <div>
          <label>Industry / Compliance Intent</label>
          <div>
            {[
              { id: 'food_contact', label: 'Food Contact' },
              { id: 'non_food', label: 'Non-Food' },
              { id: 'medical', label: 'Medical' },
              { id: 'chemical_industrial', label: 'Chemical / Industrial' },
            ].map((f) => (
              <label key={f.id} style={{ marginRight: 12 }}>
                <input
                  type="checkbox"
                  checked={industryFlags.has(f.id)}
                  onChange={(e) =>
                    update((d) => {
                      const cur = new Set<string>(d.identity.industry_flags || [])
                      if (e.target.checked) cur.add(f.id)
                      else cur.delete(f.id)
                      d.identity.industry_flags = Array.from(cur)
                    })
                  }
                />{' '}
                {f.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label>Notes</label>
          <textarea
            value={identity.notes || ''}
            onChange={(e) => update((d) => (d.identity.notes = e.target.value || null))}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Section 2: Dimensions &amp; Geometry</legend>
        <div>
          <label>Base Width (mm)</label>
          <input
            type="number"
            min={1}
            value={dimensions.base_width_mm ?? ''}
            onChange={(e) => update((d) => (d.dimensions.base_width_mm = parseInt(e.target.value || '0')))}
            required
          />
        </div>
        <div>
          <label>Base Length (mm)</label>
          <input
            type="number"
            min={1}
            value={dimensions.base_length_mm ?? ''}
            onChange={(e) =>
              update((d) => (d.dimensions.base_length_mm = e.target.value ? parseInt(e.target.value) : null))
            }
            disabled={finishMode === 'Rolls'}
          />
          <small>Required if Finish Mode = Cartons</small>
        </div>
        <div>
          <label>Thickness (µm)</label>
          <input
            type="number"
            min={1}
            value={dimensions.thickness_um ?? ''}
            onChange={(e) => update((d) => (d.dimensions.thickness_um = parseInt(e.target.value || '0')))}
            required
          />
        </div>
        <div>
          <label>Geometry</label>
          <select
            value={dimensions.geometry || 'Flat'}
            onChange={(e) => update((d) => (d.dimensions.geometry = e.target.value))}
            required
          >
            <option value="Flat">Flat</option>
            <option value="Gusset">Gusset</option>
            <option value="BottomGusset">BottomGusset</option>
            <option value="CentreFold">CentreFold</option>
          </select>
        </div>
        <div>
          <label>Gusset Size (mm)</label>
          <input
            type="number"
            min={1}
            value={dimensions.gusset_mm ?? ''}
            onChange={(e) =>
              update((d) => (d.dimensions.gusset_mm = e.target.value ? parseInt(e.target.value) : null))
            }
          />
        </div>

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
      </fieldset>

      <fieldset>
        <legend>Section 3: Materials &amp; Formulation</legend>
        <div>
          <label>Blend Type</label>
          <select value={formulation.blend_type || 'Custom'} onChange={(e) => update((d) => (d.formulation.blend_type = e.target.value))}>
            <option value="LD">LD</option>
            <option value="MD">MD</option>
            <option value="Custom">Custom</option>
          </select>
          <small>Resin blend must sum to 100%</small>
        </div>

        <Box sx={{ mt: 2 }}>
          <label>Resin Blend</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {blend.map((row: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="resin_code"
                  value={row.resin_code || ''}
                  onChange={(e) =>
                    update((d) => {
                      d.formulation.blend[idx].resin_code = e.target.value
                    })
                  }
                />
                <input
                  type="number"
                  placeholder="pct"
                  min={0}
                  step={0.01}
                  value={row.pct ?? ''}
                  onChange={(e) =>
                    update((d) => {
                      d.formulation.blend[idx].pct = e.target.value ? parseFloat(e.target.value) : 0
                    })
                  }
                />
                <Button
                  type="button"
                  variant="outlined"
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
              </div>
            ))}
          </div>
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
          <label>Colour</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="colour_code"
              value={formulation.colour?.colour_code || ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || { opaque: false }
                  d.formulation.colour.colour_code = e.target.value || null
                })
              }
            />
            <input
              type="number"
              placeholder="strength_pct"
              min={0}
              step={0.01}
              value={formulation.colour?.strength_pct ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || { opaque: false }
                  d.formulation.colour.strength_pct = e.target.value ? parseFloat(e.target.value) : null
                })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={!!formulation.colour?.opaque}
                onChange={(e) =>
                  update((d) => {
                    d.formulation.colour = d.formulation.colour || {}
                    d.formulation.colour.opaque = e.target.checked
                  })
                }
              />{' '}
              Opaque
            </label>
            <input
              type="number"
              placeholder="opaque_strength_pct"
              min={0}
              step={0.01}
              value={formulation.colour?.opaque_strength_pct ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.formulation.colour = d.formulation.colour || {}
                  d.formulation.colour.opaque_strength_pct = e.target.value ? parseFloat(e.target.value) : null
                })
              }
            />
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
              Clear
            </Button>
          </div>
        </Box>

        <Box sx={{ mt: 2 }}>
          <label>Additives</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {additives.map((row: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="additive_code"
                  value={row.additive_code || ''}
                  onChange={(e) =>
                    update((d) => {
                      d.formulation.additives[idx].additive_code = e.target.value
                    })
                  }
                />
                <input
                  type="number"
                  placeholder="pct"
                  min={0}
                  step={0.01}
                  value={row.pct ?? ''}
                  onChange={(e) =>
                    update((d) => {
                      d.formulation.additives[idx].pct = e.target.value ? parseFloat(e.target.value) : 0
                    })
                  }
                />
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    update((d) => {
                      d.formulation.additives.splice(idx, 1)
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
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
      </fieldset>

      <fieldset>
        <legend>Section 4: Printing &amp; Artwork</legend>
        <div>
          <label>Printing Method</label>
          <select value={printing.method || 'None'} onChange={(e) => update((d) => (d.printing.method = e.target.value))}>
            <option value="None">None</option>
            <option value="Inline">Inline</option>
            <option value="Uteco">Uteco</option>
          </select>
        </div>
        <div>
          <label>Number of Colours</label>
          <input
            type="number"
            min={0}
            value={printing.num_colours ?? 0}
            onChange={(e) => update((d) => (d.printing.num_colours = e.target.value ? parseInt(e.target.value) : 0))}
            disabled={!printingEnabled}
          />
        </div>
        <div>
          <label>Ink Codes (comma-separated)</label>
          <input
            type="text"
            value={listToCsv(printing.ink_codes)}
            onChange={(e) => update((d) => (d.printing.ink_codes = csvToList(e.target.value)))}
            disabled={!printingEnabled}
          />
        </div>
        <div>
          <label>Plate Codes (comma-separated)</label>
          <input
            type="text"
            value={listToCsv(printing.plate_codes)}
            onChange={(e) => update((d) => (d.printing.plate_codes = csvToList(e.target.value)))}
            disabled={!printingEnabled}
          />
        </div>
        <div>
          <label>Print Side</label>
          <select
            value={printing.side || ''}
            onChange={(e) => update((d) => (d.printing.side = e.target.value || null))}
            disabled={!printingEnabled}
          >
            <option value="">-</option>
            <option value="front">front</option>
            <option value="back">back</option>
            <option value="both">both</option>
          </select>
        </div>
        <div>
          <label>Artwork Refs (comma-separated)</label>
          <input
            type="text"
            value={listToCsv(printing.artwork_refs)}
            onChange={(e) => update((d) => (d.printing.artwork_refs = csvToList(e.target.value)))}
            disabled={!printingEnabled}
          />
          {printingEnabled && <small>Required when printing is enabled</small>}
        </div>
      </fieldset>

      <fieldset>
        <legend>Section 5: Quality Expectations</legend>
        <div>
          {[
            { id: 'tight_gauge', label: 'Tight gauge tolerance' },
            { id: 'seal_integrity', label: 'Seal integrity critical' },
            { id: 'cosmetic', label: 'Cosmetic critical' },
            { id: 'colour', label: 'Colour critical' },
          ].map((f) => (
            <label key={f.id} style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={qualityFlags.has(f.id)}
                onChange={(e) =>
                  update((d) => {
                    const cur = new Set<string>(d.quality_expectations.flags || [])
                    if (e.target.checked) cur.add(f.id)
                    else cur.delete(f.id)
                    d.quality_expectations.flags = Array.from(cur)
                  })
                }
              />{' '}
              {f.label}
            </label>
          ))}
        </div>
        <div>
          <label>Known Issues</label>
          <textarea
            value={quality.known_issues || ''}
            onChange={(e) => update((d) => (d.quality_expectations.known_issues = e.target.value || null))}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Section 6: Run Requirements</legend>
        <div>
          <label>Preferred Extruders (comma-separated)</label>
          <input
            type="text"
            value={listToCsv(run.preferred_extruders)}
            onChange={(e) => update((d) => (d.run_requirements.preferred_extruders = csvToList(e.target.value)))}
          />
        </div>
        <div>
          <label>Preferred Printer</label>
          <input
            type="text"
            value={run.preferred_printer || ''}
            onChange={(e) => update((d) => (d.run_requirements.preferred_printer = e.target.value || null))}
          />
        </div>
        <div>
          <label>Preferred Converter</label>
          <input
            type="text"
            value={run.preferred_converter || ''}
            onChange={(e) => update((d) => (d.run_requirements.preferred_converter = e.target.value || null))}
          />
        </div>
        <div>
          <label>Treat Inside/Outside</label>
          <select
            value={run.treat_inside_outside || 'none'}
            onChange={(e) => update((d) => (d.run_requirements.treat_inside_outside = e.target.value))}
          >
            <option value="none">none</option>
            <option value="inside">inside</option>
            <option value="outside">outside</option>
          </select>
        </div>
        <div>
          <label style={{ marginRight: 12 }}>
            <input
              type="checkbox"
              checked={!!run.inline_perforation}
              onChange={(e) => update((d) => (d.run_requirements.inline_perforation = e.target.checked))}
            />{' '}
            Inline Perforation
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!run.inline_seal}
              onChange={(e) => update((d) => (d.run_requirements.inline_seal = e.target.checked))}
            />{' '}
            Inline Seal
          </label>
        </div>
        <div>
          <label>Notes</label>
          <textarea value={run.notes || ''} onChange={(e) => update((d) => (d.run_requirements.notes = e.target.value || null))} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Section 7: Packaging &amp; Logistics</legend>
        <div>
          <label>Pack Mode</label>
          <select
            value={packaging.pack_mode || finishMode}
            onChange={(e) => update((d) => (d.packaging.pack_mode = e.target.value))}
          >
            <option value="Rolls">Rolls</option>
            <option value="Cartons">Cartons</option>
          </select>
        </div>
        <div>
          <label>Core Type</label>
          <select value={packaging.core_type || '7mm'} onChange={(e) => update((d) => (d.packaging.core_type = e.target.value))}>
            <option value="7mm">7mm</option>
            <option value="13mm">13mm</option>
            <option value="PVC">PVC</option>
            <option value="None">None</option>
          </select>
        </div>
        <div>
          <label>Core Policy</label>
          <select
            value={packaging.core_policy || 'Include'}
            onChange={(e) => update((d) => (d.packaging.core_policy = e.target.value))}
          >
            <option value="Include">Include</option>
            <option value="Half">Half</option>
            <option value="Exclude">Exclude</option>
          </select>
        </div>
        <div>
          <label>Bags per Carton</label>
          <input
            type="number"
            min={1}
            value={packaging.bags_per_carton ?? ''}
            onChange={(e) =>
              update((d) => (d.packaging.bags_per_carton = e.target.value ? parseInt(e.target.value) : null))
            }
            disabled={(packaging.pack_mode || finishMode) === 'Rolls'}
          />
          <small>Required when pack_mode = Cartons</small>
        </div>
        <div>
          <label>Pallet Type</label>
          <select value={packaging.pallet_type || 'Chep'} onChange={(e) => update((d) => (d.packaging.pallet_type = e.target.value))}>
            <option value="Chep">Chep</option>
            <option value="Plain">Plain</option>
            <option value="Resin">Resin</option>
            <option value="None">None</option>
          </select>
        </div>
        <div>
          <label>
            <input type="checkbox" checked={!!packaging.wrapped} onChange={(e) => update((d) => (d.packaging.wrapped = e.target.checked))} />{' '}
            Wrapped
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Section 8: Tool Requirements</legend>
        <div style={{ display: 'grid', gap: 8 }}>
          {tools.map((t: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={t.stage || 'extrusion'}
                onChange={(e) => update((d) => (d.tool_requirements[idx].stage = e.target.value))}
              >
                <option value="extrusion">extrusion</option>
                <option value="conversion">conversion</option>
              </select>
              <input
                type="text"
                placeholder="tool_type"
                value={t.tool_type || ''}
                onChange={(e) => update((d) => (d.tool_requirements[idx].tool_type = e.target.value))}
              />
              <input
                type="number"
                min={1}
                style={{ width: 90 }}
                value={t.quantity ?? 1}
                onChange={(e) => update((d) => (d.tool_requirements[idx].quantity = e.target.value ? parseInt(e.target.value) : 1))}
              />
              <input
                type="text"
                placeholder="preferred_machine_ids (comma-separated)"
                value={listToCsv(t.preferred_machine_ids)}
                onChange={(e) => update((d) => (d.tool_requirements[idx].preferred_machine_ids = csvToList(e.target.value)))}
              />
              <input
                type="text"
                placeholder="notes"
                value={t.notes || ''}
                onChange={(e) => update((d) => (d.tool_requirements[idx].notes = e.target.value || null))}
              />
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => update((d) => d.tool_requirements.splice(idx, 1))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
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
      </fieldset>
    </div>
  )
}


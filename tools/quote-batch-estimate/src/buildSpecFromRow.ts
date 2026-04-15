/**
 * Build a SpecPayload-shaped object + quantity slice from flat CSV columns.
 * Mirrors fields read by `buildQuickQuoteInputsFromSpec` in the frontend.
 */

import type { SpecQuantitySlice } from '../../../frontend/src/utils/specToQuoteInputs'
import type { QtyType } from '../../../frontend/src/utils/quantityRollFields'
import { productTypeCanHaveGusset } from '../../../frontend/src/utils/specCompat'
import { blendComponentsForCode, type ResinBlendPreset } from './resinBlends'

export type CsvRow = Record<string, string>

function boolCell(v: string | undefined): boolean {
  const s = String(v || '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'y'
}

function numCell(v: string | undefined, fallback = 0): number {
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function strCell(v: string | undefined): string {
  return String(v ?? '').trim()
}

function mapQtyType(s: string | undefined, row: CsvRow): QtyType {
  const x = String(s || '').trim().toLowerCase()
  if (x === 'units' || x === 'bags') return 'units'
  if (x === 'kg' || x === 'total_kg') return 'kg'
  if (x === 'total_rolls' || x === 'rolls') return 'total_rolls'
  if (x === 'rolls_units') return 'rolls_units'
  /** Informal spreadsheet label: rolls × kg/roll → same as `total_rolls` when both are set. */
  if (x === 'rolls_kg') {
    const nr = Math.round(numCell(row.num_rolls, 0))
    const wpr = numCell(row.weight_per_roll_kg, 0)
    if (nr > 0 && wpr > 0) return 'total_rolls'
  }
  return 'kg'
}

function mapPrintMethod(s: string | undefined): string {
  const x = String(s || '').trim()
  if (x === 'Inline' || x === 'Uteco' || x === 'None') return x
  if (x.toLowerCase() === 'inline') return 'Inline'
  if (x.toLowerCase() === 'uteco') return 'Uteco'
  return 'None'
}

/** Default masterbatch / tint loading when CSV omits strength (matches typical LDPE tint, not full compound). */
const DEFAULT_COLOUR_STRENGTH_PCT = 2

/**
 * Parse optional colour column: `GREEN` (defaults to {@link DEFAULT_COLOUR_STRENGTH_PCT}%),
 * or `GREEN:3` for an explicit strength % in the compound.
 */
function colourComponentsFromCell(v: string | undefined): Array<{ colour_code: string; strength_pct: number }> {
  const raw = strCell(v)
  if (!raw) return []
  const parts = raw.split(':')
  const code = parts[0]?.trim()
  if (!code) return []
  const strength =
    parts.length > 1 ? numCell(parts[1], DEFAULT_COLOUR_STRENGTH_PCT) : DEFAULT_COLOUR_STRENGTH_PCT
  return [{ colour_code: code.toUpperCase(), strength_pct: strength }]
}

export type BuildSpecOptions = {
  /** When set, `formulation.blend` is filled from preset `blend_code` matching CSV `resin_blend` (default LD). */
  resinBlends?: ResinBlendPreset[] | null
}

export function buildSpecAndQuantityFromRow(
  row: CsvRow,
  opts?: BuildSpecOptions,
): { spec: any; quantity: SpecQuantitySlice } {
  const productType = strCell(row.product_type) || 'Bag'
  const finishMode = strCell(row.finish_mode) === 'Cartons' ? 'Cartons' : 'Rolls'
  /** CSV length is always interpreted as mm; spec stores `mm` (Tube still uses continuous length in the calculator). */
  const lengthUnits = 'mm'

  const baseWidth = Math.round(numCell(row.base_width_mm, 0))
  const gussetMmRaw = Math.round(numCell(row.gusset_mm, 0))
  const canGusset = productTypeCanHaveGusset(productType)
  const geometry = canGusset && gussetMmRaw > 0 ? 'Gusset' : 'Flat'
  const gussetMm = geometry === 'Gusset' ? gussetMmRaw : null
  const baseLengthMm = Math.round(numCell(row.base_length_mm, 0))
  const thicknessUm = Math.round(numCell(row.thickness_um, 0))

  const printMethod = mapPrintMethod(row.print_method)
  const numColours =
    printMethod === 'None' ? 0 : Math.max(0, Math.round(numCell(row.num_colours, printMethod !== 'None' ? 1 : 0)))

  const colour_components = colourComponentsFromCell(row.colour)

  const spec: any = {
    identity: {
      product_type: productType,
      finish_mode: finishMode,
      trim_pct: row.trim_pct != null && String(row.trim_pct).trim() !== '' ? numCell(row.trim_pct, 0) : null,
      roll_weight_billing: strCell(row.roll_weight_billing) || 'core_off',
      industry_flags: [],
      notes: null,
    },
    dimensions: {
      base_width_mm: baseWidth || null,
      width_tolerance_mm: null,
      base_length_mm: baseLengthMm,
      thickness_um: thicknessUm || null,
      geometry,
      gusset_mm: gussetMm,
      ufilm_left_width_mm: null,
      ufilm_right_width_mm: null,
      length_units: lengthUnits,
    },
    formulation: {
      blend_type: strCell(row.resin_blend) || 'LD',
      blend: blendComponentsForCode(opts?.resinBlends ?? null, strCell(row.resin_blend) || 'LD'),
      colour_components,
      colour: null,
      additives: [],
    },
    printing: {
      method: printMethod,
      num_colours: numColours,
      side: strCell(row.print_side) || 'front',
    },
    packaging: {
      pack_mode: 'Rolls',
      core_type: strCell(row.core_type) || '7mm',
      core_policy: 'Include',
      bags_per_carton: finishMode === 'Cartons' ? Math.round(numCell(row.bags_per_carton, 0)) || null : null,
      pallet_type: 'Std',
      notes: null,
    },
    run_requirements: {
      preferred_extruders: [],
      preferred_printer: null,
      preferred_converter: null,
      run_up: strCell(row.run_up) || 'none',
      slit: 'none',
      treat_inside_outside: 'none',
      inline_perforation: boolCell(row.inline_perforation),
      hole_punched: boolCell(row.hole_punched),
      inline_seal: boolCell(row.inline_seal),
      notes: null,
    },
    quality_expectations: { flags: [], known_issues: null },
    tool_requirements: [],
  }

  const qtyType = mapQtyType(row.qty_type, row)
  const quantity: SpecQuantitySlice = {
    qtyType,
    totalKg: numCell(row.total_kg, 0),
    numUnits: Math.round(numCell(row.num_units, 0)),
    numRolls: Math.round(numCell(row.num_rolls, 0)),
    weightPerRoll: numCell(row.weight_per_roll_kg, 0),
    unitsPerRoll: Math.round(numCell(row.units_per_roll, 0)),
  }

  return { spec, quantity }
}

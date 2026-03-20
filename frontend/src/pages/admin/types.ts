export type Resin = {
  resin_code: string
  name: string
  density: number
  price_per_kg: number
}

export type Additive = {
  additive_code: string
  name: string
  price_per_kg: number
}

export type Colour = {
  colour_code: string
  name: string
  price_per_kg: number
  sort_order: number
  short_code?: string | null
}

export type ResinBlend = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
}

export type Core = {
  core_type: string
  description?: string | null
  cost_per_meter: number
  kg_per_meter: number
}

export type Extruder = {
  extruder_code: string
  model?: string | null
  film_width_min_mm?: number | null
  film_width_max_mm?: number | null
  decision_width_mm?: number | null
  average_kg_hr?: number | null
  ave_width?: number | null
  cost_per_hr?: number | null
}

export type ExtrusionWasteFactor = {
  factor: string
  minutes: number
}

export type PrintingPricingTier = {
  method: 'inline' | 'uteco'
  max_print_width_mm: number
  num_colours: number
  min_meters: number
  min_charge?: number | null
  setup_fee?: number | null
  cost_per_1000m: number
}

export type Ink = {
  ink_code: string
  name: string
  printer_type: string
}

export type Plate = {
  customer_id: string
  plate_code: string
  description?: string | null
}

export type Anilox = {
  anilox_code: string
  description: string
}

export type CustomerSummary = {
  id: string
  code?: string | null
  name: string
}


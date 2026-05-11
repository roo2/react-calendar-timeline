import { runUpNumericalFromSlug } from './runUpNumerical'

function up(v: unknown): string {
  if (v == null) return ''
  let s = String(v).trim()
  // If a TS enum name leaks through (e.g. "ProductType.BAG"), keep the final segment.
  if (s.includes('.')) s = s.split('.').pop() || s
  return s.toUpperCase()
}

function intStr(v: unknown, fallback: string = '-'): string {
  if (v == null) return fallback
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return String(Math.round(n))
}

function intOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

function deriveNumColours(printing: any): number {
  const explicit = intOrNull(printing?.num_colours)
  if (explicit != null && explicit > 0) return explicit

  const inks = new Set<string>()
  for (const key of ['front_ink_plate', 'back_ink_plate'] as const) {
    const rows = printing?.[key]
    if (!Array.isArray(rows)) continue
    for (const r of rows) {
      const code = (r?.ink_code ?? '').toString().trim()
      const txt = (r?.ink_text ?? '').toString().trim()
      if (code) inks.add(code.toUpperCase())
      else if (txt) inks.add(txt.toUpperCase())
    }
  }
  const codes = printing?.ink_codes
  if (Array.isArray(codes)) {
    for (const c of codes) {
      const code = (c ?? '').toString().trim()
      if (code) inks.add(code.toUpperCase())
    }
  }
  return inks.size
}

/** Total number of inks used for printing (front + back plate count). Used for product code xP suffix. */
function totalPrintInks(printing: any): number {
  const front = Array.isArray(printing?.front_ink_plate) ? printing.front_ink_plate : []
  const back = Array.isArray(printing?.back_ink_plate) ? printing.back_ink_plate : []
  const count = (rows: any[]) =>
    rows.filter((r) => (r?.ink_code ?? '').toString().trim() || (r?.ink_text ?? '').toString().trim()).length
  const n = count(front) + count(back)
  if (n > 0) return n
  const explicit = intOrNull(printing?.num_colours)
  if (explicit != null && explicit > 0) return explicit
  return deriveNumColours(printing)
}

export function computeProductDescriptionFromSpec(spec: any): string {
  const identity = spec?.identity || {}
  const dims = spec?.dimensions || {}
  const formulation = spec?.formulation || {}
  const printing = spec?.printing || {}

  // Resin blend (blend_type like "LD" becomes "LDPE"; otherwise try single resin_code).
  const blendType = up(formulation?.blend_type)
  let resin = ''
  if (blendType && blendType !== 'CUSTOM') resin = blendType
  else {
    const blend = formulation?.blend
    if (Array.isArray(blend) && blend.length === 1) resin = up(blend?.[0]?.resin_code)
  }
  if (['LD', 'LLD', 'HD', 'MD'].includes(resin)) resin = `${resin}PE`

  const productType = up(identity?.product_type)

  // Colour: from colour_components; skip WHITE when other colours exist (opacity / filler masterbatch).
  let colour = ''
  const comps = formulation?.colour_components
  if (Array.isArray(comps)) {
    const codes: string[] = []
    for (const row of comps) {
      const cc = (row?.colour_code ?? '').toString().trim()
      if (cc) codes.push(up(cc))
    }
    if (codes.length > 0) {
      const hasWhite = codes.includes('WHITE')
      const hasOther = codes.some((c) => c !== 'WHITE')
      colour = hasWhite && hasOther ? (codes.find((c) => c !== 'WHITE') ?? '') : codes[0]
    }
  }
  if (!colour) colour = up(formulation?.colour?.colour_code)

  const method = up(printing?.method)
  const printed = !!method && method !== 'NONE'
  let printedSeg = ''
  if (printed) {
    const numColours = String(deriveNumColours(printing))
    const side = String(printing?.side || '').trim().toLowerCase()
    const numSides = side === 'both' ? 2 : 1
    const colourWord = numColours === '1' ? 'COLOUR' : 'COLOURS'
    // Single-sided: no "sides" clause. Two-sided: append "on 2 SIDES" only.
    printedSeg =
      numSides === 2
        ? `PRINTED ${numColours} ${colourWord} on 2 SIDES`
        : `PRINTED ${numColours} ${colourWord}`
  }

  const geometry = up(dims?.geometry)
  const gussetMm = intOrNull(dims?.gusset_mm) || 0
  const hasGusset = geometry === 'GUSSET' || gussetMm > 0
  const gussetPrefix = hasGusset ? 'G' : 'LF'
  const canShowGussetPrefix = productType === 'BAG' || productType === 'TUBE'
  const isSheet = productType === 'SHEET' || geometry === 'SHEET'
  const lfOrG = isSheet ? 'SWS' : canShowGussetPrefix ? gussetPrefix : ''

  const width = intStr(dims?.base_width_mm)
  const widthSeg = hasGusset && gussetMm > 0 ? `(${width}mm + ${gussetMm}mm)` : `${width}mm`
  const gauge = intStr(dims?.thickness_um)
  const baseLenMm = dims?.base_length_mm
  const includeLen = baseLenMm != null
  const lengthSeg = includeLen ? `${intStr(baseLenMm)}mm` : ''

  // Gauge should be the last of the dimensions: W... X L... X <gauge>µm
  const dimsSeg = includeLen ? `W${widthSeg} X L${lengthSeg} X ${gauge}µm` : `W${widthSeg} X ${gauge}µm`

  // Order: product type -> dimensions -> colour -> printing attributes.
  const typeSeg = [productType, resin, lfOrG].filter(Boolean).join(' ').trim() || 'UNKNOWN PRODUCT'
  const parts = [`${typeSeg}.`, `${dimsSeg}.`]
  if (colour) parts.push(`${colour}.`)
  if (printedSeg) parts.push(`${printedSeg}.`)
  return parts.join(' ')
}

/** Product type to 2-letter prefix for product code */
const PRODUCT_TYPE_PREFIX: Record<string, string> = {
  BAG: 'PB',
  TUBE: 'PT',
  SLEEVE: 'SV',
  SHEET: 'ST',
  CENTERFOLD: 'CF',
  'U-FILM': 'UF',
  UFILM: 'UF',
}

/**
 * Product code for UI and persistence: optional manual `identity.customer_code`, else generated.
 * Use {@link computeProductCodeFromSpec} when you need the algorithmic code only (e.g. placeholder).
 */
export function getDisplayProductCodeFromSpec(spec: any): string {
  const manual = String(spec?.identity?.customer_code ?? '').trim()
  if (manual) return manual
  return computeProductCodeFromSpec(spec)
}

/**
 * Compute product code from spec only (e.g. PBR-(200+50)-600-50-BLK-2P).
 * Does not include a customer prefix; format: {Type}{R|C}-{Width}-{LengthMm}-{GaugeUm}-{Colour3}-{Print?}
 */
export function computeProductCodeFromSpec(spec: any): string {
  const identity = spec?.identity || {}
  const dims = spec?.dimensions || {}
  const formulation = spec?.formulation || {}
  const printing = spec?.printing || {}

  const productType = up(identity?.product_type)
  const typePrefix = PRODUCT_TYPE_PREFIX[productType] || 'XX'
  const finishMode = up(identity?.finish_mode)
  const finishChar = finishMode === 'CARTONS' ? 'C' : 'R'

  const geometry = up(dims?.geometry)
  const baseWidth = intOrNull(dims?.base_width_mm)
  const gussetMm = intOrNull(dims?.gusset_mm) || 0
  const hasGusset = geometry === 'GUSSET' || gussetMm > 0
  const isCenterfold = productType === 'CENTERFOLD' || geometry === 'CENTREFOLD'
  const isUFilm = productType === 'U-FILM' || productType === 'UFILM'
  const isSheet = productType === 'SHEET' || geometry === 'SHEET'

  let widthSeg = intStr(dims?.base_width_mm, '')
  if (widthSeg) {
    if (hasGusset && gussetMm > 0) {
      widthSeg = `(${intStr(dims?.base_width_mm)}+${gussetMm})`
    } else if (isCenterfold && baseWidth != null) {
      const layflat = Math.round(baseWidth / 2)
      widthSeg = `${layflat}(${baseWidth})`
    } else if (isSheet && baseWidth != null) {
      const run = spec?.run_requirements || {}
      const ru = runUpNumericalFromSlug(String(run?.run_up ?? 'none'), String(identity?.product_type ?? 'Sheet'))
      const layflat = ru > 0 ? Math.round(baseWidth * (ru / 2)) : baseWidth
      widthSeg = `${layflat}(${baseWidth})`
    } else if (isUFilm) {
      const l = intOrNull(dims?.ufilm_left_width_mm) ?? 0
      const r = intOrNull(dims?.ufilm_right_width_mm) ?? 0
      const w = baseWidth ?? 0
      widthSeg = `${l}/${w}/${r}`
    }
  }

  const lengthMm = intStr(dims?.base_length_mm, '')
  const gaugeUm = intStr(dims?.thickness_um, '')

  let colourCode = ''
  const comps = formulation?.colour_components
  if (Array.isArray(comps)) {
    for (const row of comps) {
      const cc = (row?.colour_code ?? '').toString().trim()
      if (cc) {
        colourCode = up(cc).slice(0, 3)
        break
      }
    }
  }
  if (!colourCode && formulation?.colour?.colour_code) {
    colourCode = up(formulation.colour.colour_code).slice(0, 3)
  }

  let printSeg = ''
  const method = up(printing?.method)
  if (method && method !== 'NONE') {
    const n = totalPrintInks(printing)
    if (n > 0) printSeg = `${n}P`
  }

  const parts = [`${typePrefix}${finishChar}`]
  if (widthSeg) parts.push(widthSeg)
  if (lengthMm) parts.push(lengthMm)
  if (gaugeUm) parts.push(gaugeUm)
  if (colourCode) parts.push(colourCode)
  if (printSeg) parts.push(printSeg)

  return parts.filter(Boolean).join('-')
}

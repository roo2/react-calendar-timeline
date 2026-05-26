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
  const ufL = intOrNull(dims?.ufilm_left_width_mm) ?? 0
  const ufR = intOrNull(dims?.ufilm_right_width_mm) ?? 0
  const midW = intOrNull(dims?.base_width_mm) ?? 0
  let widthSeg: string
  if (hasGusset && gussetMm > 0) {
    widthSeg = `(${width}mm + ${gussetMm}mm)`
  } else if (productType === 'J-FILM' && ufL > 0 && ufR > 0) {
    widthSeg = `${ufL}/${ufR}mm`
  } else if (productType === 'U-FILM' && ufL > 0 && midW > 0 && ufR > 0) {
    widthSeg = `${ufL}/${midW}/${ufR}mm`
  } else {
    widthSeg = `${width}mm`
  }
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
export const PRODUCT_TYPE_PREFIX: Record<string, string> = {
  BAG: 'PB',
  TUBE: 'PT',
  SLEEVE: 'SV',
  SHEET: 'ST',
  CENTERFOLD: 'CF',
  'U-FILM': 'UF',
  UFILM: 'UF',
  'J-FILM': 'JF',
  JFILM: 'JF',
}

/** Finish mode suffix for product code / print short codes: Rolls → R, Cartons → C. */
export function finishModeChar(finishMode: unknown): 'R' | 'C' {
  return up(finishMode) === 'CARTONS' ? 'C' : 'R'
}

export function productTypePrefix(productType: unknown): string {
  return PRODUCT_TYPE_PREFIX[up(productType)] || 'XX'
}

/** e.g. Bag + Rolls → `PBR`; Centerfold + Cartons → `CFC`. */
export function productTypeFinishShortcode(productType: unknown, finishMode: unknown): string {
  return `${productTypePrefix(productType)}${finishModeChar(finishMode)}`
}

export function productTypeFinishShortcodeFromSpec(spec: unknown): string {
  const identity = (spec as { identity?: Record<string, unknown> })?.identity || {}
  return productTypeFinishShortcode(identity.product_type, identity.finish_mode)
}

/** Human-readable product type (e.g. `bag` → `Bag`, `centerfold` → `Centrefold`). */
export function displayProductTypeLabel(productType: unknown): string {
  const v = String(productType ?? '').trim()
  if (!v) return ''
  const norm = v.toLowerCase()
  if (norm === 'centerfold' || norm === 'centrefold') return 'Centrefold'
  if (norm === 'u-film' || norm === 'u_film' || norm === 'ufilm') return 'U-Film'
  if (norm === 'j-film' || norm === 'j_film' || norm === 'jfilm') return 'J-Film'
  return v
}

function hasGussetForProductFinishLabel(geometryRaw: unknown, gussetMm: number | null): boolean {
  const g = String(geometryRaw ?? '')
    .trim()
    .toLowerCase()
  if (g === 'gusset' || g === 'bottomgusset' || g === 'bottom_gusset') return true
  return gussetMm != null && gussetMm > 0 && Number.isFinite(gussetMm)
}

/**
 * Long-form product + finish for print (e.g. `Bag in Carton`, `Gusseted Bag on Roll`).
 * Shortcode equivalent: {@link productTypeFinishShortcode} → `PBC`.
 */
export function productTypeFinishLabel(
  productType: unknown,
  finishMode: unknown,
  opts?: { geometry?: unknown; gussetMm?: number | null },
): string {
  const typeLabel = displayProductTypeLabel(productType)
  if (!typeLabel) return ''
  const finishSuffix = up(finishMode) === 'CARTONS' ? 'in Carton' : 'on Roll'
  const prefix =
    opts && hasGussetForProductFinishLabel(opts.geometry, opts.gussetMm ?? null) ? 'Gusseted ' : ''
  return `${prefix}${typeLabel} ${finishSuffix}`
}

/** {@link productTypeFinishLabel} from a spec payload (`identity` + `dimensions`). */
export function productTypeFinishLabelFromSpec(spec: unknown): string {
  const identity = (spec as { identity?: Record<string, unknown> })?.identity || {}
  const dims = (spec as { dimensions?: Record<string, unknown> })?.dimensions || {}
  const gussetRaw = dims.gusset_mm
  const gussetMm =
    gussetRaw != null && String(gussetRaw).trim() !== '' && Number.isFinite(Number(gussetRaw))
      ? Number(gussetRaw)
      : null
  return productTypeFinishLabel(identity.product_type, identity.finish_mode, {
    geometry: dims.geometry,
    gussetMm,
  })
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

const ADDITIVE_CODE_LEGACY_TO_SHORT: Record<string, string> = {
  ANTI_BLOCK: 'AB',
  ANTI_STATIC: 'AS',
  SLIP: 'SP',
  UV: 'UV',
}

function normalizeAdditiveCodeForProductCode(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!code) return ''
  return ADDITIVE_CODE_LEGACY_TO_SHORT[code] ?? code
}

/** Up to two additive codes, dot-separated (e.g. ``AB.AS``). */
function productCodeAdditiveSegment(formulation: any): string {
  const additives = formulation?.additives
  if (!Array.isArray(additives)) return ''
  const codes: string[] = []
  for (const row of additives) {
    const short = normalizeAdditiveCodeForProductCode(row?.additive_code)
    if (short && !codes.includes(short)) codes.push(short)
    if (codes.length >= 2) break
  }
  return codes.length > 0 ? codes.join('.') : ''
}

/**
 * Compute product code from spec only (e.g. `PBR_(200+50)x600x50_BLK_AB.AS_2P`, `PTR_1000x500x50_GRE`).
 * Does not include a customer prefix; format: {Type}{R|C}_{Width}x{LengthMm}x{GaugeUm}_{Colour3}_{Additives?}_{Print?}
 */
export function computeProductCodeFromSpec(spec: any): string {
  const identity = spec?.identity || {}
  const dims = spec?.dimensions || {}
  const formulation = spec?.formulation || {}
  const printing = spec?.printing || {}

  const productType = up(identity?.product_type)
  const typePrefix = productTypePrefix(productType)
  const finishChar = finishModeChar(identity?.finish_mode)

  const geometry = up(dims?.geometry)
  const baseWidth = intOrNull(dims?.base_width_mm)
  const gussetMm = intOrNull(dims?.gusset_mm) || 0
  const hasGusset = geometry === 'GUSSET' || gussetMm > 0
  const isCenterfold = productType === 'CENTERFOLD' || geometry === 'CENTREFOLD'
  const isUFilm = productType === 'U-FILM' || productType === 'UFILM'
  const isJFilm = productType === 'J-FILM' || productType === 'JFILM'
  const isSheet = productType === 'SHEET' || geometry === 'SHEET'

  const jL = intOrNull(dims?.ufilm_left_width_mm) ?? 0
  const jR = intOrNull(dims?.ufilm_right_width_mm) ?? 0
  let widthSeg = intStr(dims?.base_width_mm, '')
  if (widthSeg || (isJFilm && jL > 0 && jR > 0)) {
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
    } else if (isJFilm && jL > 0 && jR > 0) {
      widthSeg = `${jL}/${jR}`
    } else if (isUFilm) {
      const w = baseWidth ?? 0
      widthSeg = `${jL}/${w}/${jR}`
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

  const dimParts = [widthSeg, lengthMm, gaugeUm].filter((s) => String(s ?? '').trim() !== '')
  const codeParts = [`${typePrefix}${finishChar}`]
  if (dimParts.length > 0) codeParts.push(dimParts.join('x'))
  if (colourCode) codeParts.push(colourCode)
  const additiveSeg = productCodeAdditiveSegment(formulation)
  if (additiveSeg) codeParts.push(additiveSeg)
  if (printSeg) codeParts.push(printSeg)

  return codeParts.filter(Boolean).join('_')
}

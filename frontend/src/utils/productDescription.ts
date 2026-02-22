function up(v: unknown): string {
  return (v == null ? '' : String(v)).trim().toUpperCase()
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
      if (code) inks.add(code.toUpperCase())
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

  // Colour: first non-empty colour_code from colour_components, else legacy colour.colour_code.
  let colour = ''
  const comps = formulation?.colour_components
  if (Array.isArray(comps)) {
    for (const row of comps) {
      const cc = (row?.colour_code ?? '').toString().trim()
      if (cc) {
        colour = up(cc)
        break
      }
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
    const sideWord = numSides === 1 ? 'SIDE' : 'SIDES'
    printedSeg = `PRINTED ${numColours} ${colourWord} X ${numSides} ${sideWord}`
  }

  const geometry = up(dims?.geometry)
  const gussetMm = intOrNull(dims?.gusset_mm) || 0
  const hasGusset = geometry === 'GUSSET' || gussetMm > 0
  const gussetPrefix = hasGusset ? 'G' : 'LF'
  const canShowGussetPrefix = productType === 'BAG' || productType === 'TUBE'
  const lfOrG = canShowGussetPrefix ? gussetPrefix : ''

  const width = intStr(dims?.base_width_mm)
  const widthSeg = hasGusset && gussetMm > 0 ? `(${width}mm + ${gussetMm}mm)` : `${width}mm`
  const gauge = intStr(dims?.thickness_um)
  const baseLenMm = dims?.base_length_mm
  const includeLen = baseLenMm != null
  const lengthSeg = includeLen ? `${intStr(baseLenMm)}mm` : ''

  const name = [resin, lfOrG, productType, colour].filter(Boolean).join(' ').trim() || 'UNKNOWN PRODUCT'
  const dimsSeg = `W${widthSeg} X ${gauge}µm${includeLen ? ` X L${lengthSeg}` : ''}`
  const parts = [`${name}.`]
  if (printedSeg) parts.push(`${printedSeg}.`)
  parts.push(`${dimsSeg}.`)
  return parts.join(' ')
}


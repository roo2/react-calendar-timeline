/** Supported vent hole diameters (mm). */
export const VENT_HOLE_SIZE_MM_OPTIONS = [6, 8, 10] as const
export type VentHoleSizeMm = (typeof VENT_HOLE_SIZE_MM_OPTIONS)[number]

export function normalizeVentHoleSizeMm(raw: unknown): VentHoleSizeMm {
  const n = Number(raw)
  if (n === 8) return 8
  if (n === 10) return 10
  return 6
}

export function ventHolesAcrossFromConv(conv: Record<string, unknown>): number {
  const across = conv.vent_holes_across ?? conv.vent_holes_per_row
  const n = Number(across)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function ventHolesAlongFromConv(conv: Record<string, unknown>): number {
  const along = conv.vent_holes_along ?? conv.vent_rows
  const n = Number(along)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function ventPositionDescriptionFromConv(conv: Record<string, unknown>): string {
  const raw = conv.vent_hole_position_description ?? conv.vent_description
  return raw != null ? String(raw).trim() : ''
}

export function ventTotalHoles(conv: Record<string, unknown>): number {
  const a = ventHolesAcrossFromConv(conv)
  const b = ventHolesAlongFromConv(conv)
  return a > 0 && b > 0 ? a * b : 0
}

export function formatVentSummaryLine(conv: Record<string, unknown>): string {
  const across = ventHolesAcrossFromConv(conv)
  const along = ventHolesAlongFromConv(conv)
  if (!(across > 0 && along > 0)) return ''
  const size = normalizeVentHoleSizeMm(conv.vent_hole_size_mm)
  return `${size}mm holes, ${across} across X ${along} rows`
}

export function formatVentPrintLines(conv: Record<string, unknown>): {
  summary: string
  position: string
  holeSizeMm: VentHoleSizeMm
  highlightHoleSize: boolean
} {
  const holeSizeMm = normalizeVentHoleSizeMm(conv.vent_hole_size_mm)
  return {
    summary: formatVentSummaryLine(conv),
    position: ventPositionDescriptionFromConv(conv),
    holeSizeMm,
    highlightHoleSize: holeSizeMm !== 6,
  }
}

export function ventHasAnyData(conv: Record<string, unknown>): boolean {
  const { summary, position } = formatVentPrintLines(conv)
  return summary !== '' || position !== ''
}

/** Conversion UI / print: vent is on when explicitly enabled, or when legacy specs have vent data. */
export function ventEnabledFromConv(conv: Record<string, unknown>): boolean {
  if (conv.vent_enabled === true) return true
  if (conv.vent_enabled === false) return false
  return ventHasAnyData(conv)
}

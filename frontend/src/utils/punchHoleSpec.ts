/** Supported hole diameters (mm) for inline / conversion punching. */
export const PUNCH_HOLE_SIZE_MM_OPTIONS = [6, 8, 10] as const
export type PunchHoleSizeMm = (typeof PUNCH_HOLE_SIZE_MM_OPTIONS)[number]

/** @deprecated use PUNCH_HOLE_SIZE_MM_OPTIONS */
export const VENT_HOLE_SIZE_MM_OPTIONS = PUNCH_HOLE_SIZE_MM_OPTIONS

export function normalizePunchHoleSizeMm(raw: unknown): PunchHoleSizeMm {
  const n = Number(raw)
  if (n === 8) return 8
  if (n === 10) return 10
  return 6
}

/** @deprecated use normalizePunchHoleSizeMm */
export const normalizeVentHoleSizeMm = normalizePunchHoleSizeMm

type PunchFieldSet = {
  enabledKey: string
  sizeKey: string
  acrossKey: string
  alongKey: string
  positionKey: string
  /** Legacy vent_* keys (conversion only). */
  legacyAcrossKey?: string
  legacyAlongKey?: string
  legacyPositionKey?: string
}

export const INLINE_PUNCH_FIELDS: PunchFieldSet = {
  enabledKey: 'hole_punched',
  sizeKey: 'inline_punch_hole_size_mm',
  acrossKey: 'inline_punch_holes_across',
  alongKey: 'inline_punch_holes_along',
  positionKey: 'inline_punch_hole_position_description',
}

export const CONVERSION_PUNCH_FIELDS: PunchFieldSet = {
  enabledKey: 'punched_conversion_enabled',
  sizeKey: 'punched_conversion_hole_size_mm',
  acrossKey: 'punched_conversion_holes_across',
  alongKey: 'punched_conversion_holes_along',
  positionKey: 'punched_conversion_hole_position_description',
  legacyAcrossKey: 'vent_holes_across',
  legacyAlongKey: 'vent_holes_along',
  legacyPositionKey: 'vent_hole_position_description',
}

function holesAcrossFrom(obj: Record<string, unknown>, fields: PunchFieldSet): number {
  const across =
    obj[fields.acrossKey] ??
    (fields.legacyAcrossKey ? obj[fields.legacyAcrossKey] : undefined) ??
    (fields.legacyAcrossKey ? obj.vent_holes_per_row : undefined)
  const n = Number(across)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function holesAlongFrom(obj: Record<string, unknown>, fields: PunchFieldSet): number {
  const along =
    obj[fields.alongKey] ??
    (fields.legacyAlongKey ? obj[fields.legacyAlongKey] : undefined) ??
    (fields.legacyAlongKey ? obj.vent_rows : undefined)
  const n = Number(along)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function positionFrom(obj: Record<string, unknown>, fields: PunchFieldSet): string {
  const raw =
    obj[fields.positionKey] ??
    (fields.legacyPositionKey ? obj[fields.legacyPositionKey] : undefined) ??
    (fields.legacyPositionKey ? obj.vent_description : undefined)
  return raw != null ? String(raw) : ''
}

function holeSizeFrom(obj: Record<string, unknown>, fields: PunchFieldSet): PunchHoleSizeMm {
  const raw =
    obj[fields.sizeKey] ??
    (fields.legacyAcrossKey ? obj.vent_hole_size_mm : undefined)
  return normalizePunchHoleSizeMm(raw)
}

export function punchTotalHoles(obj: Record<string, unknown>, fields: PunchFieldSet): number {
  const a = holesAcrossFrom(obj, fields)
  const b = holesAlongFrom(obj, fields)
  return a > 0 && b > 0 ? a * b : 0
}

export function punchHasAnyDetailData(obj: Record<string, unknown>, fields: PunchFieldSet): boolean {
  if (holesAcrossFrom(obj, fields) > 0 || holesAlongFrom(obj, fields) > 0) return true
  return positionFrom(obj, fields).trim() !== ''
}

export function formatPunchSummaryLine(obj: Record<string, unknown>, fields: PunchFieldSet): string {
  const across = holesAcrossFrom(obj, fields)
  const along = holesAlongFrom(obj, fields)
  if (!(across > 0 && along > 0)) return ''
  const size = holeSizeFrom(obj, fields)
  return `${size}mm holes, ${across} across X ${along} rows`
}

export function formatPunchPrintLines(
  obj: Record<string, unknown>,
  fields: PunchFieldSet,
): {
  summary: string
  position: string
  holeSizeMm: PunchHoleSizeMm
  highlightHoleSize: boolean
} {
  const holeSizeMm = holeSizeFrom(obj, fields)
  return {
    summary: formatPunchSummaryLine(obj, fields),
    position: positionFrom(obj, fields).trim(),
    holeSizeMm,
    highlightHoleSize: holeSizeMm !== 6,
  }
}

export function inlinePunchEnabled(run: Record<string, unknown>): boolean {
  if (run.hole_punched === true) return true
  if (run.hole_punched === false) return false
  return punchHasAnyDetailData(run, INLINE_PUNCH_FIELDS)
}

export function punchedConversionEnabledFromConv(conv: Record<string, unknown>): boolean {
  if (conv.punched_conversion_enabled === true) return true
  if (conv.punched_conversion_enabled === false) return false
  // Legacy: vent_* with hole detail was conversion punching.
  if (conv.vent_enabled === true) return true
  if (conv.vent_enabled === false) return false
  return punchHasAnyDetailData(conv, CONVERSION_PUNCH_FIELDS)
}

export function ventedEnabledFromConv(conv: Record<string, unknown>): boolean {
  if (conv.vented_enabled === true) return true
  if (conv.vented_enabled === false) return false
  // Legacy: vent_enabled with no hole layout → pinprick vent only.
  if (conv.vent_enabled === true && !punchHasAnyDetailData(conv, CONVERSION_PUNCH_FIELDS)) return true
  return false
}

export function productSummaryPunchedChecked(
  run: Record<string, unknown>,
  _finishMode: 'Rolls' | 'Cartons',
): boolean {
  return inlinePunchEnabled(run) || punchedConversionEnabledFromConv((run.conversion as Record<string, unknown>) || {})
}

/** @deprecated use punchedConversionEnabledFromConv */
export function ventEnabledFromConv(conv: Record<string, unknown>): boolean {
  return punchedConversionEnabledFromConv(conv)
}

/** @deprecated */
export function ventHolesAcrossFromConv(conv: Record<string, unknown>): number {
  return holesAcrossFrom(conv, CONVERSION_PUNCH_FIELDS)
}

/** @deprecated */
export function ventHolesAlongFromConv(conv: Record<string, unknown>): number {
  return holesAlongFrom(conv, CONVERSION_PUNCH_FIELDS)
}

/** @deprecated */
export function ventTotalHoles(conv: Record<string, unknown>): number {
  return punchTotalHoles(conv, CONVERSION_PUNCH_FIELDS)
}

/** @deprecated */
export function formatVentPrintLines(conv: Record<string, unknown>) {
  return formatPunchPrintLines(conv, CONVERSION_PUNCH_FIELDS)
}

/** @deprecated */
export function ventHasAnyData(conv: Record<string, unknown>): boolean {
  return punchHasAnyDetailData(conv, CONVERSION_PUNCH_FIELDS)
}

export function inlinePunchHolesAcross(run: Record<string, unknown>): number {
  return holesAcrossFrom(run, INLINE_PUNCH_FIELDS)
}

export function inlinePunchHolesAlong(run: Record<string, unknown>): number {
  return holesAlongFrom(run, INLINE_PUNCH_FIELDS)
}

export function punchedConversionHolesAcross(conv: Record<string, unknown>): number {
  return holesAcrossFrom(conv, CONVERSION_PUNCH_FIELDS)
}

export function punchedConversionHolesAlong(conv: Record<string, unknown>): number {
  return holesAlongFrom(conv, CONVERSION_PUNCH_FIELDS)
}

export function inlinePunchTotalHoles(run: Record<string, unknown>): number {
  return punchTotalHoles(run, INLINE_PUNCH_FIELDS)
}

export function punchedConversionTotalHoles(conv: Record<string, unknown>): number {
  return punchTotalHoles(conv, CONVERSION_PUNCH_FIELDS)
}

export function inlinePunchPosition(run: Record<string, unknown>): string {
  return positionFrom(run, INLINE_PUNCH_FIELDS)
}

export function punchedConversionPosition(conv: Record<string, unknown>): string {
  return positionFrom(conv, CONVERSION_PUNCH_FIELDS)
}

export function inlinePunchHoleSizeMm(run: Record<string, unknown>): PunchHoleSizeMm {
  return holeSizeFrom(run, INLINE_PUNCH_FIELDS)
}

export function punchedConversionHoleSizeMm(conv: Record<string, unknown>): PunchHoleSizeMm {
  return holeSizeFrom(conv, CONVERSION_PUNCH_FIELDS)
}

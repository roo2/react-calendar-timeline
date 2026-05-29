export type PrintRegistration = 'random' | 'registered'

export const PRINT_REGISTRATION_DEFAULT: PrintRegistration = 'random'

export function normalizePrintRegistration(raw: unknown): PrintRegistration {
  const x = String(raw ?? '').trim().toLowerCase()
  if (x === 'registered') return 'registered'
  return PRINT_REGISTRATION_DEFAULT
}

export function isRegisteredPrint(raw: unknown): boolean {
  return normalizePrintRegistration(raw) === 'registered'
}

export function printRegistrationLabel(reg: PrintRegistration): string {
  return reg === 'registered' ? 'Registered' : 'Random'
}

/** Bottom/end seal slug used on carton conversion. */
export function isBottomSealType(sealType: unknown): boolean {
  const x = String(sealType ?? 'end').trim().toLowerCase()
  return x === '' || x === 'end'
}

/** Carton conversion: show print position details (not the Random/Registered control). */
export function showConversionPrintPositionDetailsField(opts: {
  finishMode: string
  sealType: unknown
  printingEnabled: boolean
}): boolean {
  return (
    String(opts.finishMode) === 'Cartons' &&
    opts.printingEnabled &&
    isBottomSealType(opts.sealType)
  )
}

/** Printed job sheet: e.g. "Registered, 50 mm from bottom seal". */
export function formatPrintPositionForPrint(registration: unknown, positionNotes: unknown): string {
  const reg = printRegistrationLabel(normalizePrintRegistration(registration))
  const notes = String(positionNotes ?? '').trim()
  if (notes) return `${reg}, ${notes}`
  return reg
}

export function inlineMountedSealPrintPositionLabel(opts: {
  finishMode: unknown
  sealType: unknown
  inlineSeal?: unknown
}): string {
  const finish = String(opts.finishMode ?? '').trim().toLowerCase()
  const seal = String(opts.sealType ?? 'end').trim().toLowerCase()
  if (finish === 'rolls' && (opts.inlineSeal === true || seal === 'inline_seal')) return 'Mounted Bag on Roll'
  if (finish !== 'cartons') return ''
  if (seal === 'side') return 'Mounted Side Seal'
  if (seal === '' || seal === 'end') return 'Mounted Bottom Seal'
  return ''
}

export type PrintPositionHighlight = 'none' | 'yellow' | 'pink'

/** Random + no details → none; random + details → yellow; registered → pink. */
export function printPositionHighlight(
  registration: unknown,
  positionNotes: unknown,
): PrintPositionHighlight {
  if (isRegisteredPrint(registration)) return 'pink'
  if (String(positionNotes ?? '').trim() !== '') return 'yellow'
  return 'none'
}

export function printPositionHighlightClass(kind: PrintPositionHighlight): string | undefined {
  if (kind === 'pink') return 'js-pink'
  if (kind === 'yellow') return 'js-yellow'
  return undefined
}

/** MUI surfaces (job sheet printing summary preview). */
export function printPositionHighlightSx(kind: PrintPositionHighlight): { bgcolor?: string } {
  if (kind === 'pink') return { bgcolor: '#ffc8d8' }
  if (kind === 'yellow') return { bgcolor: '#fff566' }
  return {}
}

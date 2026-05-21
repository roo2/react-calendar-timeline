/** How bags are packed in cartons (conversion section). */
export type ConversionPackingMode = 'loose_lay_flat' | 'loose_folded' | 'in_pack'

export const CONVERSION_PACKING_MODE_LABELS: Record<ConversionPackingMode, string> = {
  loose_lay_flat: 'Loose (Lay flat)',
  loose_folded: 'Loose (Folded)',
  in_pack: 'In Packs',
}

export function isPositiveIntField(v: unknown): boolean {
  return v != null && v !== '' && Number(v) > 0
}

/** Resolve mode from explicit `packing_mode` or legacy boolean/number fields. */
export function deriveConversionPackingMode(conv: Record<string, unknown>): ConversionPackingMode | '' {
  const raw = String(conv.packing_mode ?? '').trim()
  if (raw === 'loose_lay_flat' || raw === 'loose_folded' || raw === 'in_pack') {
    return raw
  }
  if (isPositiveIntField(conv.pack_size)) return 'in_pack'
  if (isPositiveIntField(conv.qty_per_fold)) return 'loose_folded'
  return ''
}

/** Legacy flags kept in sync for print / older readers. */
export function conversionFieldsForPackingMode(
  mode: ConversionPackingMode | '',
  prev: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { ...prev, packing_mode: mode || null }
  if (mode === 'loose_lay_flat') {
    return {
      ...base,
      pack_lay_flat: true,
      loose: true,
      pack_size: null,
      qty_per_fold: null,
      tag_packs: false,
    }
  }
  if (mode === 'loose_folded') {
    return {
      ...base,
      pack_lay_flat: false,
      loose: true,
      pack_size: null,
      tag_packs: false,
    }
  }
  if (mode === 'in_pack') {
    return {
      ...base,
      pack_lay_flat: false,
      loose: false,
      qty_per_fold: null,
    }
  }
  return {
    ...base,
    pack_lay_flat: false,
    loose: false,
    pack_size: null,
    qty_per_fold: null,
    tag_packs: false,
  }
}

export function conversionPackingModeLabel(mode: ConversionPackingMode | ''): string {
  if (!mode) return ''
  return CONVERSION_PACKING_MODE_LABELS[mode]
}

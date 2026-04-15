/**
 * Shape of GET /api/rate-cards/resin-blends (same as Quotes page presets).
 */

export type ResinBlendComponent = { resin_code?: string; pct?: number }

export type ResinBlendPreset = {
  blend_code?: string
  name?: string
  components?: ResinBlendComponent[]
}

export function parseResinBlendsJson(raw: string): ResinBlendPreset[] {
  const data = JSON.parse(raw) as unknown
  if (!Array.isArray(data)) return []
  return data as ResinBlendPreset[]
}

/** Match UI: filter empty codes and non-positive pct. */
export function blendComponentsForCode(
  presets: ResinBlendPreset[] | null | undefined,
  blendCode: string,
): Array<{ resin_code: string; pct: number }> {
  if (!presets?.length) return []
  const key = String(blendCode ?? '').trim().toUpperCase()
  if (!key) return []
  const preset = presets.find((b) => String(b?.blend_code ?? '').trim().toUpperCase() === key)
  const comps = preset?.components
  if (!Array.isArray(comps)) return []
  return comps
    .map((c) => ({
      resin_code: String(c?.resin_code ?? '').trim(),
      pct: Number(c?.pct) || 0,
    }))
    .filter((c) => c.resin_code && Number(c.pct) > 0)
}

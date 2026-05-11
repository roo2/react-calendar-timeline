/**
 * Strip placeholder / zero-strength rows from formulation arrays before persisting a spec.
 * Prevents empty colour / additive / resin rows (e.g. 0% with no code) from being saved.
 */
export function sanitizeSpecFormulationMixes<T extends Record<string, unknown>>(spec: T): T {
  const formulation = spec.formulation
  if (!formulation || typeof formulation !== 'object') return spec
  const f = { ...(formulation as Record<string, unknown>) }

  if (Array.isArray(f.blend)) {
    f.blend = (f.blend as unknown[]).filter((row) => {
      if (!row || typeof row !== 'object') return false
      const r = row as Record<string, unknown>
      const code = String(r.resin_code ?? r.code ?? '')
        .trim()
      const raw = r.pct
      const pct = raw == null || String(raw).trim() === '' ? NaN : Number(raw)
      if (!code) return false
      if (!Number.isFinite(pct)) return true
      return pct > 0
    })
  }

  if (Array.isArray(f.colour_components)) {
    f.colour_components = (f.colour_components as unknown[]).filter((row) => {
      if (!row || typeof row !== 'object') return false
      const r = row as Record<string, unknown>
      const code = String(r.colour_code ?? '')
        .trim()
      const raw = r.strength_pct
      const pct = raw == null || String(raw).trim() === '' ? NaN : Number(raw)
      if (!code) return Number.isFinite(pct) && pct !== 0
      return Number.isFinite(pct) && pct > 0
    })
  }

  if (Array.isArray(f.additives)) {
    f.additives = (f.additives as unknown[]).filter((row) => {
      if (!row || typeof row !== 'object') return false
      const r = row as Record<string, unknown>
      const code = String(r.additive_code ?? '')
        .trim()
      const raw = r.pct
      const pct = raw == null || String(raw).trim() === '' ? NaN : Number(raw)
      if (!code) return Number.isFinite(pct) && pct !== 0
      return Number.isFinite(pct) && pct > 0
    })
  }

  return { ...spec, formulation: f } as T
}

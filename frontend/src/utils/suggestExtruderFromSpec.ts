/**
 * Smallest ratebook extruder that fits the layflat / decision width implied by a product spec.
 * Aligns with the Quotes page extruder auto-selection (first fit by decision width, else largest).
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import { computeLayflatWidthMm, type QuoteRatebook } from './quoteCalculator'
import { productTypeCanHaveGusset } from './specCompat'
import { isLeftRightWidthFilmProductType, isUFilmProductType } from './filmProductTypes'

function runUpSlugToNumber(runUp: string | undefined): number {
  if (!runUp || runUp === 'none') return 1
  if (runUp === '2up') return 2
  if (runUp === '4up') return 4
  if (runUp === '6up') return 6
  return 1
}

export type ExtruderWidthSuggestion = {
  /** `extruder_code` of the best-fit row, or the largest available if nothing fits. */
  extruderCode: string | null
  /** Optional one-line note (e.g. no extruder wide enough). */
  hintLine: string
}

export function suggestSmallestFittingExtruderCode(
  spec: SpecPayload,
  ratebook: QuoteRatebook | null | undefined,
): ExtruderWidthSuggestion {
  const extruders = Array.isArray(ratebook?.extruders) ? ratebook.extruders : []
  if (!extruders.length || !spec?.dimensions) {
    return { extruderCode: null, hintLine: '' }
  }
  const pt = String(spec.identity?.product_type || 'Bag')
  const isLRFilm = isLeftRightWidthFilmProductType(pt)
  const isUFilm = isUFilmProductType(pt)
  const widthMmNum = Math.round(Number(spec.dimensions?.base_width_mm || 0))
  const ufilmL = Math.round(Number(spec.dimensions?.ufilm_left_width_mm || 0) || 0)
  const ufilmR = Math.round(Number(spec.dimensions?.ufilm_right_width_mm || 0) || 0)
  if (!(widthMmNum > 0) && !(isLRFilm && ufilmL > 0 && ufilmR > 0)) {
    return { extruderCode: null, hintLine: '' }
  }
  const rawGeom = String(spec.dimensions?.geometry || '')
  const canHaveGusset = productTypeCanHaveGusset(pt)
  const flagGusset = rawGeom === 'Gusset' && canHaveGusset
  const derivedGeometry: 'Flat' | 'Gusset' = flagGusset ? 'Gusset' : 'Flat'
  const run = spec.run_requirements || {}
  const showRunUp = !isLRFilm && (pt === 'Sheet' || pt === 'Centerfold')
  const runUpN = showRunUp ? runUpSlugToNumber(String(run.run_up || 'none')) : 1
  const gussetMmRounded =
    derivedGeometry === 'Gusset' ? Math.round(Number(spec.dimensions?.gusset_mm || 0) || 0) || null : null
  const extruderDecisionWidthMm = isUFilm
    ? widthMmNum
    : computeLayflatWidthMm({
        product_type: pt,
        geometry: derivedGeometry,
        base_width_mm: widthMmNum,
        run_up: runUpN,
        gusset_mm: gussetMmRounded,
        ufilm_left_width_mm: isLRFilm ? Math.round(Number(spec.dimensions?.ufilm_left_width_mm || 0) || 0) : null,
        ufilm_right_width_mm: isLRFilm ? Math.round(Number(spec.dimensions?.ufilm_right_width_mm || 0) || 0) : null,
      })
  if (!(extruderDecisionWidthMm > 0)) {
    return { extruderCode: null, hintLine: '' }
  }

  const usable = extruders
    .filter((e) => e && typeof e.decision_width_mm === 'number' && Number.isFinite(e.decision_width_mm))
    .map((e) => ({ ...e, decision_width_mm: Number(e.decision_width_mm) }))
    .sort(
      (a, b) =>
        (a.decision_width_mm ?? 0) - (b.decision_width_mm ?? 0) || String(a.extruder_code).localeCompare(String(b.extruder_code)),
    )

  if (!usable.length) {
    return { extruderCode: null, hintLine: 'No extruders in ratebook.' }
  }

  const widthLabel = isUFilm ? 'middle width' : 'layflat'
  const firstFit = usable.find((e) => (e.decision_width_mm ?? 0) >= extruderDecisionWidthMm) || null
  if (firstFit) {
    return {
      extruderCode: String(firstFit.extruder_code || '').trim() || null,
      hintLine: '',
    }
  }

  const fallback = usable[usable.length - 1]
  const code = String(fallback.extruder_code || '').trim() || null
  return {
    extruderCode: code,
    hintLine: `No extruder listed at ≥ ${widthLabel} ${Math.round(extruderDecisionWidthMm)} mm; using largest available.`,
  }
}

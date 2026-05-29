/**
 * Smallest ratebook extruder that fits the layflat / decision width implied by a product spec.
 * Aligns with the Quotes page extruder auto-selection (first fit by decision width, else largest).
 */

import type { SpecPayload } from '../components/SpecPayloadForm'
import { computeLayflatWidthMm, type QuoteRatebook } from './quoteCalculator'
import { productTypeCanHaveGusset } from './specCompat'
import { isLeftRightWidthFilmProductType, isUFilmProductType } from './filmProductTypes'

/** True when an extruder ratebook row is marked unavailable in admin. */
export function extruderIsBroken(ex: { is_broken?: boolean | null } | null | undefined): boolean {
  return !!ex?.is_broken
}

/** Resolve whether a ratebook extruder code is marked unavailable. */
export function extruderCodeIsBroken(
  extruderCode: string,
  ratebook: QuoteRatebook | null | undefined,
): boolean {
  const code = String(extruderCode || '').trim()
  if (!code) return false
  const extruders = Array.isArray(ratebook?.extruders) ? ratebook.extruders : []
  const row = extruders.find((e) => e && String(e.extruder_code || '').trim() === code)
  return extruderIsBroken(row)
}

export type ExtruderDisableReason = 'Unavailable'

/** Why an extruder cannot be chosen, or `null` if it is selectable. */
export function extruderDisableReasonForSpec(
  extruderCode: string,
  _spec: SpecPayload,
  ratebook: QuoteRatebook | null | undefined,
): ExtruderDisableReason | null {
  const code = String(extruderCode || '').trim()
  if (!code) return null
  if (extruderCodeIsBroken(code, ratebook)) return 'Unavailable'
  return null
}

export function extruderCodeIsSelectableForSpec(
  extruderCode: string,
  spec: SpecPayload,
  ratebook: QuoteRatebook | null | undefined,
): boolean {
  return extruderDisableReasonForSpec(extruderCode, spec, ratebook) == null
}

/** Disable reason for a ratebook row in the extruder dropdown. */
export function extruderRowDisableReason(
  ex: { extruder_code?: string | null; is_broken?: boolean | null },
  _spec: SpecPayload,
  _ratebook: QuoteRatebook | null | undefined,
): ExtruderDisableReason | null {
  const code = String(ex?.extruder_code || '').trim()
  if (!code) return null
  if (extruderIsBroken(ex)) return 'Unavailable'
  return null
}

function runUpSlugToNumber(runUp: string | undefined): number {
  if (!runUp || runUp === 'none') return 1
  if (runUp === '2up') return 2
  if (runUp === '4up') return 4
  if (runUp === '6up') return 6
  return 1
}

/** Decision width (mm) used to pick an extruder — same calculation as {@link suggestSmallestFittingExtruderCode}. */
export function extruderDecisionWidthMmFromSpec(spec: SpecPayload): number | null {
  if (!spec?.dimensions) return null
  const pt = String(spec.identity?.product_type || 'Bag')
  const isLRFilm = isLeftRightWidthFilmProductType(pt)
  const isUFilm = isUFilmProductType(pt)
  const widthMmNum = Math.round(Number(spec.dimensions?.base_width_mm || 0))
  const ufilmL = Math.round(Number(spec.dimensions?.ufilm_left_width_mm || 0) || 0)
  const ufilmR = Math.round(Number(spec.dimensions?.ufilm_right_width_mm || 0) || 0)
  if (!(widthMmNum > 0) && !(isLRFilm && ufilmL > 0 && ufilmR > 0)) {
    return null
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
  return extruderDecisionWidthMm > 0 ? extruderDecisionWidthMm : null
}

/** True when the ratebook row for `extruderCode` is wide enough for the spec's decision width. */
export function extruderCodeFitsSpecWidth(
  extruderCode: string,
  spec: SpecPayload,
  ratebook: QuoteRatebook | null | undefined,
): boolean {
  const code = String(extruderCode || '').trim()
  if (!code) return false
  const need = extruderDecisionWidthMmFromSpec(spec)
  if (need == null) return true
  const extruders = Array.isArray(ratebook?.extruders) ? ratebook.extruders : []
  const row = extruders.find((e) => e && String(e.extruder_code || '').trim() === code)
  if (!row || typeof row.decision_width_mm !== 'number' || !Number.isFinite(row.decision_width_mm)) {
    return false
  }
  return Number(row.decision_width_mm) >= need
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
  const extruderDecisionWidthMm = extruderDecisionWidthMmFromSpec(spec)
  if (extruderDecisionWidthMm == null) {
    return { extruderCode: null, hintLine: '' }
  }

  const pt = String(spec.identity?.product_type || 'Bag')
  const isUFilm = isUFilmProductType(pt)
  const widthLabel = isUFilm ? 'middle width' : 'layflat'

  const usable = extruders
    .filter(
      (e) =>
        e &&
        !extruderIsBroken(e) &&
        typeof e.decision_width_mm === 'number' &&
        Number.isFinite(e.decision_width_mm),
    )
    .map((e) => ({ ...e, decision_width_mm: Number(e.decision_width_mm) }))
    .sort(
      (a, b) =>
        (a.decision_width_mm ?? 0) - (b.decision_width_mm ?? 0) || String(a.extruder_code).localeCompare(String(b.extruder_code)),
    )

  if (!usable.length) {
    return { extruderCode: null, hintLine: 'No extruders in ratebook.' }
  }

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

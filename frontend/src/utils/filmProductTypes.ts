/** U-Film / J-Film helpers (shared left+right width fields on `dimensions`). */

export function isUFilmProductType(productType: string | undefined | null): boolean {
  return String(productType ?? '').trim() === 'U-Film'
}

export function isJFilmProductType(productType: string | undefined | null): boolean {
  return String(productType ?? '').trim() === 'J-Film'
}

/** Spec uses `ufilm_left_width_mm` / `ufilm_right_width_mm` for both film types. */
export function isLeftRightWidthFilmProductType(productType: string | undefined | null): boolean {
  return isUFilmProductType(productType) || isJFilmProductType(productType)
}

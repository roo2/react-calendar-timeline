export const PRODUCT_TYPE = {
  Bag: 'Bag',
  Tube: 'Tube',
  Sleeve: 'Sleeve',
  Sheet: 'Sheet',
  Centerfold: 'Centerfold',
  UFilm: 'U-Film',
  JFilm: 'J-Film',
} as const

export type ProductType = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE]

export const PRODUCT_TYPES: ProductType[] = [
  PRODUCT_TYPE.Bag,
  PRODUCT_TYPE.Tube,
  PRODUCT_TYPE.Sleeve,
  PRODUCT_TYPE.Sheet,
  PRODUCT_TYPE.Centerfold,
  PRODUCT_TYPE.UFilm,
  PRODUCT_TYPE.JFilm,
]

export function productTypeLabel(v: ProductType | string): string {
  return v === PRODUCT_TYPE.Centerfold ? 'Centrefold' : String(v)
}

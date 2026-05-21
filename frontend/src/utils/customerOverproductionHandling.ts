import type { FinishMode } from './quantityRollFields'
import { productDisplayUnitPlural } from './quantityRollFields'

/** Stored on product spec `order_defaults.customer_overproduction_handling`. */
export type CustomerOverproductionHandling = 'send_exact_quantity' | 'send_all_products' | 'send_full_cartons'

export const DEFAULT_OVERPRODUCTION_HANDLING: CustomerOverproductionHandling = 'send_all_products'

const VALID: CustomerOverproductionHandling[] = ['send_exact_quantity', 'send_all_products', 'send_full_cartons']

export function isCustomerOverproductionHandling(v: unknown): v is CustomerOverproductionHandling {
  return typeof v === 'string' && (VALID as string[]).includes(v)
}

/** Coerce stored value for the active finish mode (carton-only option invalid on rolls). */
export function normalizeCustomerOverproductionHandling(
  raw: unknown,
  finishMode: FinishMode,
): CustomerOverproductionHandling {
  const v = isCustomerOverproductionHandling(raw) ? raw : DEFAULT_OVERPRODUCTION_HANDLING
  if (finishMode === 'Rolls' && v === 'send_full_cartons') return DEFAULT_OVERPRODUCTION_HANDLING
  return v
}

export function overproductionOptionLabel(
  value: CustomerOverproductionHandling,
  productType: string | undefined | null,
): string {
  const products = productDisplayUnitPlural(productType).toLowerCase()
  switch (value) {
    case 'send_exact_quantity':
      return 'Send exact quantity only.'
    case 'send_all_products':
      return `Send all ${products} to customer.`
    case 'send_full_cartons':
      return 'Send all full cartons to customer.'
    default:
      return ''
  }
}

export function overproductionOptionsForFinishMode(finishMode: FinishMode): CustomerOverproductionHandling[] {
  if (finishMode === 'Cartons') {
    return ['send_all_products', 'send_full_cartons', 'send_exact_quantity']
  }
  return ['send_exact_quantity', 'send_all_products']
}

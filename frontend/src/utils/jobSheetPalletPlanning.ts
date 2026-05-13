import { palletsRequiredCeil } from './palletShippingEstimate'

export type PalletPerPalletSource = 'specified' | 'volume_estimate'

export type JobSheetPalletLoadPlanning = {
  shipUnits: number
  unitsPerPallet: number
  palletsRequired: number
  perPalletSource: PalletPerPalletSource
}

/**
 * Rolls/cartons to ship to the customer from order total minus stock-to-warehouse.
 * Mirrors {@link SpecPayloadForm} stock planning (conversion `qty_to_stock`).
 */
export function deriveShipToCustomerUnitsFromConversion(opts: {
  qtyToStockRaw: unknown
  orderTotalUnits: number | null | undefined
}): number | null {
  const raw = String(opts.qtyToStockRaw ?? '').trim()
  const stockN = raw === '' || !Number.isFinite(Number(raw)) ? 0 : Math.max(0, Math.round(Number(raw)))
  const total =
    opts.orderTotalUnits != null &&
    Number.isFinite(Number(opts.orderTotalUnits)) &&
    Number(opts.orderTotalUnits) > 0
      ? Math.round(Number(opts.orderTotalUnits))
      : null
  if (total == null) return null
  const capped = Math.min(stockN, total)
  return Math.max(0, total - capped)
}

export function resolveUnitsPerPalletForPlanning(opts: {
  finishMode: 'Rolls' | 'Cartons'
  rollsPerPallet: number | null | undefined
  cartonsPerPallet: number | null | undefined
  estimatedUnitsPerPalletVolume: number | null | undefined
}): { unitsPerPallet: number; perPalletSource: PalletPerPalletSource } | null {
  const specified =
    opts.finishMode === 'Cartons'
      ? opts.cartonsPerPallet != null && Number(opts.cartonsPerPallet) > 0
        ? Math.round(Number(opts.cartonsPerPallet))
        : null
      : opts.rollsPerPallet != null && Number(opts.rollsPerPallet) > 0
        ? Math.round(Number(opts.rollsPerPallet))
        : null
  if (specified != null) return { unitsPerPallet: specified, perPalletSource: 'specified' }
  const est = opts.estimatedUnitsPerPalletVolume
  if (est != null && Number.isFinite(Number(est)) && Number(est) > 0) {
    return { unitsPerPallet: Math.round(Number(est)), perPalletSource: 'volume_estimate' }
  }
  return null
}

/** Pallets needed for the ship quantity, using specified per-pallet counts or the volume heuristic. */
export function computeJobSheetPalletLoadPlanning(opts: {
  finishMode: 'Rolls' | 'Cartons'
  rollsPerPallet: number | null | undefined
  cartonsPerPallet: number | null | undefined
  estimatedUnitsPerPalletVolume: number | null | undefined
  qtyToStockRaw: unknown
  orderTotalUnits: number | null | undefined
}): JobSheetPalletLoadPlanning | null {
  const ship = deriveShipToCustomerUnitsFromConversion({
    qtyToStockRaw: opts.qtyToStockRaw,
    orderTotalUnits: opts.orderTotalUnits,
  })
  if (ship == null) return null
  const per = resolveUnitsPerPalletForPlanning({
    finishMode: opts.finishMode,
    rollsPerPallet: opts.rollsPerPallet,
    cartonsPerPallet: opts.cartonsPerPallet,
    estimatedUnitsPerPalletVolume: opts.estimatedUnitsPerPalletVolume,
  })
  if (per == null) return null
  if (ship === 0) {
    return { shipUnits: 0, unitsPerPallet: per.unitsPerPallet, palletsRequired: 0, perPalletSource: per.perPalletSource }
  }
  const pallets = palletsRequiredCeil(ship, per.unitsPerPallet)
  if (pallets == null) return null
  return { shipUnits: ship, unitsPerPallet: per.unitsPerPallet, palletsRequired: pallets, perPalletSource: per.perPalletSource }
}

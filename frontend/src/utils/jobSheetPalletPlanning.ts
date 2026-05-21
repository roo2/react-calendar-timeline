import { palletsRequiredCeil } from './palletShippingEstimate'

export type PalletPerPalletSource = 'specified' | 'volume_estimate'

export type JobSheetPalletLoadPlanning = {
  shipUnits: number
  unitsPerPallet: number
  palletsRequired: number
  perPalletSource: PalletPerPalletSource
}

/** Order cartons/rolls used for pallet planning (stock/ship are filled in on the printed sheet only). */
export function orderTotalUnitsForPlanning(orderTotalUnits: number | null | undefined): number | null {
  if (
    orderTotalUnits != null &&
    Number.isFinite(Number(orderTotalUnits)) &&
    Number(orderTotalUnits) > 0
  ) {
    return Math.round(Number(orderTotalUnits))
  }
  return null
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

/** Pallets needed for the order total, using specified per-pallet counts or the volume heuristic. */
export function computeJobSheetPalletLoadPlanning(opts: {
  finishMode: 'Rolls' | 'Cartons'
  rollsPerPallet: number | null | undefined
  cartonsPerPallet: number | null | undefined
  estimatedUnitsPerPalletVolume: number | null | undefined
  orderTotalUnits: number | null | undefined
}): JobSheetPalletLoadPlanning | null {
  const ship = orderTotalUnitsForPlanning(opts.orderTotalUnits)
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

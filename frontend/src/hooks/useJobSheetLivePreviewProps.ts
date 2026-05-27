import { useMemo } from 'react'
import type { ComponentProps } from 'react'
import type { SpecPayload } from '../components/SpecPayloadForm'
import type { JobSheetPreviewPanel } from '../components/JobSheetPreviewPanel'
import { useAppSelector } from '../store/hooks'
import { computeProductCodeFromSpec, computeProductDescriptionFromSpec } from '../utils/productDescription'
import {
  joinQuoteDescriptionWithPackagingTail,
  quotePackagingPerUnitTail,
  type QuoteQtyMode,
} from '../utils/quoteQuantityDescriptors'
import { computeJobSheetPreviewQuoteSummary } from '../utils/jobSheetPreviewQuoteSummary'
import { buildJobSheetPrintHeaderSummaryLine } from '../utils/jobSheetPrintHeaderSummary'
import { buildLiveJobSheetRowForOrderQuantityLabel } from '../utils/jobSheetQuantityFromApi'
import { computeJobSheetPalletLoadPlanning } from '../utils/jobSheetPalletPlanning'
import { estimateUnitsPerPalletVolumeFromLiveSpec } from '../utils/palletShippingEstimate'
import {
  resolveNumRollsForPersistence,
  type FinishMode,
} from '../utils/quantityRollFields'
import { hideMyobProductPlaceholderText } from '../utils/jobSheetPreviewText'
import { buildJobSheetPrintQualityCheckLabels } from '../utils/qualityFlagLabels'
import { customerFacingDescriptionFromSpec } from '../utils/specOrderDefaults'
import type { SpecLinkedQuantityBind } from './useSpecLinkedQuantityFields'

export type JobSheetLivePreviewPanelProps = ComponentProps<typeof JobSheetPreviewPanel>

export type UseJobSheetLivePreviewParams = {
  spec: SpecPayload
  qty: SpecLinkedQuantityBind
  customerId: string
  /** @deprecated Use `spec.order_defaults.customer_facing_description`. */
  customerFacingDescription?: string
  orderDate: string
  dueDate: string
  showJobFields: boolean
  jobSheetId?: string | null
  loadedJobSheet?: Record<string, unknown> | null
  jobSheetDetailData?: {
    job_sheet?: Record<string, unknown>
    myob_import_line_description?: string | null
  } | null
  productionExtruderCode: string
  /** When false, omit live order qty, quote estimates, and pallet planning. */
  includeProductionEstimates?: boolean
}

/**
 * Builds {@link JobSheetPreviewPanel} props shared by the full-page job sheet editor
 * and embedded editors (e.g. order modal {@link ProductVersionEditor}).
 */
export function useJobSheetLivePreviewProps(params: UseJobSheetLivePreviewParams): JobSheetLivePreviewPanelProps {
  const {
    spec,
    qty,
    customerId,
    customerFacingDescription: customerFacingDescriptionParam,
    orderDate,
    dueDate,
    showJobFields,
    jobSheetId = null,
    loadedJobSheet = null,
    jobSheetDetailData = null,
    productionExtruderCode,
    includeProductionEstimates = true,
  } = params

  const ratebook = useAppSelector((s) => s.quotes.quoteRatebook.data)

  const finishMode = qty.finishMode
  const effectiveQtyType = qty.effectiveQtyType
  const derivedForDisplay = qty.derivedForDisplay

  const totalKgNum = Number(qty.totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(qty.numRolls || 0)))
  const weightPerRollNum = Number(qty.weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(qty.numUnits || 0)))
  const numCartonsNum = Math.max(0, Math.round(Number(qty.numCartons || 0)))

  const derivedDisplay = derivedForDisplay
    ? {
        derivedTotalKg: derivedForDisplay.derivedTotalKg ?? null,
        units: derivedForDisplay.units ?? null,
        kgPerRoll: derivedForDisplay.kgPerRoll ?? null,
      }
    : null

  const totalKgDisplay = qty.totalKgDisplay

  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewGeneratedProductCode = useMemo(() => computeProductCodeFromSpec(spec), [spec])

  const previewPackagingTail = useMemo(() => {
    const bagsPerCarton =
      spec.packaging?.bags_per_carton != null ? Math.max(0, Math.round(Number(spec.packaging.bags_per_carton))) : 0
    const d = qty.derivedForDisplay
    const quantityTotalM =
      d?.derivedTotalM != null && Number(d.derivedTotalM) > 0 ? Number(d.derivedTotalM) : 0
    let quantityRolls = Math.max(0, Math.round(Number(qty.numRolls || 0)))
    if (
      qty.finishMode === 'Rolls' &&
      qty.isContinuousLength &&
      qty.effectiveQtyType === 'units' &&
      !(quantityRolls > 0)
    ) {
      const nu = Math.max(0, Math.round(Number(qty.numUnits || 0)))
      if (nu > 0) quantityRolls = nu
    }
    const qtyModeForTail: QuoteQtyMode =
      qty.effectiveQtyType === 'kg' ? 'kg' : qty.effectiveQtyType === 'units' ? 'units' : 'roll'
    let unitsPerRollForTail = Math.max(0, Math.round(Number(qty.unitsPerRoll || 0)))
    const nu = Math.max(0, Math.round(Number(qty.numUnits || 0)))
    const nr = Math.max(0, Math.round(Number(qty.numRolls || 0)))
    if (unitsPerRollForTail <= 0 && nu > 0 && nr > 0) {
      unitsPerRollForTail = Math.max(1, Math.round(nu / nr))
    }
    return quotePackagingPerUnitTail({
      finishMode: qty.finishMode,
      productType: qty.productType,
      bagsPerCarton,
      isContinuousLength: qty.isContinuousLength,
      metersPerRoll: Number(qty.metersPerRoll || 0),
      weightPerRollKg: Number(qty.weightPerRoll || 0),
      quantityTotalM,
      quantityRolls,
      qtyMode: qtyModeForTail,
      unitsPerRoll: unitsPerRollForTail,
    })
  }, [
    spec.packaging?.bags_per_carton,
    qty.finishMode,
    qty.productType,
    qty.isContinuousLength,
    qty.metersPerRoll,
    qty.weightPerRoll,
    qty.numRolls,
    qty.numUnits,
    qty.unitsPerRoll,
    qty.effectiveQtyType,
    qty.derivedForDisplay?.derivedTotalM,
  ])

  const previewDescriptionWithPackagingTail = useMemo(
    () => hideMyobProductPlaceholderText(joinQuoteDescriptionWithPackagingTail(previewDescription, previewPackagingTail)),
    [previewDescription, previewPackagingTail],
  )

  const customerFacingDescription =
    String(customerFacingDescriptionParam ?? '').trim() ||
    customerFacingDescriptionFromSpec(spec).trim()

  const previewCustomerFacingDescriptionWithPackagingTail = useMemo(() => {
    const plain = String(customerFacingDescription || '').trim()
    if (!plain) return ''
    return hideMyobProductPlaceholderText(joinQuoteDescriptionWithPackagingTail(plain, previewPackagingTail))
  }, [customerFacingDescription, previewPackagingTail])

  const previewJobSheetQuantityRow = useMemo(() => {
    if (!includeProductionEstimates) return null
    const totalKgForScheduling =
      finishMode === 'Cartons' && !(totalKgNum > 0) && totalKgDisplay != null && Number(totalKgDisplay) > 0
        ? Number(totalKgDisplay)
        : totalKgNum
    const persistedRolls = resolveNumRollsForPersistence(
      finishMode,
      effectiveQtyType,
      totalKgNum,
      numRollsNum,
      weightPerRollNum,
      derivedDisplay,
    )
    const fallbackLegacy =
      loadedJobSheet != null &&
      loadedJobSheet.quantity_value != null &&
      Number(loadedJobSheet.quantity_value) > 0
        ? Number(loadedJobSheet.quantity_value)
        : 1
    const bpc = spec.packaging?.bags_per_carton
    return buildLiveJobSheetRowForOrderQuantityLabel({
      effectiveQtyType,
      finishMode,
      totalKgForScheduling,
      numUnitsNum,
      numRollsPersisted: persistedRolls,
      derivedProductUnits: derivedForDisplay?.units,
      quantityValueFallback: fallbackLegacy,
      bagsPerCarton: bpc != null ? Number(bpc) : null,
      cartonQtyMode: qty.cartonQtyMode,
      numCartonsNum,
      isImportDraft: Boolean(loadedJobSheet?.is_import_draft),
    })
  }, [
    includeProductionEstimates,
    finishMode,
    effectiveQtyType,
    totalKgNum,
    totalKgDisplay,
    qty.cartonQtyMode,
    qty.numCartons,
    numCartonsNum,
    numRollsNum,
    weightPerRollNum,
    numUnitsNum,
    derivedDisplay,
    loadedJobSheet,
    spec.packaging?.bags_per_carton,
    derivedForDisplay?.units,
  ])

  const previewJsForHeaderSummary = useMemo(() => {
    if (!previewJobSheetQuantityRow) return null
    const row: Record<string, unknown> = { ...previewJobSheetQuantityRow }
    if (weightPerRollNum > 0) row.weight_per_roll_kg = weightPerRollNum
    const upr = qty.unitsPerRoll
    if (upr != null && Number(upr) > 0) row.units_per_roll = Math.max(1, Math.round(Number(upr)))
    return row
  }, [previewJobSheetQuantityRow, weightPerRollNum, qty.unitsPerRoll])

  const previewHeaderSummaryLine = useMemo(() => {
    if (!previewJsForHeaderSummary) return null
    const d = derivedForDisplay
    const derivedUnits =
      d?.units != null && Number(d.units) > 0 && Number.isFinite(Number(d.units))
        ? Math.round(Number(d.units))
        : null
    const geo =
      (d?.derivedTotalM != null && Number(d.derivedTotalM) > 0) || derivedUnits != null
        ? {
            derivedTotalM: d?.derivedTotalM != null && Number(d.derivedTotalM) > 0 ? Number(d.derivedTotalM) : 0,
            mPerRoll:
              d?.mPerRoll != null && Number(d.mPerRoll) > 0
                ? Number(d.mPerRoll)
                : null,
            derivedProductUnits: derivedUnits,
          }
        : null
    const line = buildJobSheetPrintHeaderSummaryLine(
      previewJsForHeaderSummary,
      spec as Record<string, unknown>,
      geo,
    )
    return line.trim() !== '' ? line.trim() : null
  }, [previewJsForHeaderSummary, spec, derivedForDisplay])

  const quoteSummary = useMemo(
    () =>
      previewJobSheetQuantityRow
        ? computeJobSheetPreviewQuoteSummary(spec, previewJobSheetQuantityRow, ratebook ?? null, qty.quickInputs ?? null)
        : null,
    [spec, previewJobSheetQuantityRow, ratebook, qty.quickInputs],
  )

  const extruderCodeForQty = productionExtruderCode.trim() !== '' ? productionExtruderCode.trim() : null

  const stockPlanningTotalUnits = includeProductionEstimates ? qty.stockPlanningTotalUnits : null

  const estimatedUnitsPerPalletVolume = useMemo(
    () =>
      includeProductionEstimates
        ? estimateUnitsPerPalletVolumeFromLiveSpec({
            ratebook: ratebook ?? null,
            spec,
            quickInputs: qty.quickInputs ?? null,
            extruderCode: extruderCodeForQty,
          })
        : null,
    [includeProductionEstimates, ratebook, spec, qty.quickInputs, extruderCodeForQty],
  )

  const palletLoadPlanning = useMemo(() => {
    if (!includeProductionEstimates) return null
    return computeJobSheetPalletLoadPlanning({
      finishMode: finishMode === 'Cartons' ? 'Cartons' : 'Rolls',
      rollsPerPallet: spec.packaging?.rolls_per_pallet,
      cartonsPerPallet: spec.packaging?.cartons_per_pallet,
      estimatedUnitsPerPalletVolume,
      orderTotalUnits: stockPlanningTotalUnits,
    })
  }, [
    includeProductionEstimates,
    finishMode,
    spec.packaging?.rolls_per_pallet,
    spec.packaging?.cartons_per_pallet,
    estimatedUnitsPerPalletVolume,
    stockPlanningTotalUnits,
  ])

  const customerForPreview = useAppSelector((s) => {
    const id = String(customerId || '').trim()
    if (!id) return null
    return s.customers.list.items.find((c) => c.id === id) ?? s.customers.detail.byId[id]?.customer ?? null
  })
  const customerName = (customerForPreview?.name || '').trim()

  const invoiceNo = useMemo(() => {
    const js = jobSheetDetailData?.job_sheet
    return js?.invoice_no != null ? String(js.invoice_no).trim() : ''
  }, [jobSheetDetailData?.job_sheet])

  const purchaseOrderNo = useMemo(() => {
    const js = jobSheetDetailData?.job_sheet ?? loadedJobSheet
    if (!js) return ''
    const v = (js as { customer_purchase_order_number?: unknown }).customer_purchase_order_number
    return v != null && String(v).trim() ? String(v).trim() : ''
  }, [jobSheetDetailData?.job_sheet, loadedJobSheet])

  const myobImportLineDescription = useMemo(() => {
    const raw = jobSheetDetailData?.myob_import_line_description
    if (raw == null || typeof raw !== 'string') return ''
    return raw.trim()
  }, [jobSheetDetailData?.myob_import_line_description])

  const previewNotesLine = useMemo(() => {
    const a = String(spec?.identity?.notes ?? '').trim()
    const b = String(spec?.run_requirements?.notes ?? '').trim()
    return (a || b || '').trim() || null
  }, [spec?.identity?.notes, spec?.run_requirements?.notes])

  const previewQualityCheckLabels = useMemo(() => {
    const labels = buildJobSheetPrintQualityCheckLabels(spec)
    return labels.length > 0 ? labels : null
  }, [spec])

  const jobCode =
    loadedJobSheet?.job_no != null && String(loadedJobSheet.job_no).trim()
      ? String(loadedJobSheet.job_no).trim()
      : ''

  const finishModeKey: FinishMode = finishMode

  return {
    jobSheetId,
    jobCode,
    customerName,
    invoiceNo,
    purchaseOrderNo,
    orderDate,
    dueDate,
    generatedProductCode: previewGeneratedProductCode,
    description: previewDescriptionWithPackagingTail,
    myobImportLineDescription,
    customerFacingDescription: previewCustomerFacingDescriptionWithPackagingTail || customerFacingDescription,
    notes: previewNotesLine,
    qualityCheckLabels: previewQualityCheckLabels,
    quoteSummary,
    palletLoadPlanning,
    palletUnitLabel: finishModeKey === 'Cartons' ? 'cartons' : 'rolls',
    showJobFields,
    headerSummaryLine: previewHeaderSummaryLine ?? quoteSummary?.headerSummaryLine ?? null,
  }
}

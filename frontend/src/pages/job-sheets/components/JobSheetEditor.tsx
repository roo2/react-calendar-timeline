import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../../../store/slices/productsSlice'
import { Link, useNavigate } from 'react-router-dom'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import {
  coerceQtyTypeForFinishMode,
  computeTotalKgDisplay,
  getOrderQuantityFromJobSheetFields,
  resolvedProductUnitsForOrder,
  resolveNumRollsForPersistence,
  resolveWeightPerRollForPersistence,
  validateJobSheetQuantityInputs,
  cartonsWeightPerRollKg,
  type FinishMode,
  type QtyType,
} from '../../../utils/quantityRollFields'
import PrintIcon from '@mui/icons-material/Print'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { ApiError } from '../../../api/client'
import { parseFastApiValidationDetail } from '../../../api/validation'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { isRejectedWithValue } from '@reduxjs/toolkit'
import type { UpsertError } from '../../../store/slices/productsSlice'
import { clearCreateErrors, createProduct, fetchProduct, fetchProducts } from '../../../store/slices/productsSlice'
import { createJobSheet, fetchJobSheet, saveJobSheetAsNewProduct, updateJobSheet } from '../../../store/slices/jobSheetsSlice'
import { computeProductDescriptionFromSpec, getDisplayProductCodeFromSpec } from '../../../utils/productDescription'
import { SaveAsNewProductButton, SaveFormButton } from '../../../components/SaveActionButtons'
import { JobSheetLivePreview } from '../../../components/JobSheetLivePreview'
import { hideMyobProductPlaceholderText } from '../../../utils/jobSheetPreviewText'
import { useJobSheetLivePreviewProps } from '../../../hooks/useJobSheetLivePreviewProps'
import {
  makeDefaultSpec,
  SpecPayloadForm,
  type JobSheetPrintingContext,
  type SpecPayload,
} from '../../../components/SpecPayloadForm'
import { sanitizeSpecFormulationMixes } from '../../../utils/specFormulationSanitize'
import { CustomerOverproductionHandlingField } from '../../../components/quantity/CustomerOverproductionHandlingField'
import { CartonRollWeightField, LinkedQuantityFields } from '../../../components/quantity/LinkedQuantityFields'
import { useSpecLinkedQuantityFields } from '../../../hooks/useSpecLinkedQuantityFields'
import { JobSheetIdentityQuantitySection, productionStatusShowsDatetimeFields, type JobSheetQuantityFieldsProps } from './JobSheetIdentityQuantitySection'
import { ProductionExtruderSelect } from '../../../components/extruder/ProductionExtruderSelect'
import {
  extruderCodeIsSelectableForSpec,
  suggestSmallestFittingExtruderCode,
} from '../../../utils/suggestExtruderFromSpec'
import { estimateUnitsPerPalletVolumeFromLiveSpec } from '../../../utils/palletShippingEstimate'
import { canEnableSaveAsNewProduct } from '../../../utils/saveAsNewProductEligibility'
import { normalizeCustomerOverproductionHandling } from '../../../utils/customerOverproductionHandling'
import {
  buildOrderDefaultsFromEditor,
  customerFacingDescriptionFromSpec,
  customerOverproductionFromSpec,
  getSpecOrderDefaults,
  mergeOrderDefaultsIntoSpec,
  orderDefaultsEqual,
  orderQtyPrefsFromJobSheetAndSpec,
  persistedQtyTypeFromPrefs,
} from '../../../utils/specOrderDefaults'

type Mode = 'new' | 'edit'

type ProductSummary = ProductListItem

/** ISO instant → value for `input type="datetime-local"` (browser local). */
function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return ''
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `datetime-local` (interpreted as local) → ISO UTC string, or null if empty. */
function datetimeLocalToIsoUtc(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Placeholder select value while composing a new product (not a real product id until save). */
const NEW_PRODUCT_DRAFT_VALUE = '__new_product_draft__'

function ensureSpec(s: any): SpecPayload {
  const d = makeDefaultSpec()
  const src = s && typeof s === 'object' ? s : {}
  return {
    ...d,
    ...src,
    identity: { ...d.identity, ...(src.identity || {}) },
    order_defaults: { ...(d as { order_defaults?: object }).order_defaults, ...((src as { order_defaults?: object }).order_defaults || {}) },
    dimensions: { ...d.dimensions, ...(src.dimensions || {}) },
    formulation: { ...d.formulation, ...(src.formulation || {}) },
    printing: { ...d.printing, ...(src.printing || {}) },
    quality_expectations: { ...d.quality_expectations, ...(src.quality_expectations || {}) },
    run_requirements: { ...d.run_requirements, ...(src.run_requirements || {}) },
    packaging: { ...d.packaging, ...(src.packaging || {}) },
    tool_requirements: Array.isArray(src.tool_requirements) ? src.tool_requirements : d.tool_requirements,
  }
}

export function JobSheetEditor(props: { mode: Mode; jobSheetId?: string; returnTo?: string }) {
  const { mode, jobSheetId, returnTo } = props
  const dispatch = useAppDispatch()
  const nav = useNavigate()


  const createState = useAppSelector((s) => s.products.create)
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const loadedJobSheet = mode === 'edit' && jobSheetId ? jobSheetDetail?.data?.job_sheet : undefined
  const { setDirty } = useUnsavedChanges()
  const [savingJobSheet, setSavingJobSheet] = useState(false)
  const [savingAsNew, setSavingAsNew] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderId, setOrderId] = useState('')
  /** Linked production Job.status (edit only). */
  const [productionStatus, setProductionStatus] = useState('planned')
  const [productionStartedLocal, setProductionStartedLocal] = useState('')
  const [productionFinishedLocal, setProductionFinishedLocal] = useState('')
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)
  const orderDateInputRef = useRef<HTMLInputElement | null>(null)

  const [productId, setProductId] = useState(() => (mode === 'new' ? NEW_PRODUCT_DRAFT_VALUE : ''))
  const [productInfo, setProductInfo] = useState<ProductSummary | null>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  /** Edit: when true, PUT includes `spec` so the server creates a new product version (same as before). */
  const [specDirty, setSpecDirty] = useState(false)

  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [specFieldErrors, setSpecFieldErrors] = useState<Record<string, string>>({})
  const loadedOrderDefaultsRef = useRef(getSpecOrderDefaults(makeDefaultSpec()))
  /** Stored on the linked product (shared across job sheets). */
  const [productionExtruderCode, setProductionExtruderCode] = useState('')
  /** After the user changes the extruder dropdown, do not auto-fill over an explicit empty selection. */
  const extruderUserTouchedRef = useRef(false)
  const quoteRatebookState = useAppSelector((s) => s.quotes.quoteRatebook)
  const ratebook = quoteRatebookState.data

  const extruderCodeForQty =
    productionExtruderCode.trim() !== '' ? productionExtruderCode.trim() : null

  const qty = useSpecLinkedQuantityFields({ spec, ratebook, extruderCode: extruderCodeForQty })

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  /** Re-hydrate when fetch returns a new detail payload (same id, fresher object). */
  const lastJobDetailDataRef = useRef<unknown>(null)

  useEffect(() => {
    lastJobDetailDataRef.current = null
  }, [jobSheetId])

  useEffect(() => {
    if (mode !== 'edit' || !jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [mode, jobSheetId, dispatch])

  // Edit mode: hydrate form from job sheet detail in the store
  useEffect(() => {
    if (mode !== 'edit' || !jobSheetId) return
    setSaveMsg(null)
    setSpecDirty(false)
    const st = jobSheetDetail
    if (!st) return
    if (st.status === 'failed') {
      setSaveErr(st.error || 'Failed to load job sheet')
      return
    }
    if (st.status !== 'succeeded' || !st.data) return
    if (lastJobDetailDataRef.current === st.data) return
    lastJobDetailDataRef.current = st.data
    setSaveErr(null)
    setSpecFieldErrors({})
    const res = st.data
    const js = res?.job_sheet
    setCustomerId(js?.customer_id || '')
    setProductId(js?.product_id || '')
    setProductInfo(
      js?.product_id
        ? {
            id: String(js.product_id),
            code: String(js.product_code || ''),
            description: (js.product_description as string | null | undefined) ?? null,
            customer_id: String(js.customer_id || ''),
            active_version_id: String(js.product_version_id || ''),
          }
        : null,
    )
    setDueDate(js?.due_date || '')
    setOrderDate(js?.order_date ? String(js.order_date).slice(0, 10) : '')
    setOrderId(js?.order_id ? String(js.order_id) : '')
    const importLineDesc =
      res && typeof (res as { myob_import_line_description?: string }).myob_import_line_description === 'string'
        ? String((res as { myob_import_line_description?: string }).myob_import_line_description).trim()
        : ''
    const rawPs =
      js?.production_status != null && String(js.production_status).trim() !== ''
        ? String(js.production_status).trim().toLowerCase()
        : 'planned'
    const normalizedPs = rawPs === 'paused' || rawPs === 'completed' ? 'running' : rawPs
    setProductionStatus(normalizedPs)
    setProductionStartedLocal(isoToDatetimeLocalValue(js?.production_started_at as string | null | undefined))
    setProductionFinishedLocal(isoToDatetimeLocalValue(js?.production_finished_at as string | null | undefined))
    const extFromRow =
      js?.production_extruder_code != null && String(js.production_extruder_code).trim() !== ''
        ? String(js.production_extruder_code).trim()
        : ''
    const isImportDraft = Boolean(js?.is_import_draft)
    let loadedSpec0 = ensureSpec(res?.spec_payload)
    const prefsEarly = orderQtyPrefsFromJobSheetAndSpec(js as Record<string, unknown>, loadedSpec0)
    const backfillOd = {
      qty_type: prefsEarly.qty_type,
      quantity_unit: prefsEarly.quantity_unit,
      weight_per_roll_kg: prefsEarly.weight_per_roll_kg,
      customer_facing_description: prefsEarly.customer_facing_description || (importLineDesc || null),
    }
    if (
      backfillOd.qty_type ||
      backfillOd.quantity_unit ||
      backfillOd.weight_per_roll_kg ||
      backfillOd.customer_facing_description
    ) {
      loadedSpec0 = mergeOrderDefaultsIntoSpec(loadedSpec0, backfillOd)
    }
    loadedOrderDefaultsRef.current = getSpecOrderDefaults(loadedSpec0)
    const rawQu = String(prefsEarly.quantity_unit || js?.quantity_unit || '').toLowerCase()
    const rawQt = persistedQtyTypeFromPrefs(prefsEarly, String(js?.quantity_unit || ''))
    if (isImportDraft && (rawQu === 'rolls' || String(rawQt || '') === 'total_rolls')) {
      loadedSpec0 = {
        ...loadedSpec0,
        identity: { ...loadedSpec0.identity, finish_mode: 'Rolls' },
      }
    }
    setSpec(loadedSpec0)
    const extLegacy =
      loadedSpec0.identity?.production_extruder_code != null &&
      String(loadedSpec0.identity.production_extruder_code).trim() !== ''
        ? String(loadedSpec0.identity.production_extruder_code).trim()
        : ''
    const loadedExtruder = extFromRow || extLegacy
    setProductionExtruderCode(loadedExtruder)
    extruderUserTouchedRef.current = !!loadedExtruder
    const fm: FinishMode = loadedSpec0.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
    const pt = String(loadedSpec0.identity?.product_type || 'Bag')
    const lenRaw = String(loadedSpec0.dimensions?.length_units || '')
    const continuousLength =
      pt === 'Tube' || lenRaw === 'Continuous' || lenRaw.toLowerCase() === 'continuous'
    let qt: QtyType
    if (isImportDraft) {
      if (continuousLength && rawQt === 'rolls_units') {
        qt = 'kg'
      } else {
        qt = rawQt
      }
    } else {
      qt = coerceQtyTypeForFinishMode(fm, rawQt, continuousLength)
    }
    let qtResolved: QtyType = qt
    if (isImportDraft && rawQu === 'rolls' && qtResolved === 'total_rolls') {
      qtResolved = 'rolls_units'
    }
    const nrStored = js?.num_rolls != null ? Math.max(1, Number(js.num_rolls)) : 1
    const wpr =
      prefsEarly.weight_per_roll_kg != null && Number.isFinite(Number(prefsEarly.weight_per_roll_kg))
        ? String(prefsEarly.weight_per_roll_kg)
        : js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
          ? String(js.weight_per_roll_kg)
          : ''
    const quRawLower = String(js?.quantity_unit || '').toLowerCase()

    let cartonQtyMode: '1000' | 'ctn' = '1000'
    let numCartonsHydrate = ''
    if (fm === 'Cartons' && qtResolved === 'units') {
      if (quRawLower === 'cartons') {
        cartonQtyMode = 'ctn'
        numCartonsHydrate =
          js?.quantity_value != null && String(js.quantity_value).trim() !== ''
            ? String(Math.max(0, Math.round(Number(js.quantity_value))))
            : ''
      } else {
        cartonQtyMode = '1000'
      }
    }

    let totalKgH = ''
    let numRollsH = String(nrStored)
    let weightPerRollH = wpr
    let numUnitsH = ''
    let unitsPerRollH = ''
    const metersPerRollH = ''

    if (qtResolved === 'kg') {
      totalKgH = String(js?.quantity_value ?? '')
      numUnitsH = ''
      unitsPerRollH = ''
      numRollsH = String(nrStored)
      weightPerRollH = wpr
    } else if (qtResolved === 'units') {
      if (quRawLower === 'cartons' && js?.num_product_units != null) {
        numUnitsH = String(js.num_product_units)
      } else if (quRawLower === '1000' && js?.num_product_units != null) {
        numUnitsH = String(Math.max(0, Math.round(Number(js.num_product_units))))
      } else {
        numUnitsH = String(js?.num_product_units ?? js?.quantity_value ?? '')
      }
      totalKgH = ''
      unitsPerRollH = ''
      numRollsH = String(nrStored)
      weightPerRollH = wpr
    } else if (qtResolved === 'rolls_units') {
      numRollsH = String(nrStored)
      totalKgH = ''
      numUnitsH = ''
      const npu = js?.num_product_units != null ? Number(js.num_product_units) : NaN
      unitsPerRollH =
        Number.isFinite(npu) && npu > 0 && nrStored > 0 ? String(Math.max(1, Math.round(npu / nrStored))) : ''
      weightPerRollH = wpr
    } else {
      unitsPerRollH = ''
      numRollsH = String(js?.num_rolls ?? js?.quantity_value ?? nrStored)
      weightPerRollH = wpr
      totalKgH = ''
      numUnitsH = ''
    }

    qty.hydrate({
      qtyType: qtResolved,
      cartonQtyMode,
      totalKg: totalKgH,
      numRolls: numRollsH,
      weightPerRoll: weightPerRollH,
      numUnits: numUnitsH,
      unitsPerRoll: unitsPerRollH,
      metersPerRoll: metersPerRollH,
      numCartons: numCartonsHydrate,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `qty.hydrate` is stable; listing `qty` reruns on every render.
  }, [mode, jobSheetId, jobSheetDetail])

  // New mode: when customer changes, reset draft product spec and quantity drivers
  useEffect(() => {
    if (mode !== 'new') return
    setProductId(NEW_PRODUCT_DRAFT_VALUE)
    setProductInfo(null)
    setSpec(makeDefaultSpec())
    setSpecDirty(false)
    setSaveMsg(null)
    qty.resetNewDraft()
    extruderUserTouchedRef.current = false
    setProductionExtruderCode('')
    setProductionStatus('planned')
    setProductionStartedLocal('')
    setProductionFinishedLocal('')
    loadedOrderDefaultsRef.current = getSpecOrderDefaults(makeDefaultSpec())
  }, [customerId, mode, qty.resetNewDraft])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const previewProductCode = useMemo(() => getDisplayProductCodeFromSpec(spec), [spec])

  const finishMode = qty.finishMode

  useEffect(() => {
    const cur = getSpecOrderDefaults(spec).customer_overproduction_handling
    if (cur == null) return
    const next = normalizeCustomerOverproductionHandling(cur, finishMode)
    if (cur === next) return
    setSpec((prev: SpecPayload) => mergeOrderDefaultsIntoSpec(prev, { customer_overproduction_handling: next }))
    if (mode === 'edit') setSpecDirty(true)
    setDirty(true)
  }, [finishMode])

  const effectiveQtyType = qty.effectiveQtyType
  const derivedForDisplay = qty.derivedForDisplay

  const totalKgNum = Number(qty.totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(qty.numRolls || 0)))
  const weightPerRollNum = Number(qty.weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(qty.numUnits || 0)))
  const numCartonsNum = Math.max(0, Math.round(Number(qty.numCartons || 0)))
  const unitsPerRollNum = Math.max(0, Math.round(Number(qty.unitsPerRoll || 0)))

  const derivedDisplay = derivedForDisplay
    ? {
        derivedTotalKg: derivedForDisplay.derivedTotalKg ?? null,
        units: derivedForDisplay.units ?? null,
        kgPerRoll: derivedForDisplay.kgPerRoll ?? null,
      }
    : null

  const totalKgDisplay = computeTotalKgDisplay(
    effectiveQtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    numUnitsNum,
    derivedDisplay,
  )

  const extruderSuggestion = useMemo(
    () => suggestSmallestFittingExtruderCode(spec, ratebook ?? null),
    [spec, ratebook],
  )

  const stockPlanningTotalUnits = qty.stockPlanningTotalUnits

  useEffect(() => {
    if (extruderUserTouchedRef.current) return
    const suggested = extruderSuggestion.extruderCode
    if (!suggested) return
    const current = productionExtruderCode.trim()
    if (!current) {
      setProductionExtruderCode(suggested)
      return
    }
    if (!extruderCodeIsSelectableForSpec(current, spec, ratebook ?? null)) {
      setProductionExtruderCode(suggested)
    }
  }, [productionExtruderCode, extruderSuggestion.extruderCode, spec, ratebook])

  const estimatedUnitsPerPalletVolume = useMemo(
    () =>
      estimateUnitsPerPalletVolumeFromLiveSpec({
        ratebook: ratebook ?? null,
        spec,
        quickInputs: qty.quickInputs ?? null,
        extruderCode: extruderCodeForQty,
      }),
    [ratebook, spec, qty.quickInputs, extruderCodeForQty],
  )

  const livePreviewProps = useJobSheetLivePreviewProps({
    spec,
    qty,
    customerId,
    orderDate,
    dueDate,
    showJobFields: true,
    jobSheetId: mode === 'edit' ? jobSheetId : null,
    loadedJobSheet: (loadedJobSheet as Record<string, unknown> | undefined) ?? null,
    jobSheetDetailData: jobSheetDetail?.data ?? null,
    productionExtruderCode,
    includeProductionEstimates: true,
  })

  const jobSheetPrintingContext: JobSheetPrintingContext = useMemo(() => {
    const customerLabel = livePreviewProps.customerName || '—'
    const importLine = (jobSheetDetail?.data as { myob_import_line_description?: string } | null | undefined)
      ?.myob_import_line_description
    const fromImport = typeof importLine === 'string' && importLine.trim() ? importLine.trim() : ''
    const fromSpec = livePreviewProps.description
    const fromInfo = mode === 'edit' ? hideMyobProductPlaceholderText((productInfo?.description as string | null | undefined) || '') : ''
    const fromUser = customerFacingDescriptionFromSpec(spec).trim()
    const productDescription = fromUser || fromImport || (fromSpec || fromInfo) || '—'
    const jobNo =
      mode === 'edit' && loadedJobSheet?.job_no != null && String(loadedJobSheet.job_no).trim()
        ? String(loadedJobSheet.job_no).trim()
        : ''
    return {
      customerLabel,
      productDescription,
      invoiceNo: (livePreviewProps.invoiceNo || '').trim() || undefined,
      jobCode: jobNo || undefined,
      purchaseOrderNo: (livePreviewProps.purchaseOrderNo || '').trim() || undefined,
      orderNumber: orderId.trim() || '—',
      orderDateLabel: orderDate.trim() || '—',
      dueDateLabel: dueDate.trim() || '—',
      totalMetersLabel: qty.totalMetersReadonly,
    }
  }, [
    livePreviewProps.customerName,
    livePreviewProps.description,
    livePreviewProps.invoiceNo,
    spec,
    jobSheetDetail?.data,
    mode,
    productInfo,
    orderId,
    orderDate,
    dueDate,
    qty.totalMetersReadonly,
    loadedJobSheet,
  ])

  async function onSave(): Promise<boolean> {
    setSaveMsg(null)
    setSaveErr(null)
    setSpecFieldErrors({})

    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (!productId) missing.push('Product')
    if (missing.length > 0) {
      setSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return false
    }
    const totalKgForScheduling =
      finishMode === 'Cartons' && !(totalKgNum > 0) && totalKgDisplay != null && Number(totalKgDisplay) > 0
        ? Number(totalKgDisplay)
        : totalKgNum
    const qtyErr = validateJobSheetQuantityInputs(
      finishMode,
      effectiveQtyType,
      totalKgForScheduling,
      numUnitsNum,
      numRollsNum,
      finishMode === 'Cartons' ? (cartonsWeightPerRollKg(totalKgForScheduling, numRollsNum) ?? 0) : weightPerRollNum,
      unitsPerRollNum,
    )
    if (qtyErr) {
      setSaveErr(qtyErr)
      return false
    }
    if (savingJobSheet) return false

    const sendProdDates = productionStatusShowsDatetimeFields(productionStatus)
    let specForSave = sanitizeSpecFormulationMixes(JSON.parse(JSON.stringify(spec)) as SpecPayload)

    try {
      setSavingJobSheet(true)

      const persistedRolls = resolveNumRollsForPersistence(
        finishMode,
        effectiveQtyType,
        totalKgNum,
        numRollsNum,
        weightPerRollNum,
        derivedDisplay,
      )
      const persistedWpr = resolveWeightPerRollForPersistence(
        finishMode,
        effectiveQtyType,
        totalKgForScheduling,
        numRollsNum,
        weightPerRollNum,
        derivedDisplay,
      )
      const fallbackLegacy = Number(loadedJobSheet?.quantity_value) > 0 ? Number(loadedJobSheet?.quantity_value) : 1
      const bpc = spec.packaging?.bags_per_carton
      const bpcNum = bpc != null ? Number(bpc) : null
      const resolvedProductUnits = resolvedProductUnitsForOrder(numUnitsNum, numCartonsNum, bpcNum)
      const oq = getOrderQuantityFromJobSheetFields(
        effectiveQtyType,
        fallbackLegacy,
        totalKgForScheduling,
        numUnitsNum,
        persistedRolls,
        finishMode,
        bpcNum,
        finishMode === 'Cartons' ? qty.cartonQtyMode : undefined,
        numCartonsNum,
      )

      const orderDefaultsPatch = buildOrderDefaultsFromEditor({
        effectiveQtyType,
        finishMode,
        weightPerRollNum: persistedWpr ?? weightPerRollNum,
        customerFacingDescription: customerFacingDescriptionFromSpec(spec),
        bagsPerCarton: bpc != null ? Number(bpc) : null,
        cartonQtyMode: qty.cartonQtyMode,
        customerOverproductionHandling: customerOverproductionFromSpec(spec, finishMode),
      })
      specForSave = mergeOrderDefaultsIntoSpec(specForSave, orderDefaultsPatch)
      const orderDefaultsDirty = !orderDefaultsEqual(loadedOrderDefaultsRef.current, orderDefaultsPatch)

      let effectiveProductId = productId
      if (mode === 'new' && productId === NEW_PRODUCT_DRAFT_VALUE) {
        const code = previewProductCode.trim()
        if (!code) {
          setSaveErr('Complete the product spec so a product code is generated before saving.')
          setSavingJobSheet(false)
          return false
        }
        dispatch(clearCreateErrors())
        try {
          const created = await dispatch(
            createProduct({
              data: {
                customer_id: customerId,
                code,
                spec: specForSave,
              },
            }),
          ).unwrap()
          const pid = created?.product?.id as string | undefined
          if (!pid) throw new Error('Product was created but no id was returned')
          effectiveProductId = pid
          setProductId(pid)
          setProductInfo({
            id: pid,
            code,
            description: computeProductDescriptionFromSpec(spec),
            customer_id: customerId,
            active_version_id: (created?.version?.id as string | undefined) ?? null,
          })
          await dispatch(fetchProducts({ customer_id: customerId })).unwrap()
        } catch (e: unknown) {
          if (isRejectedWithValue(e)) {
            const p = e.payload as UpsertError
            setSpecFieldErrors(p.fieldErrors || {})
            setSaveErr(p.message || 'Please fix the highlighted fields and try again.')
          } else if (e instanceof ApiError && e.body?.detail != null) {
            const { fieldErrors, messages } = parseFastApiValidationDetail(e.body.detail)
            setSpecFieldErrors(fieldErrors)
            setSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
          } else {
            setSpecFieldErrors({})
            setSaveErr(e instanceof Error ? e.message : 'Failed to create product')
          }
          setSavingJobSheet(false)
        return false
        }
      }

      if (mode === 'new') {
        const res = await dispatch(
          createJobSheet({
            customer_id: customerId,
            product_id: effectiveProductId,
            due_date: dueDate.trim() ? dueDate : null,
            ...(orderDate ? { order_date: orderDate } : {}),
            quantity_value: oq.quantity_value,
            quantity_unit: oq.quantity_unit,
            qty_type: effectiveQtyType,
            num_product_units:
              effectiveQtyType === 'units' || finishMode === 'Cartons'
                ? resolvedProductUnits > 0
                  ? resolvedProductUnits
                  : derivedForDisplay?.units != null
                    ? Math.round(Number(derivedForDisplay.units))
                    : null
                : derivedForDisplay?.units != null
                  ? Math.round(Number(derivedForDisplay.units))
                  : null,
            weight_per_roll_kg: persistedWpr,
            num_rolls: persistedRolls,
            spec: specForSave,
            production_status: productionStatus,
            production_started_at: sendProdDates ? datetimeLocalToIsoUtc(productionStartedLocal) : null,
            production_finished_at: sendProdDates ? datetimeLocalToIsoUtc(productionFinishedLocal) : null,
            production_extruder_code: productionExtruderCode.trim() || null,
          }),
        ).unwrap()
        const id = res?.job_sheet?.id
        if (res?.job_sheet?.order_id) setOrderId(String(res.job_sheet.order_id))
        if (res?.job_sheet?.order_date) setOrderDate(String(res.job_sheet.order_date).slice(0, 10))
        setSaveMsg('Saved job sheet.')
        setDirty(false)
        if (id) nav(returnTo || `/job-sheets/${encodeURIComponent(id)}/edit`)
        return true
      } else {
        if (!jobSheetId) throw new Error('Missing job sheet id')
        const body: Record<string, unknown> = {
          due_date: dueDate.trim() ? dueDate : null,
          order_date: orderDate || null,
          quantity_value: oq.quantity_value,
          quantity_unit: oq.quantity_unit,
          qty_type: effectiveQtyType,
          num_product_units:
            effectiveQtyType === 'units' || finishMode === 'Cartons'
              ? resolvedProductUnits > 0
                ? resolvedProductUnits
                : derivedForDisplay?.units != null
                  ? Math.round(Number(derivedForDisplay.units))
                  : null
              : derivedForDisplay?.units != null
                ? Math.round(Number(derivedForDisplay.units))
                : null,
          weight_per_roll_kg: persistedWpr,
          num_rolls: persistedRolls,
          production_status: productionStatus,
          production_started_at: sendProdDates ? datetimeLocalToIsoUtc(productionStartedLocal) : null,
          production_finished_at: sendProdDates ? datetimeLocalToIsoUtc(productionFinishedLocal) : null,
          production_extruder_code: productionExtruderCode.trim() || null,
        }
        if (specDirty || orderDefaultsDirty) body.spec = specForSave
        const res = await dispatch(updateJobSheet({ jobSheetId, body })).unwrap()
        if (res?.job_sheet?.order_id) setOrderId(String(res.job_sheet.order_id))
        if (res?.job_sheet?.order_date) setOrderDate(String(res.job_sheet.order_date).slice(0, 10))
        setSaveMsg('Saved job sheet.')
        setSpecDirty(false)
        setDirty(false)
        if (specDirty || orderDefaultsDirty) {
          setSpec(ensureSpec(specForSave))
          loadedOrderDefaultsRef.current = getSpecOrderDefaults(specForSave)
        }
        await dispatch(fetchJobSheet(jobSheetId)).unwrap()
        return true
      }
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setSpecFieldErrors(p.fieldErrors || {})
        setSaveErr(p.message || 'Please fix the highlighted fields and try again.')
      } else if (e instanceof ApiError && e.body?.detail != null) {
        const { fieldErrors, messages } = parseFastApiValidationDetail(e.body.detail)
        setSpecFieldErrors(fieldErrors)
        setSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
      } else {
        setSpecFieldErrors({})
        setSaveErr(e instanceof Error ? e.message : 'Failed to save job sheet')
      }
      return false
    } finally {
      setSavingJobSheet(false)
    }
  }

  async function onSaveAsNewProduct(): Promise<boolean> {
    setSaveMsg(null)
    setSaveErr(null)
    setSpecFieldErrors({})

    if (mode !== 'edit' || !jobSheetId) return false

    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (!productId) missing.push('Product')
    if (missing.length > 0) {
      setSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return false
    }
    const totalKgForScheduling =
      qty.finishMode === 'Cartons' && !(Number(qty.totalKg || 0) > 0) && qty.totalKgDisplay != null && Number(qty.totalKgDisplay) > 0
        ? Number(qty.totalKgDisplay)
        : Number(qty.totalKg || 0)
    const numRollsNum = Math.max(0, Math.round(Number(qty.numRolls || 0)))
    const weightPerRollNum = Number(qty.weightPerRoll || 0)
    const numUnitsNum = Math.max(0, Math.round(Number(qty.numUnits || 0)))
    const derivedForDisplay = qty.derivedForDisplay
    const qtyErr = validateJobSheetQuantityInputs(
      qty.finishMode,
      qty.effectiveQtyType,
      totalKgForScheduling,
      numUnitsNum,
      numRollsNum,
      qty.finishMode === 'Cartons' ? (cartonsWeightPerRollKg(totalKgForScheduling, numRollsNum) ?? 0) : weightPerRollNum,
      Math.max(0, Math.round(Number(qty.unitsPerRoll || 0))),
    )
    if (qtyErr) {
      setSaveErr(qtyErr)
      return false
    }
    if (savingJobSheet || savingAsNew) return false

    const sendProdDates = productionStatusShowsDatetimeFields(productionStatus)
    let specForSave = sanitizeSpecFormulationMixes(JSON.parse(JSON.stringify(spec)) as SpecPayload)

    try {
      setSavingAsNew(true)

      const totalKgNum = Number(qty.totalKg || 0)
      const persistedRolls = resolveNumRollsForPersistence(
        qty.finishMode,
        qty.effectiveQtyType,
        totalKgNum,
        numRollsNum,
        weightPerRollNum,
        derivedForDisplay,
      )
      const persistedWpr = resolveWeightPerRollForPersistence(
        qty.finishMode,
        qty.effectiveQtyType,
        totalKgForScheduling,
        numRollsNum,
        weightPerRollNum,
        derivedForDisplay,
      )
      const fallbackLegacy = Number(loadedJobSheet?.quantity_value) > 0 ? Number(loadedJobSheet?.quantity_value) : 1
      const bpc = spec.packaging?.bags_per_carton
      const bpcNum = bpc != null ? Number(bpc) : null
      const resolvedProductUnitsSaveAsNew = resolvedProductUnitsForOrder(numUnitsNum, numCartonsNum, bpcNum)
      const oq = getOrderQuantityFromJobSheetFields(
        qty.effectiveQtyType,
        fallbackLegacy,
        totalKgForScheduling,
        numUnitsNum,
        persistedRolls,
        qty.finishMode,
        bpcNum,
        qty.finishMode === 'Cartons' ? qty.cartonQtyMode : undefined,
        numCartonsNum,
      )

      const orderDefaultsPatch = buildOrderDefaultsFromEditor({
        effectiveQtyType: qty.effectiveQtyType,
        finishMode: qty.finishMode,
        weightPerRollNum: persistedWpr ?? weightPerRollNum,
        customerFacingDescription: customerFacingDescriptionFromSpec(spec),
        bagsPerCarton: bpc != null ? Number(bpc) : null,
        cartonQtyMode: qty.cartonQtyMode,
        customerOverproductionHandling: customerOverproductionFromSpec(spec, qty.finishMode),
      })
      specForSave = mergeOrderDefaultsIntoSpec(specForSave, orderDefaultsPatch)

      const body: Record<string, unknown> = {
        due_date: dueDate.trim() ? dueDate : null,
        order_date: orderDate || null,
        quantity_value: oq.quantity_value,
        quantity_unit: oq.quantity_unit,
        qty_type: qty.effectiveQtyType,
        num_product_units:
          qty.effectiveQtyType === 'units' || qty.finishMode === 'Cartons'
            ? resolvedProductUnitsSaveAsNew > 0
              ? resolvedProductUnitsSaveAsNew
              : derivedForDisplay?.units != null
                ? Math.round(Number(derivedForDisplay.units))
                : null
            : derivedForDisplay?.units != null
              ? Math.round(Number(derivedForDisplay.units))
              : null,
        weight_per_roll_kg: persistedWpr,
        num_rolls: persistedRolls,
        spec: specForSave,
        production_status: productionStatus,
        production_started_at: sendProdDates ? datetimeLocalToIsoUtc(productionStartedLocal) : null,
        production_finished_at: sendProdDates ? datetimeLocalToIsoUtc(productionFinishedLocal) : null,
        production_extruder_code: productionExtruderCode.trim() || null,
      }

      const res = await dispatch(saveJobSheetAsNewProduct({ jobSheetId, body })).unwrap()
      const newPid = String(res.product_id || '').trim()
      if (!newPid) throw new Error('New product was created but no id was returned')

      lastJobDetailDataRef.current = null
      setProductId(newPid)
      const js = res.job_sheet
      setProductInfo({
        id: newPid,
        code: String(js?.product_code || getDisplayProductCodeFromSpec(specForSave)),
        description: computeProductDescriptionFromSpec(specForSave),
        customer_id: customerId,
        active_version_id: String(res.product_version_id || js?.product_version_id || ''),
      })

      await dispatch(fetchProduct(newPid)).unwrap()
      await dispatch(fetchJobSheet(jobSheetId)).unwrap()
      if (customerId) await dispatch(fetchProducts({ customer_id: customerId })).unwrap()

      setSaveMsg('Saved as new product. You are now editing the new product.')
      setSpecDirty(false)
      setDirty(false)
      setSpec(ensureSpec(specForSave))
      return true
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setSpecFieldErrors(p.fieldErrors || {})
        setSaveErr(p.message || 'Failed to save as new product')
      } else if (e instanceof ApiError && e.body?.detail != null) {
        const { fieldErrors, messages } = parseFastApiValidationDetail(e.body.detail)
        setSpecFieldErrors(fieldErrors)
        setSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
      } else {
        setSpecFieldErrors({})
        setSaveErr(e instanceof Error ? e.message : 'Failed to save as new product')
      }
      return false
    } finally {
      setSavingAsNew(false)
    }
  }

  async function onBeforeOpenPrintPreview(): Promise<boolean> {
    if (savingJobSheet) return false
    if (mode !== 'edit' || !jobSheetId) return true
    // Persist latest edits before opening the printable job sheet (Print button / shortcut).
    return await onSave()
  }

  async function onPrintJobSheet(): Promise<void> {
    if (savingJobSheet || !jobSheetId) return
    const ok = await onBeforeOpenPrintPreview()
    if (!ok) return
    nav(`/job-sheets/${encodeURIComponent(jobSheetId)}/print`)
  }

  const onPrintJobSheetRef = useRef(onPrintJobSheet)
  onPrintJobSheetRef.current = onPrintJobSheet

  useEffect(() => {
    if (mode !== 'edit' || !jobSheetId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      void onPrintJobSheetRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, jobSheetId])

  const disableIdentity = mode === 'edit'
  /** Quantity is always edited in the Product Spec area (embedded paper), not in the header card. */
  const includeQuantityInHeader = false

  const canSaveAsNewProduct = canEnableSaveAsNewProduct({
    jobSheetVersionNumber:
      loadedJobSheet?.version_number != null ? Number(loadedJobSheet.version_number) : null,
  })

  const bagsPerCartonStr = spec.packaging?.bags_per_carton != null ? String(spec.packaging.bags_per_carton) : ''

  /** Header card omits quantity (`includeQuantityInHeader` is false); keep shape for typing only. */
  const jobSheetQuantityFieldsProps: JobSheetQuantityFieldsProps = {
    productUnitLabel: qty.productUnitLabel,
    productTypeIsBag: qty.productTypeIsBag,
    showRollsUnitsQtyType: !qty.isContinuousLength,
    finishMode: qty.finishMode,
    effectiveQtyType: qty.effectiveQtyType,
    onQtyTypeChange: () => {},
    totalMetersReadonly: qty.totalMetersReadonly,
    totalKgField: { value: '', disabled: true, required: false },
    rollOrCartonSizingField: {
      rollsLabel: `${qty.productUnitLabel} per roll`,
      rollsValue: '',
      rollsDisabled: true,
      rollsInputStep: 1,
      cartonsLabel: `${qty.productUnitLabel} per Carton`,
      cartonsValue: bagsPerCartonStr,
      cartonsOnChange: () => {},
    },
    weightPerRollField: { value: '', disabled: true },
    numRollsField: { value: '', disabled: true, required: false },
    totalProductsField: { value: '', disabled: true },
  }

  function renderJobSheetActions() {
    const cancelTo = mode === 'edit' && jobSheetId ? `/job-sheets/${jobSheetId}` : '/job-sheets'
    return (
      <>
        <Button variant="text" color="primary" component={Link} to={returnTo || cancelTo}>
          Cancel
        </Button>
        {mode === 'edit' && orderId ? (
          <Button variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(orderId)}/edit`}>
            View Order
          </Button>
        ) : null}
        {mode === 'edit' && jobSheetId ? (
          <SaveAsNewProductButton
            onClick={() => void onSaveAsNewProduct()}
            disabled={savingJobSheet || savingAsNew || !canSaveAsNewProduct}
            saving={savingAsNew}
          />
        ) : null}
        <SaveFormButton
          variant="outlined"
          onClick={onSave}
          disabled={savingJobSheet || savingAsNew}
          saving={savingJobSheet}
          label={mode === 'new' ? 'Save job sheet' : 'Save'}
        />
        {mode === 'edit' && jobSheetId ? (
          <Button
            variant="contained"
            color="primary"
            type="button"
            onClick={() => void onPrintJobSheet()}
            disabled={savingJobSheet || savingAsNew}
            startIcon={<PrintIcon />}
          >
            Print
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <Box onChange={() => setDirty(true)}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
        {(createState.error || saveErr) && <Alert severity="error">{createState.error || saveErr}</Alert>}
        {saveMsg && <Alert severity="success">{saveMsg}</Alert>}

        <JobSheetIdentityQuantitySection
          jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : null}
          invoiceNo={livePreviewProps.invoiceNo}
          purchaseOrderNo={livePreviewProps.purchaseOrderNo}
          headerActions={renderJobSheetActions()}
          customerId={customerId}
          onCustomerIdChange={(id) => {
            setCustomerId(id)
            setDirty(true)
          }}
          customerSelectDisabled={disableIdentity}
          orderDate={orderDate}
          onOrderDateChange={(v) => {
            setOrderDate(v)
            setDirty(true)
          }}
          dueDate={dueDate}
          onDueDateChange={(v) => {
            setDueDate(v)
            setDirty(true)
          }}
          orderDateInputRef={orderDateInputRef}
          dueDateInputRef={dueDateInputRef}
          includeQuantity={includeQuantityInHeader}
          productionStatus={productionStatus}
          onProductionStatusChange={(v) => {
            setProductionStatus(v)
            setDirty(true)
          }}
          productionStartedLocal={productionStartedLocal}
          onProductionStartedLocalChange={(v) => {
            setProductionStartedLocal(v)
            setDirty(true)
          }}
          productionFinishedLocal={productionFinishedLocal}
          onProductionFinishedLocalChange={(v) => {
            setProductionFinishedLocal(v)
            setDirty(true)
          }}
          {...jobSheetQuantityFieldsProps}
          productRow={
            mode === 'edit' && productId ? (
              <MuiLink
                component="button"
                type="button"
                underline="hover"
                sx={{ fontSize: '0.875rem', verticalAlign: 'baseline', textAlign: 'left' }}
                disabled={savingJobSheet}
                onClick={async (e) => {
                  e.preventDefault()
                  const ok = await onSave()
                  if (!ok) return
                  nav(`/products/${encodeURIComponent(productId)}`)
                }}
              >
                View product versions
              </MuiLink>
            ) : null
          }
        />

        {isNarrow ? <JobSheetLivePreview panelProps={livePreviewProps} /> : null}

        {mode === 'edit' || mode === 'new' ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Product Spec
            </Typography>

            <SpecPayloadForm
              customerId={customerId || undefined}
              printingSurface="job_sheet_summary"
              printingArtworkScope={mode === 'edit' && jobSheetId ? { kind: 'job_sheet', jobSheetId } : null}
              jobSheetPrintingContext={jobSheetPrintingContext}
              estimatedUnitsPerPalletVolume={estimatedUnitsPerPalletVolume}
              stockPlanningTotalUnits={stockPlanningTotalUnits}
              customerFacingDescription={customerFacingDescriptionFromSpec(spec)}
              onCustomerFacingDescriptionChange={(raw) => {
                setSpec((prev: SpecPayload) =>
                  mergeOrderDefaultsIntoSpec(prev, {
                    customer_facing_description: raw.trim() === '' ? null : raw,
                  }),
                )
                setSpecDirty(true)
                setSpecFieldErrors({})
                setDirty(true)
              }}
              customerFacingDescriptionPlaceholder={livePreviewProps.description}
              value={spec}
              fieldErrors={specFieldErrors}
              onChange={(next) => {
                setSpec(next)
                setSpecDirty(true)
                setSpecFieldErrors({})
                setDirty(true)
              }}
              afterDimensionsSlot={
                <>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Extruder
                    </Typography>
                    <ProductionExtruderSelect
                      labelId="job-sheet-production-extruder-label"
                      value={productionExtruderCode}
                      spec={spec}
                      ratebook={ratebook ?? null}
                      hintLine={extruderSuggestion.hintLine}
                      onUserTouched={() => {
                        extruderUserTouchedRef.current = true
                      }}
                      onChange={(code) => {
                        setProductionExtruderCode(code)
                        setDirty(true)
                      }}
                    />
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 2,
                        flexWrap: 'wrap',
                        mb: 2,
                      }}
                    >
                      <Typography variant="h6">Quantity</Typography>
                      {mode === 'edit' && orderId.trim() ? (
                        <MuiLink
                          component={Link}
                          to={`/orders/${encodeURIComponent(orderId)}/edit`}
                          underline="hover"
                          variant="body2"
                          sx={{ flexShrink: 0 }}
                        >
                          View order
                        </MuiLink>
                      ) : null}
                    </Box>
                    <LinkedQuantityFields
                      qty={qty}
                      hideCartonRollWeight={finishMode === 'Cartons'}
                      bagsPerCartonStr={bagsPerCartonStr}
                      onBagsPerCartonChange={(raw) => {
                        setSpec((prev: SpecPayload) => ({
                          ...prev,
                          packaging: {
                            ...prev.packaging,
                            bags_per_carton: raw.trim() === '' ? null : Math.max(1, Math.round(Number(raw))),
                          },
                        }))
                        if (mode === 'edit') setSpecDirty(true)
                        setDirty(true)
                      }}
                    />
                    {finishMode === 'Cartons' ? <CartonRollWeightField qty={qty} /> : null}
                    <CustomerOverproductionHandlingField
                      spec={spec}
                      finishMode={finishMode}
                      productType={spec.identity?.product_type}
                      onSpecChange={(next) => {
                        setSpec(next)
                        if (mode === 'edit') setSpecDirty(true)
                        setDirty(true)
                      }}
                    />
                  </Paper>
                </>
              }
            />
          </Paper>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>{renderJobSheetActions()}</Box>
        </Stack>

        {!isNarrow ? <JobSheetLivePreview panelProps={livePreviewProps} wrapInAside /> : null}
      </Box>

    </Box>
  )
}


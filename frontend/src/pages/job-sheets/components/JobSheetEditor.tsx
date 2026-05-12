import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../../../store/slices/productsSlice'
import { Link, useNavigate } from 'react-router-dom'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import {
  coerceQtyTypeForFinishMode,
  computeTotalKgDisplay,
  getOrderQuantityFromJobSheetFields,
  resolveNumRollsForPersistence,
  resolveWeightPerRollForPersistence,
  validateJobSheetQuantityInputs,
  cartonsWeightPerRollKg,
  qtyTypeFromPersisted,
  type FinishMode,
  type QtyType,
} from '../../../utils/quantityRollFields'
import PrintIcon from '@mui/icons-material/Print'
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Paper,
  Select,
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
import { fetchCustomers, CUSTOMER_PICKER_PAGE_SIZE } from '../../../store/slices/customersSlice'
import { clearCreateErrors, createProduct, fetchProducts } from '../../../store/slices/productsSlice'
import { createJobSheet, fetchJobSheet, updateJobSheet } from '../../../store/slices/jobSheetsSlice'
import { computeProductDescriptionFromSpec, getDisplayProductCodeFromSpec } from '../../../utils/productDescription'
import {
  joinQuoteDescriptionWithPackagingTail,
  quotePackagingPerUnitTail,
  type QuoteQtyMode,
} from '../../../utils/quoteQuantityDescriptors'
import { JobSheetPreviewPanel } from '../../../components/JobSheetPreviewPanel'
import {
  makeDefaultSpec,
  SpecPayloadForm,
  type JobSheetPrintingContext,
  type SpecPayload,
} from '../../../components/SpecPayloadForm'
import { sanitizeSpecFormulationMixes } from '../../../utils/specFormulationSanitize'
import { StickySideAside } from '../../../components/StickySideAside'
import { LinkedQuantityFields } from '../../../components/quantity/LinkedQuantityFields'
import { useSpecLinkedQuantityFields } from '../../../hooks/useSpecLinkedQuantityFields'
import { JobSheetIdentityQuantitySection, productionStatusShowsDatetimeFields, type JobSheetQuantityFieldsProps } from './JobSheetIdentityQuantitySection'
import { computeJobSheetPreviewQuoteSummary } from '../../../utils/jobSheetPreviewQuoteSummary'
import { buildLiveJobSheetRowForOrderQuantityLabel } from '../../../utils/jobSheetQuantityFromApi'
import { suggestSmallestFittingExtruderCode } from '../../../utils/suggestExtruderFromSpec'

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

/** Internal placeholder `Product` row for MYOB import–linked draft job sheets. */
const MYOB_IMPORT_PLACEHOLDER_DESC_RE = /^placeholder for myob import draft job sheets$/i

function hideMyobProductPlaceholderText(s: string | null | undefined): string {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return MYOB_IMPORT_PLACEHOLDER_DESC_RE.test(t) ? '' : t
}

/** `datetime-local` (interpreted as local) → ISO UTC string, or null if empty. */
function datetimeLocalToIsoUtc(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
  if (x === '1000') return 'units'
  if (x === 'cartons' || x === 'bags' || x === 'meters') return 'units'
  return 'units'
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

  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)

  const createState = useAppSelector((s) => s.products.create)
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const loadedJobSheet = mode === 'edit' && jobSheetId ? jobSheetDetail?.data?.job_sheet : undefined
  const { setDirty } = useUnsavedChanges()
  const [savingJobSheet, setSavingJobSheet] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
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
  const [customerFacingDescription, setCustomerFacingDescription] = useState('')
  /** Stored on the linked product (shared across job sheets). */
  const [productionExtruderCode, setProductionExtruderCode] = useState('')
  /** After the user changes the extruder dropdown, do not auto-fill over an explicit empty selection. */
  const extruderUserTouchedRef = useRef(false)

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers({ page: 1, page_size: CUSTOMER_PICKER_PAGE_SIZE, q: '' }))
  }, [customersStatus, dispatch])

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
    extruderUserTouchedRef.current = false
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
    setInvoiceNo(js?.invoice_no ?? '')
    setOrderDate(js?.order_date ? String(js.order_date).slice(0, 10) : '')
    setOrderId(js?.order_id ? String(js.order_id) : '')
    const importLineDesc =
      res && typeof (res as { myob_import_line_description?: string }).myob_import_line_description === 'string'
        ? String((res as { myob_import_line_description?: string }).myob_import_line_description).trim()
        : ''
    const dbCustFacingDesc =
      js?.customer_facing_description != null && String(js.customer_facing_description).trim()
        ? String(js.customer_facing_description).trim()
        : ''
    setCustomerFacingDescription(dbCustFacingDesc || importLineDesc)
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
    const rawQu = String(js?.quantity_unit || '').toLowerCase()
    const rawQt =
      js?.qty_type != null && String(js.qty_type).trim()
        ? qtyTypeFromPersisted(String(js.qty_type))
        : inferQtyTypeFromUnit(js?.quantity_unit)
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
    setProductionExtruderCode(extFromRow || extLegacy)
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
      js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
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

    if (fm === 'Cartons') {
      weightPerRollH = ''
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
    setCustomerFacingDescription('')
  }, [customerId, mode, qty.resetNewDraft])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => getDisplayProductCodeFromSpec(spec), [spec])

  const finishMode = qty.finishMode
  const effectiveQtyType = qty.effectiveQtyType
  const derivedForDisplay = qty.derivedForDisplay

  const totalKgNum = Number(qty.totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(qty.numRolls || 0)))
  const weightPerRollNum = Number(qty.weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(qty.numUnits || 0)))
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

  useEffect(() => {
    if (extruderUserTouchedRef.current) return
    if (productionExtruderCode.trim() !== '') return
    const code = extruderSuggestion.extruderCode
    if (!code) return
    setProductionExtruderCode(code)
  }, [productionExtruderCode, extruderSuggestion.extruderCode])

  const previewJobSheetQuantityRow = useMemo(() => {
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
      mode === 'edit' &&
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
      isImportDraft: Boolean(loadedJobSheet?.is_import_draft),
    })
  }, [
    finishMode,
    effectiveQtyType,
    totalKgNum,
    totalKgDisplay,
    qty.cartonQtyMode,
    numRollsNum,
    weightPerRollNum,
    numUnitsNum,
    derivedDisplay,
    mode,
    loadedJobSheet,
    spec.packaging?.bags_per_carton,
  ])

  const jobSheetPreviewQuoteSummary = useMemo(
    () =>
      computeJobSheetPreviewQuoteSummary(
        spec,
        previewJobSheetQuantityRow,
        ratebook ?? null,
        qty.quickInputs ?? null,
      ),
    [spec, previewJobSheetQuantityRow, ratebook, qty.quickInputs],
  )

  const previewCustomerName = useMemo(() => {
    const c = customers.find((x) => x.id === customerId)
    return (c?.name || '').trim()
  }, [customers, customerId])

  const previewPurchaseOrderNo = useMemo(() => {
    if (mode !== 'edit' || !loadedJobSheet) return ''
    const js = loadedJobSheet as Record<string, unknown>
    const v = js.customer_purchase_order_number ?? js.purchase_order_no
    return v != null && String(v).trim() ? String(v).trim() : ''
  }, [mode, loadedJobSheet])

  const previewNotesLine = useMemo(() => {
    const a = String(spec?.identity?.notes ?? '').trim()
    const b = String(spec?.run_requirements?.notes ?? '').trim()
    return (a || b || '').trim() || null
  }, [spec?.identity?.notes, spec?.run_requirements?.notes])

  const previewQualityFlagIds = useMemo(() => {
    const f = spec?.quality_expectations?.flags
    if (!Array.isArray(f) || f.length === 0) return null
    return f.map((x: unknown) => String(x))
  }, [spec?.quality_expectations?.flags])

  const myobImportLineDescription = useMemo(() => {
    const raw = jobSheetDetail?.data?.myob_import_line_description
    if (raw == null || typeof raw !== 'string') return ''
    return raw.trim()
  }, [jobSheetDetail?.data?.myob_import_line_description])

  const displayProductCode =
    (previewProductCode.trim() || (mode === 'edit' ? (productInfo?.code || '').trim() : '')).trim() || '—'
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
    () =>
      hideMyobProductPlaceholderText(
        joinQuoteDescriptionWithPackagingTail(previewDescription, previewPackagingTail),
      ),
    [previewDescription, previewPackagingTail],
  )

  const jobSheetPrintingContext: JobSheetPrintingContext = useMemo(() => {
    const c = customers.find((x) => x.id === customerId)
    const customerLabel = (c?.name || '').trim() || '—'
    const importLine = (jobSheetDetail?.data as { myob_import_line_description?: string } | null | undefined)
      ?.myob_import_line_description
    const fromImport = typeof importLine === 'string' && importLine.trim() ? importLine.trim() : ''
    const fromSpec = previewDescriptionWithPackagingTail
    const fromInfo = mode === 'edit' ? hideMyobProductPlaceholderText((productInfo?.description as string | null | undefined) || '') : ''
    const fromUser = (customerFacingDescription || '').trim()
    const productDescription = fromUser || fromImport || (fromSpec || fromInfo) || '—'
    const jobNo =
      mode === 'edit' && loadedJobSheet?.job_no != null && String(loadedJobSheet.job_no).trim()
        ? String(loadedJobSheet.job_no).trim()
        : ''
    const poLine =
      mode === 'edit' && loadedJobSheet
        ? String(
            (loadedJobSheet as Record<string, unknown>).customer_purchase_order_number ??
              (loadedJobSheet as Record<string, unknown>).purchase_order_no ??
              '',
          ).trim()
        : ''
    return {
      customerLabel,
      productDescription,
      invoiceNo: (invoiceNo || '').trim() || undefined,
      jobCode: jobNo || undefined,
      purchaseOrderNo: poLine || undefined,
      orderNumber: orderId.trim() || '—',
      orderDateLabel: orderDate.trim() || '—',
      dueDateLabel: dueDate.trim() || '—',
      totalMetersLabel: qty.totalMetersReadonly,
    }
  }, [
    customers,
    customerId,
    customerFacingDescription,
    jobSheetDetail?.data,
    mode,
    previewDescriptionWithPackagingTail,
    productInfo,
    orderId,
    orderDate,
    dueDate,
    qty.totalMetersReadonly,
    invoiceNo,
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
    const specForSave = sanitizeSpecFormulationMixes(JSON.parse(JSON.stringify(spec)) as SpecPayload)

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
      const oq = getOrderQuantityFromJobSheetFields(
        effectiveQtyType,
        fallbackLegacy,
        totalKgForScheduling,
        numUnitsNum,
        persistedRolls,
        finishMode,
        bpc != null ? Number(bpc) : null,
        qty.cartonQtyMode,
      )

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
              effectiveQtyType === 'units'
                ? numUnitsNum
                : derivedForDisplay?.units != null
                  ? Math.round(Number(derivedForDisplay.units))
                  : null,
            weight_per_roll_kg: persistedWpr,
            num_rolls: persistedRolls,
            spec: specForSave,
            production_status: productionStatus,
            production_started_at: sendProdDates ? datetimeLocalToIsoUtc(productionStartedLocal) : null,
            production_finished_at: sendProdDates ? datetimeLocalToIsoUtc(productionFinishedLocal) : null,
            ...(customerFacingDescription.trim()
              ? { customer_facing_description: customerFacingDescription.trim() }
              : {}),
            production_extruder_code: productionExtruderCode.trim() || null,
          }),
        ).unwrap()
        const id = res?.job_sheet?.id
        if (res?.job_sheet?.order_id) setOrderId(String(res.job_sheet.order_id))
        if (res?.job_sheet?.order_date) setOrderDate(String(res.job_sheet.order_date).slice(0, 10))
        if (res?.job_sheet?.invoice_no != null && res?.job_sheet?.invoice_no !== undefined) {
          setInvoiceNo(String(res.job_sheet.invoice_no))
        }
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
            effectiveQtyType === 'units'
              ? numUnitsNum
              : derivedForDisplay?.units != null
                ? Math.round(Number(derivedForDisplay.units))
                : null,
          weight_per_roll_kg: persistedWpr,
          num_rolls: persistedRolls,
          production_status: productionStatus,
          production_started_at: sendProdDates ? datetimeLocalToIsoUtc(productionStartedLocal) : null,
          production_finished_at: sendProdDates ? datetimeLocalToIsoUtc(productionFinishedLocal) : null,
          customer_facing_description: customerFacingDescription.trim() ? customerFacingDescription.trim() : null,
          production_extruder_code: productionExtruderCode.trim() || null,
        }
        if (specDirty) body.spec = specForSave
        const res = await dispatch(updateJobSheet({ jobSheetId, body })).unwrap()
        if (res?.job_sheet?.order_id) setOrderId(String(res.job_sheet.order_id))
        if (res?.job_sheet?.order_date) setOrderDate(String(res.job_sheet.order_date).slice(0, 10))
        if (res?.job_sheet?.invoice_no != null && res?.job_sheet?.invoice_no !== undefined) {
          setInvoiceNo(String(res.job_sheet.invoice_no))
        }
        setSaveMsg('Saved job sheet.')
        setSpecDirty(false)
        setDirty(false)
        if (specDirty) setSpec(ensureSpec(specForSave))
        void dispatch(fetchJobSheet(jobSheetId))
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
    window.open(`/job-sheets/${encodeURIComponent(jobSheetId)}/print`, '_blank', 'noopener,noreferrer')
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
          <Button variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(orderId)}`}>
            View Order
          </Button>
        ) : null}
        <Button variant="outlined" color="primary" onClick={onSave} disabled={savingJobSheet}>
          {savingJobSheet ? 'Saving…' : mode === 'new' ? 'Save job sheet' : 'Save changes'}
        </Button>
        {mode === 'edit' && jobSheetId ? (
          <Button
            variant="contained"
            color="primary"
            type="button"
            onClick={() => void onPrintJobSheet()}
            disabled={savingJobSheet}
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
          invoiceNo={invoiceNo}
          purchaseOrderNo={previewPurchaseOrderNo}
          headerActions={renderJobSheetActions()}
          customers={customers as any}
          customersStatus={customersStatus}
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
            <Box>
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  {mode === 'new' ? 'Customer-facing product code (generated)' : 'Customer-facing product code'}
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-word' }}>
                  {displayProductCode}
                </Typography>
              </Box>
              {mode === 'edit' && productId ? (
                <MuiLink
                  component={Link}
                  to={`/products/${encodeURIComponent(productId)}`}
                  target="_blank"
                  rel="noreferrer"
                  underline="hover"
                  sx={{ display: 'inline-block', mt: 1, fontSize: '0.875rem' }}
                >
                  View product versions
                </MuiLink>
              ) : null}
            </Box>
          }
        />

        {isNarrow ? (
          <JobSheetPreviewPanel
            jobSheetId={mode === 'edit' && jobSheetId ? jobSheetId : null}
            jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : ''}
            customerName={previewCustomerName}
            invoiceNo={invoiceNo}
            purchaseOrderNo={previewPurchaseOrderNo}
            orderDate={orderDate}
            dueDate={dueDate}
            productCode={previewProductCode}
            description={previewDescriptionWithPackagingTail}
            myobImportLineDescription={myobImportLineDescription}
            customerFacingDescription={customerFacingDescription}
            notes={previewNotesLine}
            qualityFlagIds={previewQualityFlagIds}
            quoteSummary={jobSheetPreviewQuoteSummary}
          />
        ) : null}

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
              customerFacingDescription={customerFacingDescription}
              onCustomerFacingDescriptionChange={(v) => {
                setCustomerFacingDescription(v)
                setDirty(true)
              }}
              customerFacingDescriptionPlaceholder={previewDescriptionWithPackagingTail}
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
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small" sx={{ maxWidth: 520 }}>
                        <InputLabel id="job-sheet-production-extruder-label">Extruder</InputLabel>
                        <Select
                          labelId="job-sheet-production-extruder-label"
                          label="Extruder"
                          value={productionExtruderCode.trim() !== '' ? productionExtruderCode.trim() : ''}
                          onChange={(e) => {
                            extruderUserTouchedRef.current = true
                            const v = String(e.target.value || '').trim()
                            setProductionExtruderCode(v)
                            setDirty(true)
                          }}
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {(Array.isArray(ratebook?.extruders) ? ratebook!.extruders : [])
                            .filter((ex) => ex && String(ex.extruder_code || '').trim())
                            .map((ex) => {
                              const code = String(ex.extruder_code || '').trim()
                              const model = ex?.model != null && String(ex.model).trim() ? String(ex.model).trim() : ''
                              const dieMm = ex?.die_size_mm != null ? Number(ex.die_size_mm) : null
                              const dw = ex?.decision_width_mm != null ? Number(ex.decision_width_mm) : null
                              const avg = ex?.average_kg_hr != null ? Number(ex.average_kg_hr) : null
                              const bits = [code]
                              if (model) bits.push(`— ${model}`)
                              if (dieMm != null && Number.isFinite(dieMm)) bits.push(`die ${Math.round(dieMm)} mm`)
                              if (dw != null && Number.isFinite(dw)) bits.push(`${Math.round(dw)} mm`)
                              if (avg != null && Number.isFinite(avg)) bits.push(`~${avg} kg/h`)
                              return (
                                <MenuItem key={code} value={code}>
                                  {bits.join(' · ')}
                                </MenuItem>
                              )
                            })}
                        </Select>
                      </FormControl>
                      {extruderSuggestion.hintLine ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {extruderSuggestion.hintLine}
                        </Typography>
                      ) : null}
                    </Stack>
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
                          to={`/orders/${encodeURIComponent(orderId)}`}
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
                    {finishMode === 'Cartons' ? (
                      <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          Conversion instructions
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Total cartons:{' '}
                          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                            {qty.cartonCountForDisplay != null && qty.cartonCountForDisplay > 0
                              ? String(qty.cartonCountForDisplay)
                              : '—'}
                          </Box>
                        </Typography>
                      </Box>
                    ) : null}
                  </Paper>
                </>
              }
            />
          </Paper>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>{renderJobSheetActions()}</Box>
        </Stack>

        {!isNarrow ? (
          <StickySideAside>
            <JobSheetPreviewPanel
              jobSheetId={mode === 'edit' && jobSheetId ? jobSheetId : null}
              jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : ''}
              customerName={previewCustomerName}
              invoiceNo={invoiceNo}
              purchaseOrderNo={previewPurchaseOrderNo}
              orderDate={orderDate}
              dueDate={dueDate}
              productCode={previewProductCode}
              description={previewDescriptionWithPackagingTail}
              myobImportLineDescription={myobImportLineDescription}
              customerFacingDescription={customerFacingDescription}
              notes={previewNotesLine}
              qualityFlagIds={previewQualityFlagIds}
              quoteSummary={jobSheetPreviewQuoteSummary}
            />
          </StickySideAside>
        ) : null}
      </Box>

    </Box>
  )
}


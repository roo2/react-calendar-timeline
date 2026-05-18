import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { can } from '../../../auth/permissions'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../../components/SpecPayloadForm'
import type { PrintingArtworkScope } from '../../../components/PrintingArtworkUploadSection'
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
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { FormErrorAlert } from '../../../components/FormErrorAlert'
import {
  clearCreateErrors,
  clearNewVersionErrors,
  createProduct,
  createProductVersion,
  deleteProduct,
  fetchProduct,
  fetchProductVersion,
  fetchProducts,
  productVersionCacheKey,
} from '../../../store/slices/productsSlice'
import { fetchJobSheet, saveJobSheetAsNewProduct, updateJobSheet } from '../../../store/slices/jobSheetsSlice'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import { computeProductDescriptionFromSpec, getDisplayProductCodeFromSpec } from '../../../utils/productDescription'
import { SaveAsNewProductButton, SaveFormButton } from '../../../components/SaveActionButtons'
import { ProductVersionEditorLiveAside } from './ProductVersionEditorLiveAside'
import {
  JobSheetIdentityQuantitySection,
  type JobSheetQuantityFieldsProps,
} from '../../job-sheets/components/JobSheetIdentityQuantitySection'
import { LinkedQuantityFields } from '../../../components/quantity/LinkedQuantityFields'
import {
  useSpecLinkedQuantityFields,
  type SpecLinkedQuantityHydrate,
} from '../../../hooks/useSpecLinkedQuantityFields'
import { suggestSmallestFittingExtruderCode } from '../../../utils/suggestExtruderFromSpec'
import {
  cartonsWeightPerRollKg,
  coerceQtyTypeForFinishMode,
  getOrderQuantityFromJobSheetFields,
  resolveNumRollsForPersistence,
  resolveWeightPerRollForPersistence,
  validateJobSheetQuantityInputs,
  qtyTypeFromPersisted,
  type FinishMode,
  type QtyType,
} from '../../../utils/quantityRollFields'
import { addOrderItem, fetchOrder } from '../../../store/slices/ordersSlice'
import { ApiError } from '../../../api/client'
import { parseFastApiValidationDetail } from '../../../api/validation'
import { isRejectedWithValue } from '@reduxjs/toolkit'
import type { UpsertError } from '../../../store/slices/productsSlice'

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

function defaultDueDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 28)
  return d.toISOString().slice(0, 10)
}

/** `productId` sentinel for order-page “New job sheet” embedded editor (no product fetch until after create). */
export const EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID = '__embedded_new_job_sheet__'

export type EmbeddedNewJobSheetFlow = {
  customerId: string
  orderMode: 'new' | 'edit'
  orderId?: string | null
  initialOrderDate?: string | null
  /** Customer PO from the parent order header (read-only on the job sheet form). */
  initialCustomerPurchaseOrderNumber?: string | null
  onCancel: () => void
  onFinished: () => void
  /** Draft new order only: append a local line with quantities from the job sheet editor. */
  onNewDraftLine?: (args: {
    product_id: string
    product_code: string
    product_name?: string | null
    due_date: string
    quantity_unit: 'kg' | 'rolls' | 'cartons' | '1000'
    quantity_value: number
    finish_mode: 'Rolls' | 'Cartons' | null
  }) => void
}

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
  if (x === '1000') return 'units'
  if (x === 'cartons' || x === 'bags' || x === 'meters') return 'units'
  return 'units'
}

/** Current order-line quantity/due date when opening the job sheet editor from {@link OrderEditor} (may differ from persisted job sheet until save). */
export type OrderLineQtySnapshot = {
  quantity_value: string
  quantity_unit: string
  due_date: string
}

function mergeJobSheetRowWithOrderLineQty(js: any, snap: OrderLineQtySnapshot): any {
  const qvNum = Number(snap.quantity_value)
  const qu = String(snap.quantity_unit || '').trim()
  const jsMerged: any = {
    ...js,
    quantity_value: Number.isFinite(qvNum) ? qvNum : js?.quantity_value,
    quantity_unit: qu || js?.quantity_unit,
    qty_type: null,
  }
  if (qu === 'rolls') {
    const n = Math.max(1, Math.round(Number.isFinite(qvNum) ? qvNum : Number(js?.num_rolls) || 1))
    jsMerged.num_rolls = n
  }
  if (qu === '1000') {
    jsMerged.num_product_units = Math.round((Number.isFinite(qvNum) ? qvNum : 0) * 1000)
  }
  return jsMerged
}

function buildSpecLinkedHydrateFromJobSheetJs(
  loadedSpec0: SpecPayload,
  jsQty: any,
  isImportDraft: boolean,
): SpecLinkedQuantityHydrate {
  const rawQu = String(jsQty?.quantity_unit || '').toLowerCase()
  const rawQt =
    jsQty?.qty_type != null && String(jsQty.qty_type).trim()
      ? qtyTypeFromPersisted(String(jsQty.qty_type))
      : inferQtyTypeFromUnit(jsQty?.quantity_unit)
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
  const nrStored = jsQty?.num_rolls != null ? Math.max(1, Number(jsQty.num_rolls)) : 1
  const wpr =
    jsQty?.weight_per_roll_kg != null && Number.isFinite(Number(jsQty.weight_per_roll_kg))
      ? String(jsQty.weight_per_roll_kg)
      : ''
  const quRawLower = String(jsQty?.quantity_unit || '').toLowerCase()

  let cartonQtyMode: '1000' | 'ctn' = '1000'
  let numCartonsHydrate = ''
  if (fm === 'Cartons' && qtResolved === 'units') {
    if (quRawLower === 'cartons') {
      cartonQtyMode = 'ctn'
      numCartonsHydrate =
        jsQty?.quantity_value != null && String(jsQty.quantity_value).trim() !== ''
          ? String(Math.max(0, Math.round(Number(jsQty.quantity_value))))
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
    totalKgH = String(jsQty?.quantity_value ?? '')
    numUnitsH = ''
    unitsPerRollH = ''
    numRollsH = String(nrStored)
    weightPerRollH = wpr
  } else if (qtResolved === 'units') {
    if (quRawLower === 'cartons' && jsQty?.num_product_units != null) {
      numUnitsH = String(jsQty.num_product_units)
    } else if (quRawLower === '1000' && jsQty?.num_product_units != null) {
      numUnitsH = String(Math.max(0, Math.round(Number(jsQty.num_product_units))))
    } else {
      numUnitsH = String(jsQty?.num_product_units ?? jsQty?.quantity_value ?? '')
    }
    totalKgH = ''
    unitsPerRollH = ''
    numRollsH = String(nrStored)
    weightPerRollH = wpr
  } else if (qtResolved === 'rolls_units') {
    numRollsH = String(nrStored)
    totalKgH = ''
    numUnitsH = ''
    const npu = jsQty?.num_product_units != null ? Number(jsQty.num_product_units) : NaN
    unitsPerRollH =
      Number.isFinite(npu) && npu > 0 && nrStored > 0 ? String(Math.max(1, Math.round(npu / nrStored))) : ''
    weightPerRollH = wpr
  } else {
    unitsPerRollH = ''
    numRollsH = String(jsQty?.num_rolls ?? jsQty?.quantity_value ?? nrStored)
    weightPerRollH = wpr
    totalKgH = ''
    numUnitsH = ''
  }

  if (fm === 'Cartons') {
    weightPerRollH = ''
  }

  return {
    qtyType: qtResolved,
    cartonQtyMode,
    totalKg: totalKgH,
    numRolls: numRollsH,
    weightPerRoll: weightPerRollH,
    numUnits: numUnitsH,
    unitsPerRoll: unitsPerRollH,
    metersPerRoll: metersPerRollH,
    numCartons: numCartonsHydrate,
  }
}

export function ProductVersionEditor(props: {
  productId: string
  /** When set, load and edit this product version spec (save creates a new version). */
  versionId?: string | null
  /** When set (e.g. order line edit), show job sheet identity + quantity and save via `updateJobSheet` + spec (creates product version server-side). */
  jobSheetId?: string | null
  /**
   * When opening from an order line, pass the **current** table row values so quantity/due date match unsaved edits
   * (the job sheet GET payload would otherwise lag until the order is saved).
   */
  orderLineQtySnapshot?: OrderLineQtySnapshot | null
  /** Live customer PO from the parent order header (may differ from job sheet GET until order save). */
  orderHeaderCustomerPurchaseOrderNumber?: string | null
  /** New Order / Edit Order: full job sheet + spec flow before a product exists (`productId` must be {@link EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID}). */
  embeddedNewJobSheetFlow?: EmbeddedNewJobSheetFlow | null
  returnTo?: string | null
  /** May return a Promise (e.g. parent refetches order); callers should await after save. */
  onDone?: (versionId?: string) => void | Promise<void>
  /** After “Save As New Product”, parent should point the editor at the new product id (same job sheet). */
  onRepointedToNewProduct?: (newProductId: string) => void
  onCancel?: () => void
  title?: string
  submitLabel?: string
}) {
  const {
    productId,
    versionId,
    jobSheetId,
    orderLineQtySnapshot,
    orderHeaderCustomerPurchaseOrderNumber,
    embeddedNewJobSheetFlow,
    returnTo,
    onDone,
    onRepointedToNewProduct,
    onCancel,
    title,
    submitLabel,
  } = props
  const embedded = Boolean(embeddedNewJobSheetFlow)
  const embCustomerId = embeddedNewJobSheetFlow?.customerId ?? ''
  const embOrderMode = embeddedNewJobSheetFlow?.orderMode
  const embOrderId = embeddedNewJobSheetFlow?.orderId ?? null
  const embInitialOrderDate = embeddedNewJobSheetFlow?.initialOrderDate ?? null
  const embInitialCustomerPo = embeddedNewJobSheetFlow?.initialCustomerPurchaseOrderNumber ?? null
  const nav = useNavigate()
  const location = useLocation()
  const dispatch = useAppDispatch()

  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = can(roles, 'PROD_MANAGER')

  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [jobSaveErr, setJobSaveErr] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)
  const [savingEmbeddedJob, setSavingEmbeddedJob] = useState(false)
  const [savingAsNew, setSavingAsNew] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const orderDateInputRef = useRef<HTMLInputElement | null>(null)
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)
  const [productionExtruderCode, setProductionExtruderCode] = useState('')
  const [dieSize, setDieSize] = useState('')
  const [customerFacingDescription, setCustomerFacingDescription] = useState('')
  const extruderUserTouchedRef = useRef(false)

  const productDetail = useAppSelector((s) => s.products.detail.byId[productId])
  const data = productDetail?.data
  const versionDetailKey =
    versionId && !jobSheetId && !embedded ? productVersionCacheKey(productId, versionId) : ''
  const versionDetailEntry = useAppSelector((s) =>
    versionDetailKey ? s.products.versionDetail.byKey[versionDetailKey] : undefined,
  )
  const versionDetailData = versionDetailEntry?.data
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const invoiceNoFromOrder = useMemo(() => {
    const js = jobSheetDetail?.data?.job_sheet
    return js?.invoice_no != null ? String(js.invoice_no).trim() : ''
  }, [jobSheetDetail?.data?.job_sheet])

  const purchaseOrderNoFromOrder = useMemo(() => {
    const headerPo = String(orderHeaderCustomerPurchaseOrderNumber ?? '').trim()
    if (headerPo) return headerPo
    if (embedded && embInitialCustomerPo != null && String(embInitialCustomerPo).trim()) {
      return String(embInitialCustomerPo).trim()
    }
    const js = jobSheetDetail?.data?.job_sheet
    return js?.customer_purchase_order_number != null ? String(js.customer_purchase_order_number).trim() : ''
  }, [
    orderHeaderCustomerPurchaseOrderNumber,
    embedded,
    embInitialCustomerPo,
    jobSheetDetail?.data?.job_sheet,
  ])
  const ratebook = useAppSelector((s) => s.quotes.quoteRatebook.data)

  const extruderCodeForQty =
    productionExtruderCode.trim() !== '' ? productionExtruderCode.trim() : null

  const showFullJobSheetPreview = Boolean(jobSheetId || embedded)
  const syncDerivedQuantity = showFullJobSheetPreview

  const qty = useSpecLinkedQuantityFields({
    spec,
    ratebook: ratebook ?? null,
    extruderCode: extruderCodeForQty,
    syncDerivedQuantity,
  })

  const upsert = useAppSelector((s) => s.products.newVersion)
  const err = upsert.error
  const errorSummary = upsert.messages
  const fieldErrors = upsert.fieldErrors
  const saving = upsert.status === 'loading'

  const createState = useAppSelector((s) => s.products.create)
  const createSaving = createState.status === 'loading'
  const createErr = createState.error
  const createMessages = createState.messages
  const createFieldErrors = createState.fieldErrors
  const { setDirty } = useUnsavedChanges()
  const specHydratedRef = useRef(false)
  /** Avoid mounting {@link SpecPayloadForm} with a placeholder spec before the real payload is loaded. */
  const [specReady, setSpecReady] = useState(false)
  const lastHydratedVersionKeyRef = useRef<string | null>(null)
  /** Re-hydrate when GET /job-sheets/:id returns a new `data` object (avoids stale qty after a slow/out-of-order fetch). */
  const lastHydratedJobDetailDataRef = useRef<unknown>(null)
  /** Re-hydrate when {@link orderLineQtySnapshot} changes while job sheet payload is unchanged (unsaved order line edits). */
  const lastHydratedOrderQtySnapRef = useRef<string | null>(null)
  useEffect(() => {
    const st = location.state as { productSaveMsg?: string } | null
    if (st?.productSaveMsg) {
      setSaveMsg(st.productSaveMsg)
      nav({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    }
  }, [location.pathname, location.search, location.state, nav])

  useEffect(() => {
    void dispatch(clearNewVersionErrors())
  }, [dispatch, productId])

  useEffect(() => {
    if (embedded) void dispatch(clearCreateErrors())
  }, [dispatch, embedded, productId])

  useEffect(() => {
    specHydratedRef.current = false
    lastHydratedVersionKeyRef.current = null
    lastHydratedJobDetailDataRef.current = null
    lastHydratedOrderQtySnapRef.current = null
    setSpecReady(false)
    qty.resetNewDraft()
    setCustomerId('')
    setDueDate('')
    setOrderDate('')
    setProductionExtruderCode('')
    setDieSize('')
    setCustomerFacingDescription('')
    extruderUserTouchedRef.current = false
    setJobSaveErr(null)
    const emb = embeddedNewJobSheetFlow
    if (emb) {
      setSpec(makeDefaultSpec())
      setCustomerId(emb.customerId)
      setDueDate(defaultDueDateStr())
      setOrderDate(emb.initialOrderDate?.trim() || new Date().toISOString().slice(0, 10))
      specHydratedRef.current = true
      setSpecReady(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset identity fields only; `qty.resetNewDraft` is stable
  }, [productId, versionId, jobSheetId, embedded, embCustomerId, embOrderMode, embOrderId])

  useEffect(() => {
    if (!embedded) return
    const od = embInitialOrderDate?.trim() || new Date().toISOString().slice(0, 10)
    setOrderDate(od)
  }, [embedded, embInitialOrderDate])

  useEffect(() => {
    if (embedded) return
    void dispatch(fetchProduct(productId))
  }, [dispatch, productId, versionId, embedded])

  useEffect(() => {
    if (embedded || jobSheetId || !versionId) return
    void dispatch(fetchProductVersion({ productId, versionId }))
  }, [dispatch, productId, versionId, embedded, jobSheetId])

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [dispatch, jobSheetId])

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    void dispatch(fetchQuoteRatebook())
  }, [dispatch, jobSheetId, embedded])

  useEffect(() => {
    if (jobSheetId || embedded || versionId) return
    if (productDetail?.status === 'failed') {
      setLoadErr(productDetail.error || 'Failed to load product')
      return
    }
    if (productDetail?.status === 'loading' || !data) {
      if (productDetail?.status === 'loading') setLoadErr(null)
      return
    }
    setLoadErr(null)
    if (specHydratedRef.current) return
    specHydratedRef.current = true
    const product = data.product
    const versions = data.versions || []
    const activeId = product?.active_version_id
    const active = activeId ? versions.find((v: any) => v.id === activeId) : null
    const latest = versions.slice().sort((a: any, b: any) => (b.version_number || 0) - (a.version_number || 0))[0]
    const srcSpec = (active?.spec_payload || latest?.spec_payload) ?? null
    setSpec(ensureSpec(srcSpec))
    setSpecReady(true)
  }, [jobSheetId, embedded, versionId, data, productDetail?.status, productDetail?.error])

  useEffect(() => {
    if (jobSheetId || embedded || !versionId) return
    if (versionDetailEntry?.status === 'failed') {
      setLoadErr(versionDetailEntry.error || 'Failed to load product version')
      return
    }
    if (versionDetailEntry?.status === 'loading' || versionDetailEntry?.status === 'idle' || !versionDetailData) {
      if (versionDetailEntry?.status === 'loading') setLoadErr(null)
      return
    }
    if (productDetail?.status === 'failed') {
      setLoadErr(productDetail.error || 'Failed to load product')
      return
    }
    if (productDetail?.status === 'loading' || !data) {
      if (productDetail?.status === 'loading') setLoadErr(null)
      return
    }
    setLoadErr(null)
    const hydrateKey = `${productId}:${versionId}`
    if (lastHydratedVersionKeyRef.current === hydrateKey) return
    lastHydratedVersionKeyRef.current = hydrateKey
    specHydratedRef.current = true
    const srcSpec = versionDetailData?.version?.spec_payload ?? null
    setSpec(ensureSpec(srcSpec))
    setSpecReady(true)
  }, [
    jobSheetId,
    embedded,
    versionId,
    productId,
    versionDetailData,
    versionDetailEntry?.status,
    versionDetailEntry?.error,
    productDetail?.status,
    productDetail?.error,
  ])

  useEffect(() => {
    if (!jobSheetId) return
    const st = jobSheetDetail
    if (st?.status === 'failed') {
      setLoadErr(st.error || 'Failed to load job sheet')
      return
    }
    if (st?.status !== 'succeeded' || !st.data) {
      if (st?.status === 'loading') setLoadErr(null)
      return
    }
    setLoadErr(null)
    const snapKey = orderLineQtySnapshot
      ? `${orderLineQtySnapshot.quantity_value}|${orderLineQtySnapshot.quantity_unit}|${orderLineQtySnapshot.due_date}`
      : '__none__'
    if (
      lastHydratedJobDetailDataRef.current === st.data &&
      lastHydratedOrderQtySnapRef.current === snapKey
    ) {
      return
    }
    lastHydratedJobDetailDataRef.current = st.data
    lastHydratedOrderQtySnapRef.current = snapKey
    const res = st.data
    const js = res.job_sheet
    const jsQty = orderLineQtySnapshot ? mergeJobSheetRowWithOrderLineQty(js, orderLineQtySnapshot) : js
    const isImportDraft = Boolean(js?.is_import_draft)
    let loadedSpec0 = ensureSpec(res.spec_payload)
    const rawQu = String(jsQty?.quantity_unit || '').toLowerCase()
    const rawQt =
      jsQty?.qty_type != null && String(jsQty.qty_type).trim()
        ? qtyTypeFromPersisted(String(jsQty.qty_type))
        : inferQtyTypeFromUnit(jsQty?.quantity_unit)
    if (isImportDraft && (rawQu === 'rolls' || String(rawQt || '') === 'total_rolls')) {
      loadedSpec0 = {
        ...loadedSpec0,
        identity: { ...loadedSpec0.identity, finish_mode: 'Rolls' },
      }
    }
    setSpec(loadedSpec0)
    extruderUserTouchedRef.current = false
    const extFromRow =
      js?.production_extruder_code != null && String(js.production_extruder_code).trim() !== ''
        ? String(js.production_extruder_code).trim()
        : ''
    const extLegacy =
      loadedSpec0.identity?.production_extruder_code != null &&
      String(loadedSpec0.identity.production_extruder_code).trim() !== ''
        ? String(loadedSpec0.identity.production_extruder_code).trim()
        : ''
    setProductionExtruderCode(extFromRow || extLegacy)
    setDieSize(js?.die_size != null && String(js.die_size).trim() !== '' ? String(js.die_size) : '')
    setCustomerId(js?.customer_id || '')
    setOrderDate(js?.order_date ? String(js.order_date).slice(0, 10) : '')
    setDueDate(orderLineQtySnapshot ? orderLineQtySnapshot.due_date || '' : js?.due_date || '')
    setCustomerFacingDescription(
      js?.customer_facing_description != null && String(js.customer_facing_description).trim()
        ? String(js.customer_facing_description).trim()
        : '',
    )
    qty.hydrate(buildSpecLinkedHydrateFromJobSheetJs(loadedSpec0, jsQty, isImportDraft))
    specHydratedRef.current = true
    setSpecReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `qty.hydrate` is stable; listing `qty` reruns on every render.
  }, [jobSheetId, jobSheetDetail, orderLineQtySnapshot])

  const finishMode = qty.finishMode
  const effectiveQtyType = qty.effectiveQtyType
  const totalKgNum = Number(qty.totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(qty.numRolls || 0)))
  const weightPerRollNum = Number(qty.weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(qty.numUnits || 0)))
  const unitsPerRollNum = Math.max(0, Math.round(Number(qty.unitsPerRoll || 0)))

  const derivedDisplay = qty.derivedForDisplay
    ? {
        derivedTotalKg: qty.derivedForDisplay.derivedTotalKg ?? null,
        units: qty.derivedForDisplay.units ?? null,
        kgPerRoll: qty.derivedForDisplay.kgPerRoll ?? null,
        billedKgPerRoll: qty.derivedForDisplay.billedKgPerRoll ?? null,
      }
    : null

  /** Cartons + derived-only total KG (e.g. units driver): same as {@link JobSheetEditor} `onSave`. */
  const totalKgForScheduling = useMemo(() => {
    if (!(jobSheetId || embedded)) return totalKgNum
    if (
      finishMode === 'Cartons' &&
      !(totalKgNum > 0) &&
      qty.totalKgDisplay != null &&
      Number(qty.totalKgDisplay) > 0
    ) {
      return Number(qty.totalKgDisplay)
    }
    return totalKgNum
  }, [jobSheetId, embedded, finishMode, totalKgNum, qty.totalKgDisplay])

  const loadedJobSheet = jobSheetId && jobSheetDetail?.status === 'succeeded' ? jobSheetDetail.data?.job_sheet : undefined

  const specFormMountKey = versionId ? `${productId}:${versionId}` : `${productId}:new`

  const extruderSuggestion = useMemo(
    () => suggestSmallestFittingExtruderCode(spec, ratebook ?? null),
    [spec, ratebook],
  )

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    if (extruderUserTouchedRef.current) return
    if (productionExtruderCode.trim() !== '') return
    const code = extruderSuggestion.extruderCode
    if (!code) return
    setProductionExtruderCode(code)
  }, [jobSheetId, embedded, productionExtruderCode, extruderSuggestion.extruderCode])

  const bagsPerCartonStr = spec.packaging?.bags_per_carton != null ? String(spec.packaging.bags_per_carton) : ''

  /** Header card omits quantity (`includeQuantity` false); stub matches {@link JobSheetEditor}. */
  const jobSheetQuantityFieldsProps: JobSheetQuantityFieldsProps = {
    productUnitLabel: qty.productUnitLabel,
    productTypeIsBag: qty.productTypeIsBag,
    showRollsUnitsQtyType: !qty.isContinuousLength,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange: () => {},
    totalMetersReadonly: '',
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

  const canSubmit = useMemo(() => {
    if (embedded) return !savingEmbeddedJob && !savingAsNew && !createSaving
    return !!productId && !saving && !savingEmbeddedJob && !savingAsNew
  }, [embedded, productId, saving, savingEmbeddedJob, savingAsNew, createSaving])

  const showSaveAsNewProduct = Boolean((jobSheetId && !embedded) || (!jobSheetId && !embedded && productId))

  const productUsage = data?.usage as
    | { can_delete?: boolean; job_sheet_count?: number; order_count?: number }
    | undefined
  const canDeleteProduct = Boolean(
    isPm && !jobSheetId && !embedded && productId && productUsage?.can_delete === true,
  )

  const PRODUCT_SAVE_AS_NEW_MSG = 'Saved as new product. You are now editing the new product.'

  async function reloadProductAndVersion(versionIdToLoad: string) {
    lastHydratedVersionKeyRef.current = null
    specHydratedRef.current = false
    setSpecReady(false)
    await dispatch(fetchProduct(productId)).unwrap()
    await dispatch(fetchProductVersion({ productId, versionId: versionIdToLoad })).unwrap()
  }

  function buildJobSheetUpdateBody(): Record<string, unknown> | null {
    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (missing.length > 0) {
      setJobSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return null
    }
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
      setJobSaveErr(qtyErr)
      return null
    }
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
      finishMode === 'Cartons' && effectiveQtyType === 'units' ? qty.cartonQtyMode : undefined,
    )
    const keepUnitRate =
      loadedJobSheet?.unit_rate != null && Number.isFinite(Number(loadedJobSheet.unit_rate))
        ? Number(loadedJobSheet.unit_rate)
        : null
    const keepLineTotal =
      loadedJobSheet?.line_total != null && Number.isFinite(Number(loadedJobSheet.line_total))
        ? Number(loadedJobSheet.line_total)
        : null
    return {
      due_date: dueDate || null,
      order_date: orderDate || null,
      quantity_value: oq.quantity_value,
      quantity_unit: oq.quantity_unit,
      qty_type: effectiveQtyType,
      num_product_units:
        effectiveQtyType === 'units'
          ? numUnitsNum
          : derivedDisplay?.units != null
            ? Math.round(Number(derivedDisplay.units))
            : null,
      weight_per_roll_kg: persistedWpr,
      num_rolls: persistedRolls,
      spec,
      production_extruder_code: productionExtruderCode.trim() || null,
      die_size: dieSize.trim() || null,
      customer_facing_description: customerFacingDescription.trim() ? customerFacingDescription.trim() : null,
      ...(keepUnitRate != null ? { unit_rate: keepUnitRate } : {}),
      ...(keepLineTotal != null ? { line_total: keepLineTotal } : {}),
    }
  }

  async function persistJobSheet(asNewProduct: boolean) {
    if (!jobSheetId) return
    setJobSaveErr(null)
    const body = buildJobSheetUpdateBody()
    if (!body) return
    if (asNewProduct) setSavingAsNew(true)
    else setSavingEmbeddedJob(true)
    try {
      if (asNewProduct) {
        const res = await dispatch(saveJobSheetAsNewProduct({ jobSheetId, body })).unwrap()
        const newPid = String(res.product_id || '').trim()
        if (!newPid) throw new Error('New product was created but no id was returned')
        onRepointedToNewProduct?.(newPid)
        await dispatch(fetchProduct(newPid)).unwrap()
        await dispatch(fetchJobSheet(jobSheetId)).unwrap()
        const cid = (customerId || embCustomerId || '').trim()
        if (cid) await dispatch(fetchProducts({ customer_id: cid })).unwrap()
        setSaveMsg(PRODUCT_SAVE_AS_NEW_MSG)
      } else {
        await dispatch(updateJobSheet({ jobSheetId, body })).unwrap()
        await Promise.resolve(onDone?.())
      }
      setDirty(false)
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setJobSaveErr(p.message || (asNewProduct ? 'Failed to save as new product' : 'Failed to save job sheet'))
      } else if (e instanceof ApiError && e.body?.detail != null) {
        const { messages } = parseFastApiValidationDetail(e.body.detail)
        setJobSaveErr(
          messages.length > 0
            ? messages.join(' · ')
            : e.message || (asNewProduct ? 'Failed to save as new product' : 'Failed to save job sheet'),
        )
      } else {
        setJobSaveErr(
          e instanceof Error
            ? e.message
            : asNewProduct
              ? 'Failed to save as new product'
              : 'Failed to save job sheet',
        )
      }
    } finally {
      if (asNewProduct) setSavingAsNew(false)
      else setSavingEmbeddedJob(false)
    }
  }

  /** Standalone product editor: fork current spec onto a new product row (same customer). */
  async function saveAsNewProductStandalone() {
    if (jobSheetId || embedded) return
    setJobSaveErr(null)
    void dispatch(clearCreateErrors())
    const customer_id = String(product?.customer_id || data?.product?.customer_id || '').trim()
    if (!customer_id) {
      setJobSaveErr('Product customer is missing.')
      return
    }
    const code = getDisplayProductCodeFromSpec(spec).trim()
    if (!code) {
      setJobSaveErr(
        'Customer-facing product code is empty. Set a customer-facing product code or complete dimensions and product type.',
      )
      return
    }
    setSavingAsNew(true)
    try {
      const createRes = await dispatch(createProduct({ data: { customer_id, code, spec } })).unwrap()
      const newPid = String(createRes?.product?.id || '').trim()
      const newVid = String(createRes?.version?.id || '').trim()
      if (!newPid) throw new Error('Product was created but no id was returned')
      setDirty(false)
      await dispatch(fetchProduct(newPid)).unwrap()
      if (newVid) {
        await dispatch(fetchProductVersion({ productId: newPid, versionId: newVid })).unwrap()
      }
      await dispatch(fetchProducts({ customer_id })).unwrap()
      if (newVid) {
        nav(`/products/${newPid}/versions/${newVid}`, { state: { productSaveMsg: PRODUCT_SAVE_AS_NEW_MSG } })
      } else {
        nav(`/products/${newPid}`, { state: { productSaveMsg: PRODUCT_SAVE_AS_NEW_MSG } })
      }
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setJobSaveErr(p.message || 'Failed to create product')
      } else if (e instanceof ApiError && e.body?.detail != null) {
        const { messages } = parseFastApiValidationDetail(e.body.detail)
        setJobSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
      } else {
        setJobSaveErr(e instanceof Error ? e.message : 'Failed to create product')
      }
    } finally {
      setSavingAsNew(false)
    }
  }

  async function onDeleteProduct() {
    if (!canDeleteProduct || deletingProduct) return
    const code = product?.code || data?.product?.code || 'this product'
    const ok = window.confirm(
      `Delete product "${code}" permanently? This removes all versions. This cannot be undone.`,
    )
    if (!ok) return
    setJobSaveErr(null)
    setDeletingProduct(true)
    try {
      await dispatch(deleteProduct(productId)).unwrap()
      setDirty(false)
      nav('/products')
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setJobSaveErr(p.message || 'Failed to delete product')
      } else if (e instanceof ApiError) {
        setJobSaveErr(e.message || 'Failed to delete product')
      } else {
        setJobSaveErr(e instanceof Error ? e.message : 'Failed to delete product')
      }
    } finally {
      setDeletingProduct(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    if (embeddedNewJobSheetFlow) {
      const flow = embeddedNewJobSheetFlow
      setJobSaveErr(null)
      void dispatch(clearCreateErrors())
      const code = getDisplayProductCodeFromSpec(spec).trim()
      if (!code) {
        setJobSaveErr(
          'Customer-facing product code is empty. Set a customer-facing product code or complete dimensions and product type.',
        )
        return
      }
      const missing: string[] = []
      if (!customerId) missing.push('Customer')
      if (missing.length > 0) {
        setJobSaveErr(`Missing required fields: ${missing.join(', ')}`)
        return
      }
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
        setJobSaveErr(qtyErr)
        return
      }
      setSavingEmbeddedJob(true)
      try {
        const createRes = await dispatch(
          createProduct({ data: { customer_id: flow.customerId, code, spec } }),
        ).unwrap()
        const createdPid = String(createRes?.product?.id || '')
        if (!createdPid) throw new Error('Product was created but no id was returned')

        const { data: pres } = await dispatch(fetchProduct(createdPid)).unwrap()
        const createdProduct = pres?.product as { code?: string; description?: string | null } | undefined

        await dispatch(fetchProducts({ customer_id: flow.customerId })).unwrap()

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
        const bpc = spec.packaging?.bags_per_carton
        const oq = getOrderQuantityFromJobSheetFields(
          effectiveQtyType,
          1,
          totalKgForScheduling,
          numUnitsNum,
          persistedRolls,
          finishMode,
          bpc != null ? Number(bpc) : null,
          finishMode === 'Cartons' && effectiveQtyType === 'units' ? qty.cartonQtyMode : undefined,
        )

        if (flow.orderMode === 'edit' && flow.orderId) {
          await dispatch(
            addOrderItem({
              orderId: flow.orderId,
              body: {
                product_id: createdPid,
                due_date: dueDate || null,
                quantity_unit: oq.quantity_unit,
                quantity_value: oq.quantity_value,
              },
            }),
          ).unwrap()
          const { order: res } = await dispatch(fetchOrder(flow.orderId)).unwrap()
          const items = Array.isArray(res?.items) ? res.items : []
          const line = [...items].reverse().find((it: any) => String(it.product_id) === createdPid)
          const jsid = line?.job_sheet_id != null ? String(line.job_sheet_id) : ''
          if (!jsid) throw new Error('Job sheet was not created for the new line')
          await dispatch(
            updateJobSheet({
              jobSheetId: jsid,
              body: {
                due_date: dueDate || null,
                order_date: orderDate || null,
                quantity_value: oq.quantity_value,
                quantity_unit: oq.quantity_unit,
                qty_type: effectiveQtyType,
                num_product_units:
                  effectiveQtyType === 'units'
                    ? numUnitsNum
                    : derivedDisplay?.units != null
                      ? Math.round(Number(derivedDisplay.units))
                      : null,
                weight_per_roll_kg: persistedWpr,
                num_rolls: persistedRolls,
                spec,
                production_extruder_code: productionExtruderCode.trim() || null,
                die_size: dieSize.trim() || null,
              },
            }),
          ).unwrap()
        } else {
          flow.onNewDraftLine?.({
            product_id: createdPid,
            product_code: String(createdProduct?.code || code),
            product_name: (createdProduct?.description as string | null | undefined) ?? null,
            due_date: dueDate,
            quantity_unit: oq.quantity_unit,
            quantity_value: oq.quantity_value,
            finish_mode: finishMode,
          })
        }

        setDirty(false)
        flow.onFinished()
      } catch (e: unknown) {
        if (isRejectedWithValue(e)) {
          const p = e.payload as UpsertError
          setJobSaveErr(p.message || 'Failed to create product')
        } else if (e instanceof ApiError && e.body?.detail != null) {
          const { messages } = parseFastApiValidationDetail(e.body.detail)
          setJobSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
        } else {
          setJobSaveErr(e instanceof Error ? e.message : 'Failed to create product')
        }
      } finally {
        setSavingEmbeddedJob(false)
      }
      return
    }

    if (jobSheetId) {
      await persistJobSheet(false)
      return
    }

    try {
      const res = await dispatch(createProductVersion({ productId, spec })).unwrap()
      const vid = res?.versionId as string | undefined
      setDirty(false)
      if (onDone) {
        await Promise.resolve(onDone(vid))
        return
      }
      if (vid) {
        await reloadProductAndVersion(vid)
        nav(`/products/${productId}/versions/${vid}`)
      } else if (returnTo) {
        nav(returnTo)
      } else {
        await dispatch(fetchProduct(productId)).unwrap()
        nav(`/products/${productId}`)
      }
    } catch {
      // errors in slice
    }
  }

  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => getDisplayProductCodeFromSpec(spec), [spec])

  const product =
    embedded && embeddedNewJobSheetFlow
      ? ({
          id: '',
          code: previewProductCode.trim() || '—',
          customer_id: embeddedNewJobSheetFlow.customerId,
          active_version_id: null,
        } as any)
      : data?.product

  const mergedFieldErrors = useMemo(() => {
    if (!embedded) return fieldErrors
    return { ...fieldErrors, ...createFieldErrors }
  }, [embedded, fieldErrors, createFieldErrors])

  const printingArtworkScope = useMemo<PrintingArtworkScope | null>(() => {
    if (jobSheetId) return { kind: 'job_sheet', jobSheetId }
    if (embedded) return null
    const vid = versionId || data?.product?.active_version_id
    if (productId && vid) return { kind: 'product_version', productId, versionId: String(vid) }
    return null
  }, [jobSheetId, embedded, versionId, data?.product?.active_version_id, productId])

  const editingVersionNumber = useMemo(() => {
    if (!versionId) return null
    const fromDetail = versionDetailData?.version?.version_number
    if (fromDetail != null) return Number(fromDetail)
    const fromList = (data?.versions || []).find((v: { id?: string }) => v.id === versionId)
    return fromList?.version_number != null ? Number(fromList.version_number) : null
  }, [versionId, versionDetailData, data?.versions])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  /** Order modal keeps the order open; standalone product/job sheet editors navigate in-tab. */
  const previousVersionsLinkOpensNewTab = Boolean(jobSheetId && onCancel)

  const waitingForJobSheet =
    !!jobSheetId &&
    (!jobSheetDetail || jobSheetDetail.status === 'loading' || jobSheetDetail.status === 'idle')

  const waitingForVersion =
    !!versionId &&
    !jobSheetId &&
    !embedded &&
    (!versionDetailEntry ||
      versionDetailEntry.status === 'loading' ||
      versionDetailEntry.status === 'idle')

  if (loadErr && !data && !embedded) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">{title || 'New Version'}</Typography>
        <FormErrorAlert error={loadErr} scrollOnShow={false} />
        {onCancel ? (
          <Button variant="text" color="primary" onClick={onCancel}>
            Back
          </Button>
        ) : (
          <Button component={Link} to={returnTo || (productId ? `/products/${productId}` : '/products')} variant="text" color="primary">
            Back
          </Button>
        )}
      </Stack>
    )
  }

  if (!data && !embedded) return <p>Loading…</p>
  if (waitingForVersion || waitingForJobSheet) return <p>Loading…</p>
  if (!embedded && !specReady) return <p>Loading…</p>

  const busy = saving || savingEmbeddedJob || savingAsNew || createSaving || deletingProduct

  return (
    <Box
      onChange={() => {
        setDirty(true)
        setJobSaveErr(null)
      }}
    >
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h5">
            {title ||
              (versionId && editingVersionNumber != null
                ? `${product?.code || 'Product'} — Version ${editingVersionNumber}`
                : `Edit ${product?.code || ''}`.trim())}
          </Typography>
          {jobSheetId ? (
            <MuiLink
              component={Link}
              to={`/job-sheets/${encodeURIComponent(jobSheetId)}/edit`}
              underline="hover"
              sx={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}
            >
              Open full job sheet editor
            </MuiLink>
          ) : null}
        </Box>

        {saveMsg ? (
          <Alert severity="success" onClose={() => setSaveMsg(null)}>
            {saveMsg}
          </Alert>
        ) : null}

        <FormErrorAlert
          error={embedded ? createErr || jobSaveErr : err || jobSaveErr}
          messages={embedded ? createMessages : errorSummary}
          scrollOnShow={true}
          scrollMarginTop={80}
        />

        {isPm && !jobSheetId && !embedded && productUsage && !productUsage.can_delete ? (
          <Alert severity="info">
            This product cannot be deleted because it is used on
            {Number(productUsage.job_sheet_count || 0) > 0
              ? ` ${productUsage.job_sheet_count} job sheet${Number(productUsage.job_sheet_count) !== 1 ? 's' : ''}`
              : ''}
            {Number(productUsage.job_sheet_count || 0) > 0 && Number(productUsage.order_count || 0) > 0
              ? ' and'
              : ''}
            {Number(productUsage.order_count || 0) > 0
              ? ` ${productUsage.order_count} order${Number(productUsage.order_count) !== 1 ? 's' : ''}`
              : ''}
            .
          </Alert>
        ) : null}

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0 }}>
            <Stack spacing={2}>
              {jobSheetId || embedded ? (
                <JobSheetIdentityQuantitySection
                  title="Job Sheet"
                  jobCode={loadedJobSheet?.job_no ? String(loadedJobSheet.job_no) : null}
                  invoiceNo={invoiceNoFromOrder}
                  purchaseOrderNo={purchaseOrderNoFromOrder}
                  customerId={customerId}
                  onCustomerIdChange={(id) => {
                    setCustomerId(id)
                    setDirty(true)
                  }}
                  customerSelectDisabled
                  orderDate={orderDate}
                  onOrderDateChange={(v) => {
                    setOrderDate(v)
                    setDirty(true)
                  }}
                  orderDateDisabled={Boolean(embeddedNewJobSheetFlow)}
                  dueDate={dueDate}
                  onDueDateChange={(v) => {
                    setDueDate(v)
                    setDirty(true)
                  }}
                  orderDateInputRef={orderDateInputRef}
                  dueDateInputRef={dueDateInputRef}
                  includeQuantity={false}
                  {...jobSheetQuantityFieldsProps}
                  productRow={
                    <Typography variant="body2" color="text.secondary">
                      Product:{' '}
                      <strong>
                        {product?.code || '—'}
                        {previewDescription?.trim() ? ` — ${previewDescription}` : ''}
                      </strong>
                    </Typography>
                  }
                />
              ) : null}

              {isNarrow && showFullJobSheetPreview ? (
                <ProductVersionEditorLiveAside
                  spec={spec}
                  qty={qty}
                  customerId={customerId}
                  customerFacingDescription={customerFacingDescription}
                  orderDate={orderDate}
                  dueDate={dueDate}
                  showJobFields={showFullJobSheetPreview}
                  jobSheetId={jobSheetId ?? null}
                  loadedJobSheet={(loadedJobSheet as Record<string, unknown> | undefined) ?? null}
                  jobSheetDetailData={jobSheetDetail?.data ?? null}
                  productionExtruderCode={productionExtruderCode}
                  includeProductionEstimates={showFullJobSheetPreview}
                />
              ) : null}

              {jobSheetId || embedded ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      mb: 2,
                    }}
                  >
                    <Typography variant="h6">Product Spec</Typography>
                    {!embedded ? (
                      <MuiLink
                        component={Link}
                        to={`/products/${encodeURIComponent(productId)}`}
                        {...(previousVersionsLinkOpensNewTab
                          ? { target: '_blank', rel: 'noreferrer' }
                          : {})}
                        underline="hover"
                        sx={{ fontSize: '0.875rem' }}
                      >
                        View previous versions
                      </MuiLink>
                    ) : null}
                  </Box>
                  <SpecPayloadForm
                    key={specFormMountKey}
                    value={spec}
                    onChange={(next) => {
                      setSpec(next)
                      setDirty(true)
                      setJobSaveErr(null)
                    }}
                    fieldErrors={mergedFieldErrors}
                    customerId={product?.customer_id || customerId || undefined}
                    printingSurface="job_sheet_summary"
                    printingArtworkScope={printingArtworkScope}
                    customerFacingDescription={customerFacingDescription}
                    onCustomerFacingDescriptionChange={(v) => {
                      setCustomerFacingDescription(v)
                      setDirty(true)
                    }}
                    customerFacingDescriptionPlaceholder={previewDescription}
                    afterDimensionsSlot={
                      <>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <Typography variant="h6" sx={{ mb: 2 }}>
                            Extruder
                          </Typography>
                          <Stack spacing={2}>
                            <FormControl fullWidth size="small" sx={{ maxWidth: 520 }}>
                              <InputLabel id="pv-job-sheet-production-extruder-label">Extruder</InputLabel>
                              <Select
                                labelId="pv-job-sheet-production-extruder-label"
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
                                    const dw = ex?.decision_width_mm != null ? Number(ex.decision_width_mm) : null
                                    const avg = ex?.average_kg_hr != null ? Number(ex.average_kg_hr) : null
                                    const bits = [code]
                                    if (model) bits.push(`— ${model}`)
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
                            <TextField
                              label="Die size"
                              value={dieSize}
                              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                setDieSize(e.target.value)
                                setDirty(true)
                              }}
                              size="small"
                              sx={{ maxWidth: 220 }}
                              placeholder="120"
                              inputProps={{ maxLength: 32 }}
                            />
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
                            {loadedJobSheet?.order_id != null && String(loadedJobSheet.order_id).trim() !== '' ? (
                              <MuiLink
                                component={Link}
                                to={`/orders/${encodeURIComponent(String(loadedJobSheet.order_id))}`}
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
                              setDirty(true)
                              setJobSaveErr(null)
                            }}
                          />
                          {qty.finishMode === 'Cartons' ? (
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
              ) : (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Product Spec
                    </Typography>
                    <MuiLink
                      component={Link}
                      to={`/products/${encodeURIComponent(productId)}`}
                      underline="hover"
                      sx={{ fontSize: '0.875rem' }}
                    >
                      View previous versions
                    </MuiLink>
                  </Box>
                  <SpecPayloadForm
                    key={specFormMountKey}
                    value={spec}
                    onChange={(next) => {
                      setSpec(next)
                      setDirty(true)
                      setJobSaveErr(null)
                    }}
                    fieldErrors={mergedFieldErrors}
                    customerId={product?.customer_id || customerId || undefined}
                    printingSurface="full"
                    printingArtworkScope={printingArtworkScope}
                  />
                </>
              )}

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                {onCancel ? (
                  <Button type="button" variant="text" color="primary" onClick={onCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button component={Link} to={returnTo || `/products/${productId}`} variant="text" color="primary">
                    Cancel
                  </Button>
                )}
                {canDeleteProduct ? (
                  <Button
                    type="button"
                    variant="outlined"
                    color="error"
                    disabled={busy}
                    onClick={() => void onDeleteProduct()}
                  >
                    {deletingProduct ? 'Deleting…' : 'Delete product'}
                  </Button>
                ) : null}
                {showSaveAsNewProduct ? (
                  <SaveAsNewProductButton
                    disabled={!canSubmit || busy}
                    saving={savingAsNew}
                    onClick={() =>
                      void (jobSheetId ? persistJobSheet(true) : saveAsNewProductStandalone())
                    }
                  />
                ) : null}
                <SaveFormButton
                  type="submit"
                  disabled={!canSubmit || busy}
                  saving={busy && !savingAsNew}
                  label={
                    submitLabel ||
                    (embedded
                      ? 'Create job sheet'
                      : jobSheetId || versionId
                        ? 'Save'
                        : 'Save Changes')
                  }
                />
              </Box>
            </Stack>
          </form>

          {!isNarrow && showFullJobSheetPreview ? (
            <ProductVersionEditorLiveAside
              spec={spec}
              qty={qty}
              customerId={customerId}
              customerFacingDescription={customerFacingDescription}
              orderDate={orderDate}
              dueDate={dueDate}
              showJobFields={showFullJobSheetPreview}
              jobSheetId={jobSheetId ?? null}
              loadedJobSheet={(loadedJobSheet as Record<string, unknown> | undefined) ?? null}
              jobSheetDetailData={jobSheetDetail?.data ?? null}
              productionExtruderCode={productionExtruderCode}
              includeProductionEstimates={showFullJobSheetPreview}
            />
          ) : null}
        </Box>
      </Stack>
    </Box>
  )
}

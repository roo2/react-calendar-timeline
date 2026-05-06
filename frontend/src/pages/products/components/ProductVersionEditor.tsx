import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../../components/SpecPayloadForm'
import type { PrintingArtworkScope } from '../../../components/PrintingArtworkUploadSection'
import {
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
  fetchProduct,
  fetchProducts,
} from '../../../store/slices/productsSlice'
import { fetchCustomers, CUSTOMER_PICKER_PAGE_SIZE } from '../../../store/slices/customersSlice'
import { fetchJobSheet, updateJobSheet } from '../../../store/slices/jobSheetsSlice'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import { computeProductDescriptionFromSpec, getDisplayProductCodeFromSpec } from '../../../utils/productDescription'
import { JobSheetPreviewPanel } from '../../../components/JobSheetPreviewPanel'
import { StickySideAside } from '../../../components/StickySideAside'
import {
  JobSheetIdentityQuantitySection,
  type JobSheetQuantityFieldsProps,
} from '../../job-sheets/components/JobSheetIdentityQuantitySection'
import { LinkedQuantityFields } from '../../../components/quantity/LinkedQuantityFields'
import { useSpecLinkedQuantityFields } from '../../../hooks/useSpecLinkedQuantityFields'
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

export function ProductVersionEditor(props: {
  productId: string
  /** When set (e.g. order line edit), show job sheet identity + quantity and save via `updateJobSheet` + spec (creates product version server-side). */
  jobSheetId?: string | null
  /** New Order / Edit Order: full job sheet + spec flow before a product exists (`productId` must be {@link EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID}). */
  embeddedNewJobSheetFlow?: EmbeddedNewJobSheetFlow | null
  returnTo?: string | null
  /** May return a Promise (e.g. parent refetches order); callers should await after save. */
  onDone?: (versionId?: string) => void | Promise<void>
  onCancel?: () => void
  title?: string
  submitLabel?: string
}) {
  const { productId, jobSheetId, embeddedNewJobSheetFlow, returnTo, onDone, onCancel, title, submitLabel } = props
  const embedded = Boolean(embeddedNewJobSheetFlow)
  const embCustomerId = embeddedNewJobSheetFlow?.customerId ?? ''
  const embOrderMode = embeddedNewJobSheetFlow?.orderMode
  const embOrderId = embeddedNewJobSheetFlow?.orderId ?? null
  const embInitialOrderDate = embeddedNewJobSheetFlow?.initialOrderDate ?? null
  const nav = useNavigate()
  const dispatch = useAppDispatch()

  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [jobSaveErr, setJobSaveErr] = useState<string | null>(null)
  const [savingEmbeddedJob, setSavingEmbeddedJob] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const orderDateInputRef = useRef<HTMLInputElement | null>(null)
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)
  const [productionExtruderCode, setProductionExtruderCode] = useState('')
  const [dieSize, setDieSize] = useState('')
  const extruderUserTouchedRef = useRef(false)

  const productDetail = useAppSelector((s) => s.products.detail.byId[productId])
  const data = productDetail?.data
  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const myobImportLineDescription = useMemo(() => {
    const raw = jobSheetDetail?.data?.myob_import_line_description
    if (raw == null || typeof raw !== 'string') return ''
    return raw.trim()
  }, [jobSheetDetail?.data?.myob_import_line_description])
  const ratebook = useAppSelector((s) => s.quotes.quoteRatebook.data)

  const extruderCodeForQty =
    productionExtruderCode.trim() !== '' ? productionExtruderCode.trim() : null

  const qty = useSpecLinkedQuantityFields({
    spec,
    ratebook: ratebook ?? null,
    extruderCode: extruderCodeForQty,
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
  /** Re-hydrate when GET /job-sheets/:id returns a new `data` object (avoids stale qty after a slow/out-of-order fetch). */
  const lastHydratedJobDetailDataRef = useRef<unknown>(null)
  useEffect(() => {
    void dispatch(clearNewVersionErrors())
  }, [dispatch, productId])

  useEffect(() => {
    if (embedded) void dispatch(clearCreateErrors())
  }, [dispatch, embedded, productId])

  useEffect(() => {
    specHydratedRef.current = false
    lastHydratedJobDetailDataRef.current = null
    setSpec(makeDefaultSpec())
    qty.resetNewDraft()
    setCustomerId('')
    setDueDate('')
    setOrderDate('')
    setProductionExtruderCode('')
    setDieSize('')
    extruderUserTouchedRef.current = false
    setJobSaveErr(null)
    const emb = embeddedNewJobSheetFlow
    if (emb) {
      setCustomerId(emb.customerId)
      setDueDate(defaultDueDateStr())
      setOrderDate(emb.initialOrderDate?.trim() || new Date().toISOString().slice(0, 10))
      specHydratedRef.current = true
    }
  }, [productId, jobSheetId, embedded, embCustomerId, embOrderMode, embOrderId])

  useEffect(() => {
    if (!embedded) return
    const od = embInitialOrderDate?.trim() || new Date().toISOString().slice(0, 10)
    setOrderDate(od)
  }, [embedded, embInitialOrderDate])

  useEffect(() => {
    if (embedded) return
    void dispatch(fetchProduct(productId))
  }, [dispatch, productId, embedded])

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [dispatch, jobSheetId])

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    void dispatch(fetchQuoteRatebook())
  }, [dispatch, jobSheetId, embedded])

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers({ page: 1, page_size: CUSTOMER_PICKER_PAGE_SIZE, q: '' }))
  }, [dispatch, jobSheetId, embedded, customersStatus])

  useEffect(() => {
    if (jobSheetId || embedded) return
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
  }, [jobSheetId, embedded, data, productDetail?.status, productDetail?.error])

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
    if (lastHydratedJobDetailDataRef.current === st.data) return
    lastHydratedJobDetailDataRef.current = st.data
    const res = st.data
    const js = res.job_sheet
    const isImportDraft = Boolean(js?.is_import_draft)
    let loadedSpec0 = ensureSpec(res.spec_payload)
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
    setDueDate(js?.due_date || '')
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
    specHydratedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `qty.hydrate` is stable; listing `qty` reruns on every render.
  }, [jobSheetId, jobSheetDetail])

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
    if (embedded) return !savingEmbeddedJob && !createSaving
    return !!productId && !saving && !savingEmbeddedJob
  }, [embedded, productId, saving, savingEmbeddedJob, createSaving])

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
      setJobSaveErr(null)
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
        await dispatch(
          updateJobSheet({
            jobSheetId,
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
        setDirty(false)
        await Promise.resolve(onDone?.())
      } catch (e: unknown) {
        if (isRejectedWithValue(e)) {
          const p = e.payload as UpsertError
          setJobSaveErr(p.message || 'Failed to save job sheet')
        } else if (e instanceof ApiError && e.body?.detail != null) {
          const { messages } = parseFastApiValidationDetail(e.body.detail)
          setJobSaveErr(messages.length > 0 ? messages.join(' · ') : e.message)
        } else {
          setJobSaveErr(e instanceof Error ? e.message : 'Failed to save job sheet')
        }
      } finally {
        setSavingEmbeddedJob(false)
      }
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
      if (returnTo) nav(returnTo)
      else if (vid) nav(`/products/${productId}/versions/${vid}`)
      else nav(`/products/${productId}`)
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
    const vid = data?.product?.active_version_id
    if (productId && vid) return { kind: 'product_version', productId, versionId: String(vid) }
    return null
  }, [jobSheetId, embedded, data?.product?.active_version_id, productId])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))

  const waitingForJobSheet =
    !!jobSheetId &&
    (!jobSheetDetail || jobSheetDetail.status === 'loading' || jobSheetDetail.status === 'idle')

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
  if (waitingForJobSheet) return <p>Loading…</p>

  const busy = saving || savingEmbeddedJob || createSaving

  return (
    <Box
      onChange={() => {
        setDirty(true)
        setJobSaveErr(null)
      }}
    >
      <Stack spacing={2}>
        <Typography variant="h5">{title || `Edit ${product?.code || ''}`.trim()}</Typography>

        <FormErrorAlert
          error={embedded ? createErr || jobSaveErr : err || jobSaveErr}
          messages={embedded ? createMessages : errorSummary}
          scrollOnShow={true}
          scrollMarginTop={80}
        />

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0 }}>
            <Stack spacing={2}>
              {jobSheetId || embedded ? (
                <JobSheetIdentityQuantitySection
                  title="Job Sheet"
                  jobCode={loadedJobSheet?.job_no ? String(loadedJobSheet.job_no) : null}
                  customers={customers as any}
                  customersStatus={customersStatus}
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

              {isNarrow ? (
                <JobSheetPreviewPanel
                  showJobFields={false}
                  jobSheetId={jobSheetId ? String(jobSheetId) : null}
                  productCode={previewProductCode}
                  description={previewDescription}
                  myobImportLineDescription={myobImportLineDescription}
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
                        target="_blank"
                        rel="noreferrer"
                        underline="hover"
                        sx={{ fontSize: '0.875rem' }}
                      >
                        View previous versions
                      </MuiLink>
                    ) : null}
                  </Box>
                  <SpecPayloadForm
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
                    afterDimensionsSlot={
                      <>
                        <Paper variant="outlined" sx={{ p: 2 }}>
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
                        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
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
                      target="_blank"
                      rel="noreferrer"
                      underline="hover"
                      sx={{ fontSize: '0.875rem' }}
                    >
                      View previous versions
                    </MuiLink>
                  </Box>
                  <SpecPayloadForm
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

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {onCancel ? (
                  <Button type="button" variant="text" color="primary" onClick={onCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button component={Link} to={returnTo || `/products/${productId}`} variant="text" color="primary">
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="contained" disabled={!canSubmit || busy}>
                  {busy
                    ? 'Saving…'
                    : submitLabel || (embedded ? 'Create job sheet' : jobSheetId ? 'Save job sheet & spec' : 'Save Changes')}
                </Button>
              </Box>
            </Stack>
          </form>

          {!isNarrow ? (
            <StickySideAside>
              <JobSheetPreviewPanel
                showJobFields={false}
                jobSheetId={jobSheetId ? String(jobSheetId) : null}
                productCode={previewProductCode}
                description={previewDescription}
                myobImportLineDescription={myobImportLineDescription}
              />
            </StickySideAside>
          ) : null}
        </Box>
      </Stack>
    </Box>
  )
}

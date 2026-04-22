import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../../components/SpecPayloadForm'
import type { PrintingArtworkScope } from '../../../components/PrintingArtworkUploadSection'
import { Box, Button, Link as MuiLink, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
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
  JobSheetQuantityPaper,
  type JobSheetQuantityFieldsProps,
} from '../../job-sheets/components/JobSheetIdentityQuantitySection'
import { computeDerivedGeometryAndTotals, getRollWeightAvgKg } from '../../../utils/quoteCalculator'
import { buildQuickQuoteInputsFromSpec } from '../../../utils/specToQuoteInputs'
import {
  cartonsWeightPerRollKg,
  coerceQtyTypeForFinishMode,
  computeRollsDisplay,
  computeTotalKgDisplay,
  computeWeightPerRollDisplay,
  getFieldEditability,
  getOrderQuantityFromJobSheetFields,
  resolveNumRollsForPersistence,
  resolveWeightPerRollForPersistence,
  validateJobSheetQuantityInputs,
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

function formatKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

function roundTo2Decimals(s: string): string {
  if (s.trim() === '') return s
  const n = Number(s)
  return Number.isFinite(n) ? n.toFixed(2) : s
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
  onDone?: (versionId?: string) => void
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
  const [qtyType, setQtyType] = useState<QtyType>('kg')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('1')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')
  const [unitsPerRoll, setUnitsPerRoll] = useState('')
  const orderDateInputRef = useRef<HTMLInputElement | null>(null)
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)

  const productDetail = useAppSelector((s) => s.products.detail.byId[productId])
  const data = productDetail?.data
  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const ratebook = useAppSelector((s) => s.quotes.quoteRatebook.data)

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
  /** After server hydrate, avoid treating loaded Cartons as Rolls → Cartons (would overwrite weight with conversion default). */
  const prevFinishModeForCartonWprRef = useRef<FinishMode | null>(null)

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
    setCustomerId('')
    setDueDate('')
    setOrderDate('')
    setQtyType('kg')
    setTotalKg('')
    setNumRolls('1')
    setWeightPerRoll('')
    setNumUnits('')
    setUnitsPerRoll('')
    setJobSaveErr(null)
    prevFinishModeForCartonWprRef.current = null
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
    const loadedSpec = ensureSpec(res.spec_payload)
    setSpec(loadedSpec)
    setCustomerId(js?.customer_id || '')
    setOrderDate(js?.order_date ? String(js.order_date).slice(0, 10) : '')
    setDueDate(js?.due_date || '')
    const fm: FinishMode = loadedSpec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
    const rawQt = (js?.qty_type as QtyType) || inferQtyTypeFromUnit(js?.quantity_unit)
    const pt = String(loadedSpec.identity?.product_type || 'Bag')
    const lenRaw = String(loadedSpec.dimensions?.length_units || '')
    const continuousLength =
      pt === 'Tube' || lenRaw === 'Continuous' || lenRaw.toLowerCase() === 'continuous'
    const qt = coerceQtyTypeForFinishMode(fm, rawQt, continuousLength)
    setQtyType(qt === 'units_per_1000' ? 'units' : qt)
    const nrStored = js?.num_rolls != null ? Math.max(1, Number(js.num_rolls)) : 1
    const wpr =
      js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
        ? String(js.weight_per_roll_kg)
        : ''
    if (qt === 'kg') {
      setTotalKg(String(js?.quantity_value ?? ''))
      setNumUnits('')
      setUnitsPerRoll('')
      setNumRolls(String(nrStored))
      setWeightPerRoll(wpr)
    } else if (qt === 'units_per_1000') {
      const abs =
        js?.num_product_units != null && Number.isFinite(Number(js.num_product_units))
          ? Math.max(0, Math.round(Number(js.num_product_units)))
          : Math.max(0, Math.round(Number(js?.quantity_value ?? 0) * 1000))
      setNumUnits(abs > 0 ? String(abs) : '')
      setTotalKg('')
      setUnitsPerRoll('')
      setNumRolls(String(nrStored))
      setWeightPerRoll(wpr)
    } else if (qt === 'units') {
      const quRaw = String(js?.quantity_unit || '').toLowerCase()
      if (quRaw === 'cartons' && js?.num_product_units != null) {
        setNumUnits(String(js.num_product_units))
      } else {
        setNumUnits(String(js?.num_product_units ?? js?.quantity_value ?? ''))
      }
      setTotalKg('')
      setUnitsPerRoll('')
      setNumRolls(String(nrStored))
      setWeightPerRoll(wpr)
    } else if (qt === 'rolls_units') {
      setNumRolls(String(nrStored))
      setTotalKg('')
      setNumUnits('')
      const npu = js?.num_product_units != null ? Number(js.num_product_units) : NaN
      if (Number.isFinite(npu) && npu > 0 && nrStored > 0) {
        setUnitsPerRoll(String(Math.max(1, Math.round(npu / nrStored))))
      } else {
        setUnitsPerRoll('')
      }
      setWeightPerRoll(wpr)
    } else {
      setUnitsPerRoll('')
      setNumRolls(String(js?.num_rolls ?? js?.quantity_value ?? nrStored))
      setWeightPerRoll(wpr)
      setTotalKg('')
      setNumUnits('')
    }
    specHydratedRef.current = true
    prevFinishModeForCartonWprRef.current = fm
  }, [jobSheetId, jobSheetDetail])

  const finishMode: FinishMode = spec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const productType = (spec.identity?.product_type as string) || 'Bag'
  const lengthUnitsRaw = String(spec.dimensions?.length_units || '')
  const isContinuousLength =
    productType === 'Tube' || lengthUnitsRaw === 'Continuous' || lengthUnitsRaw.toLowerCase() === 'continuous'
  const effectiveQtyType = useMemo(
    () => coerceQtyTypeForFinishMode(finishMode, qtyType, isContinuousLength),
    [finishMode, qtyType, isContinuousLength],
  )

  const totalKgNum = Number(totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(numRolls || 0)))
  const weightPerRollNum = Number(weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(numUnits || 0)))
  const unitsPerRollNum = Math.max(0, Math.round(Number(unitsPerRoll || 0)))

  const derivedForDisplay = useMemo(() => {
    if ((!jobSheetId && !embedded) || !ratebook) return null
    try {
      const inputs = buildQuickQuoteInputsFromSpec(
        spec,
        {
          qtyType: effectiveQtyType,
          totalKg: totalKgNum,
          numUnits: numUnitsNum,
          numRolls: numRollsNum,
          weightPerRoll: weightPerRollNum,
          unitsPerRoll: unitsPerRollNum,
        },
        { ratebook },
      )
      return computeDerivedGeometryAndTotals(inputs, ratebook)
    } catch {
      return null
    }
  }, [jobSheetId, embedded, ratebook, spec, effectiveQtyType, totalKgNum, numUnitsNum, numRollsNum, weightPerRollNum, unitsPerRollNum])

  const totalMetersReadonly = useMemo(() => {
    if (!jobSheetId && !embedded) return '—'
    if (!ratebook) return '…'
    if (!derivedForDisplay) return '—'
    const m = derivedForDisplay.derivedTotalM
    if (m == null || !Number.isFinite(Number(m)) || Number(m) <= 0) return '—'
    return `${Math.round(Number(m)).toLocaleString()} m`
  }, [jobSheetId, embedded, ratebook, derivedForDisplay])

  const derivedDisplay = derivedForDisplay
    ? {
        derivedTotalKg: derivedForDisplay.derivedTotalKg ?? null,
        units: derivedForDisplay.units ?? null,
        kgPerRoll: derivedForDisplay.kgPerRoll ?? null,
        billedKgPerRoll: derivedForDisplay.billedKgPerRoll ?? null,
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
  const rollsDisplay = computeRollsDisplay(
    finishMode,
    effectiveQtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    derivedDisplay,
  )
  const weightPerRollDisplay = computeWeightPerRollDisplay(
    effectiveQtyType,
    finishMode,
    numRollsNum,
    weightPerRollNum,
    derivedDisplay,
  )

  const productsPerRollDerived = useMemo(() => {
    const rollCountForProductsPerRoll =
      finishMode === 'Rolls'
        ? rollsDisplay != null && Number(rollsDisplay) > 0
          ? Number(rollsDisplay)
          : numRollsNum > 0
            ? numRollsNum
            : null
        : numRollsNum > 0
          ? numRollsNum
          : null
    const totalProductsCountForPerRoll =
      effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000'
        ? numUnitsNum > 0
          ? numUnitsNum
          : null
        : effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0
          ? numRollsNum * unitsPerRollNum
          : derivedForDisplay?.units != null && Number(derivedForDisplay.units) > 0
            ? Number(derivedForDisplay.units)
            : null
    if (
      effectiveQtyType === 'rolls_units' ||
      rollCountForProductsPerRoll == null ||
      !(rollCountForProductsPerRoll > 0) ||
      totalProductsCountForPerRoll == null ||
      !(totalProductsCountForPerRoll > 0)
    ) {
      return null
    }
    return totalProductsCountForPerRoll / rollCountForProductsPerRoll
  }, [finishMode, rollsDisplay, numRollsNum, effectiveQtyType, numUnitsNum, unitsPerRollNum, derivedForDisplay?.units])

  const unitsDisplay = useMemo(() => {
    if (effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000') return numUnitsNum
    if (effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) return numRollsNum * unitsPerRollNum
    const u = derivedForDisplay?.units
    return u != null && Number.isFinite(Number(u)) ? Number(u) : null
  }, [effectiveQtyType, numUnitsNum, numRollsNum, unitsPerRollNum, derivedForDisplay?.units])

  const edit = getFieldEditability(finishMode, effectiveQtyType)
  const totalKgEditable = edit.totalKgEditable
  const unitsEditable = edit.unitsEditable
  const rollsEditable = edit.rollsEditable || edit.cartonsRollCountEditable
  const weightPerRollEditable = edit.weightPerRollEditable && finishMode !== 'Cartons'

  const haveDriverForTotalKg =
    ((effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000') && numUnitsNum > 0) ||
    (effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) ||
    (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    numRollsNum > 0 &&
    ((effectiveQtyType === 'kg' && totalKgNum > 0) ||
      ((effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000') && numUnitsNum > 0) ||
      (effectiveQtyType === 'rolls_units' && unitsPerRollNum > 0))

  useEffect(() => {
    setQtyType((t) => coerceQtyTypeForFinishMode(finishMode, t))
  }, [finishMode])

  /** Carton finish: default weight/roll to conversion factor `roll_weight_avg` (Average Roll Weight in admin). */
  useEffect(() => {
    const prev = prevFinishModeForCartonWprRef.current
    if (finishMode === 'Cartons' && prev === 'Rolls') {
      const avg = getRollWeightAvgKg(ratebook)
      if (avg > 0) setWeightPerRoll(roundTo2Decimals(String(avg)))
    }
    prevFinishModeForCartonWprRef.current = finishMode
  }, [finishMode, ratebook])

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    if (
      effectiveQtyType === 'units' ||
      effectiveQtyType === 'units_per_1000' ||
      effectiveQtyType === 'rolls_units'
    )
      return
    if (derivedForDisplay?.units == null) return
    const fromKgOrRollsMode =
      (effectiveQtyType === 'kg' && totalKgNum > 0) ||
      (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
    const fromContinuousRolls =
      isContinuousLength &&
      finishMode === 'Rolls' &&
      derivedForDisplay.rolls != null &&
      Number(derivedForDisplay.rolls) > 0
    if (!(fromKgOrRollsMode || fromContinuousRolls)) return
    const computed = Math.round(Number(derivedForDisplay.units))
    setNumUnits(Number.isFinite(computed) && computed >= 0 ? String(computed) : '')
  }, [
    jobSheetId,
    embedded,
    effectiveQtyType,
    totalKgNum,
    numRollsNum,
    weightPerRollNum,
    finishMode,
    isContinuousLength,
    derivedForDisplay?.units,
    derivedForDisplay?.rolls,
  ])

  useEffect(() => {
    if (!jobSheetId && !embedded) return
    if (effectiveQtyType !== 'rolls_units') return
    const w = derivedForDisplay?.billedKgPerRoll ?? derivedForDisplay?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) {
      setWeightPerRoll(roundTo2Decimals(String(w)))
    }
  }, [jobSheetId, embedded, effectiveQtyType, derivedForDisplay?.billedKgPerRoll, derivedForDisplay?.kgPerRoll])

  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`
  const productTypeIsBag = productType === 'Bag'

  const loadedJobSheet = jobSheetId && jobSheetDetail?.status === 'succeeded' ? jobSheetDetail.data?.job_sheet : undefined

  const bagsPerCartonStr = spec.packaging?.bags_per_carton != null ? String(spec.packaging.bags_per_carton) : ''

  const jobSheetQuantityFieldsProps: JobSheetQuantityFieldsProps = {
    productUnitLabel,
    productTypeIsBag,
    showRollsUnitsQtyType: !isContinuousLength,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange: (v) => {
      setQtyType(v)
      setDirty(true)
    },
    totalMetersReadonly,
    totalKgField: {
      value:
        totalKgEditable
          ? totalKg
          : haveDriverForTotalKg && totalKgDisplay != null
            ? formatKgDisplay(totalKgDisplay)
            : totalKg !== '' && Number.isFinite(Number(totalKg))
              ? formatKgDisplay(Number(totalKg))
              : totalKg,
      onChange: totalKgEditable ? (v) => { setTotalKg(v); setDirty(true) } : undefined,
      disabled: !totalKgEditable,
      required: effectiveQtyType === 'kg',
    },
    rollOrCartonSizingField: {
      rollsLabel: `${productUnitLabel} per roll`,
      rollsValue:
        effectiveQtyType === 'rolls_units'
          ? unitsPerRoll
          : productsPerRollDerived != null
            ? formatKgDisplay(productsPerRollDerived)
            : '',
      rollsOnChange:
        effectiveQtyType === 'rolls_units'
          ? (v) => {
              setUnitsPerRoll(v)
              setDirty(true)
            }
          : undefined,
      rollsDisabled: effectiveQtyType !== 'rolls_units',
      rollsInputStep: effectiveQtyType === 'rolls_units' ? 1 : 'any',
      cartonsLabel: `${productUnitLabel} per Carton`,
      cartonsValue: bagsPerCartonStr,
      cartonsOnChange: (v) => {
        setSpec((prev: SpecPayload) => ({
          ...prev,
          packaging: {
            ...prev.packaging,
            bags_per_carton: v.trim() === '' ? null : Math.max(1, Math.round(Number(v))),
          },
        }))
        setDirty(true)
      },
    },
    weightPerRollField: {
      value:
        weightPerRollEditable
          ? weightPerRoll
          : effectiveQtyType === 'rolls_units' && finishMode === 'Rolls'
            ? weightPerRollDisplay != null
              ? formatKgDisplay(weightPerRollDisplay)
              : ''
            : haveDriverForWeightPerRoll && weightPerRollDisplay != null
              ? formatKgDisplay(weightPerRollDisplay)
              : finishMode === 'Cartons' && totalKgNum > 0 && numRollsNum > 0
                ? formatKgDisplay(cartonsWeightPerRollKg(totalKgNum, numRollsNum) ?? 0)
                : weightPerRoll !== '' && Number.isFinite(Number(weightPerRoll))
                  ? formatKgDisplay(Number(weightPerRoll))
                  : weightPerRoll,
      onChange: weightPerRollEditable ? (v) => { setWeightPerRoll(v); setDirty(true) } : undefined,
      disabled: !weightPerRollEditable,
      helperText: finishMode === 'Cartons' ? 'Derived from total KG ÷ rolls (scheduling).' : undefined,
    },
    numRollsField: {
      value:
        rollsEditable
          ? numRolls
          : rollsDisplay != null && finishMode === 'Rolls'
            ? String(rollsDisplay)
            : finishMode === 'Cartons'
              ? '—'
              : numRolls,
      onChange: rollsEditable ? (v) => { setNumRolls(v); setDirty(true) } : undefined,
      disabled: !rollsEditable,
      required: true,
    },
    totalProductsField: {
      value:
        unitsEditable
          ? numUnits
          : unitsDisplay != null && Number.isFinite(Number(unitsDisplay))
            ? String(Math.round(Number(unitsDisplay)))
            : numUnits !== '' && Number.isFinite(Number(numUnits))
              ? String(Math.round(Number(numUnits)))
              : '',
      onChange: unitsEditable ? (v) => { setNumUnits(v); setDirty(true) } : undefined,
      disabled: !unitsEditable,
    },
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
        setJobSaveErr('Product code is empty. Set a product code or complete dimensions and product type.')
        return
      }
      const missing: string[] = []
      if (!customerId) missing.push('Customer')
      if (!dueDate) missing.push('Due Date')
      if (missing.length > 0) {
        setJobSaveErr(`Missing required fields: ${missing.join(', ')}`)
        return
      }
      const qtyErr = validateJobSheetQuantityInputs(
        finishMode,
        effectiveQtyType,
        totalKgNum,
        numUnitsNum,
        numRollsNum,
        finishMode === 'Cartons' ? (cartonsWeightPerRollKg(totalKgNum, numRollsNum) ?? 0) : weightPerRollNum,
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
          totalKgNum,
          numRollsNum,
          weightPerRollNum,
          derivedDisplay,
        )
        const bpc = spec.packaging?.bags_per_carton
        const oq = getOrderQuantityFromJobSheetFields(
          effectiveQtyType,
          1,
          totalKgNum,
          numUnitsNum,
          persistedRolls,
          finishMode,
          bpc != null ? Number(bpc) : null,
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
                  effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000'
                    ? numUnitsNum
                    : derivedForDisplay?.units != null
                      ? Math.round(Number(derivedForDisplay.units))
                      : null,
                weight_per_roll_kg: persistedWpr,
                num_rolls: persistedRolls,
                spec,
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
      if (!dueDate) missing.push('Due Date')
      if (missing.length > 0) {
        setJobSaveErr(`Missing required fields: ${missing.join(', ')}`)
        return
      }
      const qtyErr = validateJobSheetQuantityInputs(
        finishMode,
        effectiveQtyType,
        totalKgNum,
        numUnitsNum,
        numRollsNum,
        finishMode === 'Cartons' ? (cartonsWeightPerRollKg(totalKgNum, numRollsNum) ?? 0) : weightPerRollNum,
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
          totalKgNum,
          numRollsNum,
          weightPerRollNum,
          derivedDisplay,
        )
        const fallbackLegacy = Number(loadedJobSheet?.quantity_value) > 0 ? Number(loadedJobSheet?.quantity_value) : 1
        const bpc = spec.packaging?.bags_per_carton
        const oq = getOrderQuantityFromJobSheetFields(
          effectiveQtyType,
          fallbackLegacy,
          totalKgNum,
          numUnitsNum,
          persistedRolls,
          finishMode,
          bpc != null ? Number(bpc) : null,
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
                effectiveQtyType === 'units' || effectiveQtyType === 'units_per_1000'
                  ? numUnitsNum
                  : derivedForDisplay?.units != null
                    ? Math.round(Number(derivedForDisplay.units))
                    : null,
              weight_per_roll_kg: persistedWpr,
              num_rolls: persistedRolls,
              spec,
            },
          }),
        ).unwrap()
        setDirty(false)
        onDone?.()
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
        onDone(vid)
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
                    afterDimensionsSlot={<JobSheetQuantityPaper {...jobSheetQuantityFieldsProps} />}
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
              />
            </StickySideAside>
          ) : null}
        </Box>
      </Stack>
    </Box>
  )
}

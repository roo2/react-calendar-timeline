import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../../../store/slices/productsSlice'
import { Link, useNavigate } from 'react-router-dom'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals } from '../../../utils/quoteCalculator'
import { buildQuickQuoteInputsFromSpec } from '../../../utils/specToQuoteInputs'
import {
  coerceQtyTypeForFinishMode,
  computeRollsDisplay,
  computeTotalKgDisplay,
  computeWeightPerRollDisplay,
  getFieldEditability,
  getOrderQuantityFromJobSheetFields,
  resolveNumRollsForPersistence,
  resolveWeightPerRollForPersistence,
  validateJobSheetQuantityInputs,
  cartonsWeightPerRollKg,
  type FinishMode,
  type QtyType,
} from '../../../utils/quantityRollFields'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  TextField,
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
import { fetchCustomers } from '../../../store/slices/customersSlice'
import { clearCreateErrors, createProduct, fetchProduct, fetchProducts } from '../../../store/slices/productsSlice'
import { createJobSheet, fetchJobSheet, updateJobSheet } from '../../../store/slices/jobSheetsSlice'
import { computeProductDescriptionFromSpec, computeProductCodeFromSpec } from '../../../utils/productDescription'
import { JobSheetPreviewPanel } from '../../../components/JobSheetPreviewPanel'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../../components/SpecPayloadForm'
import { StickySideAside } from '../../../components/StickySideAside'
import {
  JobSheetIdentityQuantitySection,
  JobSheetQuantityPaper,
  type JobSheetQuantityFieldsProps,
} from './JobSheetIdentityQuantitySection'

type Mode = 'new' | 'edit'

type ProductSummary = ProductListItem

type ProductVersionSummary = {
  id: string
  version_number?: number
  spec_payload?: any
}

function formatKgDisplay(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
  return 'units'
}

/** Placeholder select value while composing a new product (not a real product id until save). */
const NEW_PRODUCT_DRAFT_VALUE = '__new_product_draft__'

function formatProductMenuLabel(code: string, description: string): string {
  const c = (code || '').trim()
  const d = (description || '').trim()
  if (!c && !d) return 'New product (complete spec for code)'
  return d ? `${c} — ${d}` : c
}

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
  const productList = useAppSelector((s) => s.products.list)
  const jobSheetDetail = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const { setDirty } = useUnsavedChanges()
  const [savingJobSheet, setSavingJobSheet] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [qtyType, setQtyType] = useState<QtyType>('kg')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('1')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderId, setOrderId] = useState('')
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)
  const orderDateInputRef = useRef<HTMLInputElement | null>(null)

  const [productId, setProductId] = useState('')
  const productDetail = useAppSelector((s) =>
    productId && productId !== NEW_PRODUCT_DRAFT_VALUE ? s.products.detail.byId[productId] : undefined,
  )
  const [productInfo, setProductInfo] = useState<ProductSummary | null>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [specDirty, setSpecDirty] = useState(false)

  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [specFieldErrors, setSpecFieldErrors] = useState<Record<string, string>>({})

  /** New job sheet: show Product Spec after user clicks "New Product" or selects an existing product. */
  const [wantsNewProductFlow, setWantsNewProductFlow] = useState(false)

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers(undefined))
  }, [customersStatus, dispatch])

  const quoteRatebookState = useAppSelector((s) => s.quotes.quoteRatebook)
  const ratebook = quoteRatebookState.data

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  const products = useMemo((): ProductSummary[] => {
    if (!customerId || productList.lastCustomerId !== customerId) return []
    return productList.items as ProductSummary[]
  }, [customerId, productList.items, productList.lastCustomerId])

  const productsErr =
    customerId && productList.lastCustomerId === customerId && productList.status === 'failed' ? productList.error : null

  const productsLoading = Boolean(customerId && productList.status === 'loading')

  /** Re-hydrate when fetch returns a new detail payload (same id, fresher object). */
  const lastJobDetailDataRef = useRef<unknown>(null)
  const productSpecHydratedRef = useRef<string | null>(null)

  useEffect(() => {
    lastJobDetailDataRef.current = null
  }, [jobSheetId])

  useEffect(() => {
    productSpecHydratedRef.current = null
  }, [productId])

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
    setInvoiceNo(js?.invoice_no ?? '')
    setOrderDate(js?.order_date ? String(js.order_date).slice(0, 10) : '')
    setOrderId(js?.order_id ? String(js.order_id) : '')
    const loadedSpec = ensureSpec(res?.spec_payload)
    setSpec(loadedSpec)
    const fm: FinishMode = loadedSpec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
    const rawQt = (js?.qty_type as QtyType) || inferQtyTypeFromUnit(js?.quantity_unit)
    const qt = coerceQtyTypeForFinishMode(fm, rawQt)
    setQtyType(qt)
    const nrStored = js?.num_rolls != null ? Math.max(1, Number(js.num_rolls)) : 1
    const wpr =
      js?.weight_per_roll_kg != null && Number.isFinite(Number(js.weight_per_roll_kg))
        ? String(js.weight_per_roll_kg)
        : ''
    if (qt === 'kg') {
      setTotalKg(String(js?.quantity_value ?? ''))
      setNumUnits('')
      setNumRolls(String(nrStored))
      setWeightPerRoll(wpr)
    } else if (qt === 'units') {
      setNumUnits(String(js?.num_product_units ?? js?.quantity_value ?? ''))
      setTotalKg('')
      setNumRolls(String(nrStored))
      setWeightPerRoll(wpr)
    } else {
      setNumRolls(String(js?.num_rolls ?? js?.quantity_value ?? nrStored))
      setWeightPerRoll(wpr)
      setTotalKg('')
      setNumUnits('')
    }
  }, [mode, jobSheetId, jobSheetDetail])

  // New mode: when customer changes, reload product list and reset selection
  useEffect(() => {
    if (mode !== 'new') return
    setProductId('')
    setProductInfo(null)
    setSpec(makeDefaultSpec())
    setSpecDirty(false)
    setSaveMsg(null)
    setWantsNewProductFlow(false)
    setQtyType('kg')
    setTotalKg('')
    setNumRolls('1')
    setWeightPerRoll('')
    setNumUnits('')
    if (!customerId) return
    void dispatch(fetchProducts({ customer_id: customerId }))
  }, [customerId, mode, dispatch])

  // New mode: request product detail when a product is selected
  useEffect(() => {
    if (mode !== 'new') return
    if (!productId || productId === NEW_PRODUCT_DRAFT_VALUE) return
    setSaveMsg(null)
    setSpecDirty(false)
    void dispatch(fetchProduct(productId))
  }, [mode, productId, dispatch])

  // New mode: apply product detail (spec + productInfo) once per selection
  useEffect(() => {
    if (mode !== 'new') return
    if (!productId || productId === NEW_PRODUCT_DRAFT_VALUE) return
    const st = productDetail
    if (!st) return
    if (st.status === 'failed') {
      setSaveErr(st.error || 'Failed to load product details')
      return
    }
    if (st.status !== 'succeeded' || !st.data) return
    if (productSpecHydratedRef.current === productId) return
    productSpecHydratedRef.current = productId
    setSaveErr(null)
    const res = st.data
    setProductInfo(res.product || null)
    const vs = Array.isArray(res.versions) ? res.versions : []
    const activeId = res.product?.active_version_id
    const active = activeId ? vs.find((v: ProductVersionSummary) => v.id === activeId) : null
    const latest = vs.slice().sort((a: ProductVersionSummary, b: ProductVersionSummary) => (b.version_number || 0) - (a.version_number || 0))[0]
    const srcSpec = (active?.spec_payload || latest?.spec_payload) ?? null
    setSpec(ensureSpec(srcSpec))
  }, [mode, productId, productDetail])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => computeProductCodeFromSpec(spec), [spec])

  const finishMode: FinishMode = spec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const effectiveQtyType = useMemo(() => coerceQtyTypeForFinishMode(finishMode, qtyType), [finishMode, qtyType])

  const totalKgNum = Number(totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(numRolls || 0)))
  const weightPerRollNum = Number(weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(numUnits || 0)))

  const derivedForDisplay = useMemo(() => {
    if (!ratebook) return null
    try {
      const inputs = buildQuickQuoteInputsFromSpec(
        spec,
        {
          qtyType: effectiveQtyType,
          totalKg: totalKgNum,
          numUnits: numUnitsNum,
          numRolls: numRollsNum,
          weightPerRoll: weightPerRollNum,
        },
        {},
      )
      return computeDerivedGeometryAndTotals(inputs, ratebook)
    } catch {
      return null
    }
  }, [ratebook, spec, effectiveQtyType, totalKgNum, numUnitsNum, numRollsNum, weightPerRollNum])

  const totalMetersReadonly = useMemo(() => {
    if (!ratebook) return '…'
    if (!derivedForDisplay) return '—'
    const m = derivedForDisplay.derivedTotalM
    if (m == null || !Number.isFinite(Number(m)) || Number(m) <= 0) return '—'
    return `${Math.round(Number(m)).toLocaleString()} m`
  }, [ratebook, derivedForDisplay])

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

  const edit = getFieldEditability(finishMode, effectiveQtyType)
  const totalKgEditable = edit.totalKgEditable
  const unitsEditable = edit.unitsEditable
  const rollsEditable = edit.rollsEditable || edit.cartonsRollCountEditable
  const weightPerRollEditable = edit.weightPerRollEditable && finishMode !== 'Cartons'

  const haveDriverForTotalKg =
    (effectiveQtyType === 'units' && numUnitsNum > 0) ||
    (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForUnits =
    (effectiveQtyType === 'kg' && totalKgNum > 0) ||
    (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    numRollsNum > 0 &&
    ((effectiveQtyType === 'kg' && totalKgNum > 0) || (effectiveQtyType === 'units' && numUnitsNum > 0))

  useEffect(() => {
    setQtyType((t) => coerceQtyTypeForFinishMode(finishMode, t))
  }, [finishMode])

  useEffect(() => {
    if (
      effectiveQtyType !== 'units' &&
      derivedForDisplay?.units != null &&
      ((effectiveQtyType === 'kg' && totalKgNum > 0) ||
        (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0))
    ) {
      const computed = Math.round(Number(derivedForDisplay.units))
      setNumUnits(Number.isFinite(computed) && computed >= 0 ? String(computed) : '')
    }
  }, [effectiveQtyType, totalKgNum, numRollsNum, weightPerRollNum, derivedForDisplay?.units])

  const productType = (spec.identity?.product_type as string) || 'Bag'
  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`

  const loadedJobSheet = mode === 'edit' && jobSheetId ? jobSheetDetail?.data?.job_sheet : undefined

  async function onSave() {
    setSaveMsg(null)
    setSaveErr(null)
    setSpecFieldErrors({})

    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (!productId) missing.push('Product')
    if (!dueDate) missing.push('Due Date')
    if (missing.length > 0) {
      setSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return
    }
    const qtyErr = validateJobSheetQuantityInputs(
      finishMode,
      effectiveQtyType,
      totalKgNum,
      numUnitsNum,
      numRollsNum,
      finishMode === 'Cartons' ? (cartonsWeightPerRollKg(totalKgNum, numRollsNum) ?? 0) : weightPerRollNum,
    )
    if (qtyErr) {
      setSaveErr(qtyErr)
      return
    }
    if (savingJobSheet) return

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
        totalKgNum,
        numRollsNum,
        weightPerRollNum,
        derivedDisplay,
      )
      const fallbackLegacy = Number(loadedJobSheet?.quantity_value) > 0 ? Number(loadedJobSheet?.quantity_value) : 1
      const oq = getOrderQuantityFromJobSheetFields(
        effectiveQtyType,
        fallbackLegacy,
        totalKgNum,
        numUnitsNum,
        persistedRolls,
      )

      let effectiveProductId = productId
      if (mode === 'new' && productId === NEW_PRODUCT_DRAFT_VALUE) {
        const code = previewProductCode.trim()
        if (!code) {
          setSaveErr('Complete the product spec so a product code is generated before saving.')
          setSavingJobSheet(false)
          return
        }
        dispatch(clearCreateErrors())
        try {
          const created = await dispatch(
            createProduct({
              data: {
                customer_id: customerId,
                code,
                spec,
              },
            }),
          ).unwrap()
          const pid = created?.product?.id as string | undefined
          if (!pid) throw new Error('Product was created but no id was returned')
          effectiveProductId = pid
          setProductId(pid)
          setWantsNewProductFlow(false)
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
          return
        }
      }

      if (mode === 'new') {
        const res = await dispatch(
          createJobSheet({
            customer_id: customerId,
            product_id: effectiveProductId,
            due_date: dueDate,
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
            spec,
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
        if (id) nav(returnTo || `/job-sheets/${id}`)
      } else {
        if (!jobSheetId) throw new Error('Missing job sheet id')
        const body: Record<string, unknown> = {
          due_date: dueDate,
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
        }
        if (specDirty) body.spec = spec
        const res = await dispatch(updateJobSheet({ jobSheetId, body })).unwrap()
        const id = res?.job_sheet?.id
        if (res?.job_sheet?.order_id) setOrderId(String(res.job_sheet.order_id))
        if (res?.job_sheet?.order_date) setOrderDate(String(res.job_sheet.order_date).slice(0, 10))
        if (res?.job_sheet?.invoice_no != null && res?.job_sheet?.invoice_no !== undefined) {
          setInvoiceNo(String(res.job_sheet.invoice_no))
        }
        setSaveMsg('Saved job sheet.')
        setDirty(false)
        if (id) nav(returnTo || `/job-sheets/${id}`)
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
    } finally {
      setSavingJobSheet(false)
    }
  }

  const disableIdentity = mode === 'edit'
  /** New job sheet: Product Spec card is always shown; spec form only after a product (or draft) is chosen. */
  const showSpecForm = mode === 'edit' || (mode === 'new' && !!productId)

  const jobSheetQuantityFieldsProps: JobSheetQuantityFieldsProps = {
    productUnitLabel,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange: setQtyType,
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
      onChange: totalKgEditable ? (v) => setTotalKg(v) : undefined,
      disabled: !totalKgEditable,
      required: effectiveQtyType === 'kg',
    },
    numUnitsField: {
      value:
        unitsEditable
          ? numUnits
          : haveDriverForUnits && derivedForDisplay?.units != null
            ? String(Math.round(Number(derivedForDisplay.units)))
            : numUnits,
      onChange: unitsEditable ? (v) => setNumUnits(v) : undefined,
      disabled: !unitsEditable,
      required: effectiveQtyType === 'units',
    },
    weightPerRollField: {
      value:
        weightPerRollEditable
          ? weightPerRoll
          : haveDriverForWeightPerRoll && weightPerRollDisplay != null
            ? formatKgDisplay(weightPerRollDisplay)
            : finishMode === 'Cartons' && totalKgNum > 0 && numRollsNum > 0
              ? formatKgDisplay(cartonsWeightPerRollKg(totalKgNum, numRollsNum))
              : weightPerRoll !== '' && Number.isFinite(Number(weightPerRoll))
                ? formatKgDisplay(Number(weightPerRoll))
                : weightPerRoll,
      onChange: weightPerRollEditable ? (v) => setWeightPerRoll(v) : undefined,
      disabled: !weightPerRollEditable,
      helperText: finishMode === 'Cartons' ? 'Derived from total KG ÷ rolls (scheduling).' : undefined,
    },
    numRollsField: {
      value:
        rollsEditable
          ? numRolls
          : rollsDisplay != null && finishMode === 'Rolls'
            ? String(rollsDisplay)
            : numRolls,
      onChange: rollsEditable ? (v) => setNumRolls(v) : undefined,
      disabled: !rollsEditable,
      required: true,
    },
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
        <Button variant="contained" onClick={onSave} disabled={savingJobSheet}>
          {savingJobSheet ? 'Saving…' : mode === 'new' ? 'Save job sheet' : 'Save changes'}
        </Button>
      </>
    )
  }

  return (
    <Box onChange={() => setDirty(true)}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
        {(productsErr || createState.error || saveErr) && <Alert severity="error">{productsErr || createState.error || saveErr}</Alert>}
        {saveMsg && <Alert severity="success">{saveMsg}</Alert>}

        <JobSheetIdentityQuantitySection
          jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : null}
          headerActions={renderJobSheetActions()}
          customers={customers as any}
          customersStatus={customersStatus}
          customerId={customerId}
          onCustomerIdChange={setCustomerId}
          customerSelectDisabled={disableIdentity}
          orderDate={orderDate}
          onOrderDateChange={setOrderDate}
          dueDate={dueDate}
          onDueDateChange={setDueDate}
          orderDateInputRef={orderDateInputRef}
          dueDateInputRef={dueDateInputRef}
          includeQuantity={!showSpecForm}
          {...jobSheetQuantityFieldsProps}
          productRow={
            mode === 'edit' ? (
              <TextField
                label="Product"
                value={
                  productInfo
                    ? `${productInfo.code}${productInfo.description ? ` — ${productInfo.description}` : ''}`
                    : productId || ''
                }
                InputProps={{ readOnly: true }}
                fullWidth
                sx={{ '& .MuiInputBase-input': { color: 'text.primary' } }}
              />
            ) : undefined
          }
        />

        {isNarrow ? (
          <JobSheetPreviewPanel
            jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : ''}
            invoiceNo={invoiceNo}
            orderDate={orderDate}
            dueDate={dueDate}
            productCode={previewProductCode}
            description={previewDescription}
          />
        ) : null}

        {mode === 'edit' || mode === 'new' ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'baseline', mb: 1 }}>
              <Typography variant="h6">Product Spec</Typography>
              {productId && productId !== NEW_PRODUCT_DRAFT_VALUE ? (
                <MuiLink
                  component={Link}
                  to={`/products/${productId}`}
                  target="_blank"
                  rel="noreferrer"
                  underline="hover"
                  sx={{ fontSize: '0.875rem' }}
                >
                  View previous versions
                </MuiLink>
              ) : null}
            </Box>

            {mode === 'new' ? (
              <Stack spacing={2} sx={{ mb: showSpecForm ? 2 : 0 }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
                    gap: 2,
                    alignItems: 'flex-start',
                  }}
                >
                  <TextField
                    select
                    label="Product"
                    value={productId}
                    onChange={(e) => {
                      const v = e.target.value
                      setProductId(v)
                      setWantsNewProductFlow(v === NEW_PRODUCT_DRAFT_VALUE)
                    }}
                    required
                    disabled={!customerId || productsLoading || disableIdentity}
                    fullWidth
                    SelectProps={{
                      renderValue: (selected) => {
                        const s = selected as string
                        if (s === NEW_PRODUCT_DRAFT_VALUE) {
                          return formatProductMenuLabel(previewProductCode, previewDescription)
                        }
                        const p = products.find((x) => x.id === s)
                        return p ? formatProductMenuLabel(p.code, p.description ?? '') : s || 'Select…'
                      },
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select…
                    </MenuItem>
                    {wantsNewProductFlow ? (
                      <MenuItem value={NEW_PRODUCT_DRAFT_VALUE}>
                        {formatProductMenuLabel(previewProductCode, previewDescription)}
                      </MenuItem>
                    ) : null}
                    {products.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {formatProductMenuLabel(p.code, p.description ?? '')}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={!customerId}
                    onClick={() => {
                      setWantsNewProductFlow(true)
                      setProductId(NEW_PRODUCT_DRAFT_VALUE)
                      setProductInfo(null)
                      setSpec(makeDefaultSpec())
                      setSpecDirty(false)
                      setSaveMsg(null)
                    }}
                    sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                  >
                    New Product
                  </Button>
                </Box>
                {!showSpecForm ? (
                  <Typography variant="body2">
                    {!customerId
                      ? 'Select a customer first, then choose a product or click New Product to define a spec for this job sheet.'
                      : 'Select a product or click New Product to define a spec for this job sheet.'}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}

            {showSpecForm ? (
              <SpecPayloadForm
                customerId={customerId || undefined}
                printingSurface="job_sheet_summary"
                value={spec}
                fieldErrors={specFieldErrors}
                onChange={(next) => {
                  setSpec(next)
                  setSpecDirty(true)
                  setSpecFieldErrors({})
                }}
                afterDimensionsSlot={<JobSheetQuantityPaper {...jobSheetQuantityFieldsProps} />}
              />
            ) : null}
          </Paper>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>{renderJobSheetActions()}</Box>
        </Stack>

        {!isNarrow ? (
          <StickySideAside>
            <JobSheetPreviewPanel
              jobCode={mode === 'edit' && loadedJobSheet?.job_no ? loadedJobSheet.job_no : ''}
              invoiceNo={invoiceNo}
              orderDate={orderDate}
              dueDate={dueDate}
              productCode={previewProductCode}
              description={previewDescription}
            />
          </StickySideAside>
        ) : null}
      </Box>

    </Box>
  )
}


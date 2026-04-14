import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../../../store/slices/productsSlice'
import { Link, useNavigate } from 'react-router-dom'
import { fetchQuoteRatebook } from '../../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals, getRollWeightAvgKg } from '../../../utils/quoteCalculator'
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
import { fetchCustomers } from '../../../store/slices/customersSlice'
import { clearCreateErrors, createProduct, fetchProducts } from '../../../store/slices/productsSlice'
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

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
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
  const { setDirty } = useUnsavedChanges()
  const [savingJobSheet, setSavingJobSheet] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [qtyType, setQtyType] = useState<QtyType>('kg')
  const [totalKg, setTotalKg] = useState('')
  const [numRolls, setNumRolls] = useState('1')
  const [weightPerRoll, setWeightPerRoll] = useState('')
  const [numUnits, setNumUnits] = useState('')
  const [unitsPerRoll, setUnitsPerRoll] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderId, setOrderId] = useState('')
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

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers(undefined))
  }, [customersStatus, dispatch])

  const quoteRatebookState = useAppSelector((s) => s.quotes.quoteRatebook)
  const ratebook = quoteRatebookState.data

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  /** Re-hydrate when fetch returns a new detail payload (same id, fresher object). */
  const lastJobDetailDataRef = useRef<unknown>(null)
  /** After server hydrate, avoid treating loaded Cartons as Rolls → Cartons (would overwrite weight with conversion default). */
  const prevFinishModeForCartonWprRef = useRef<FinishMode | null>(null)

  useEffect(() => {
    lastJobDetailDataRef.current = null
    prevFinishModeForCartonWprRef.current = null
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
  }, [mode, jobSheetId, jobSheetDetail])

  // New mode: when customer changes, reset draft product spec and quantity drivers
  useEffect(() => {
    if (mode !== 'new') return
    setProductId(NEW_PRODUCT_DRAFT_VALUE)
    setProductInfo(null)
    setSpec(makeDefaultSpec())
    setSpecDirty(false)
    setSaveMsg(null)
    setQtyType('kg')
    setTotalKg('')
    setNumRolls('1')
    setWeightPerRoll('')
    setNumUnits('')
    setUnitsPerRoll('')
    prevFinishModeForCartonWprRef.current = 'Rolls'
  }, [customerId, mode])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => computeProductCodeFromSpec(spec), [spec])

  const finishMode: FinishMode = spec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
  const effectiveQtyType = useMemo(() => coerceQtyTypeForFinishMode(finishMode, qtyType), [finishMode, qtyType])

  const productType = (spec.identity?.product_type as string) || 'Bag'
  const lengthUnitsRaw = String(spec.dimensions?.length_units || '')
  const isContinuousLength =
    productType === 'Tube' || lengthUnitsRaw === 'Continuous' || lengthUnitsRaw.toLowerCase() === 'continuous'

  const totalKgNum = Number(totalKg || 0)
  const numRollsNum = Math.max(0, Math.round(Number(numRolls || 0)))
  const weightPerRollNum = Number(weightPerRoll || 0)
  const numUnitsNum = Math.max(0, Math.round(Number(numUnits || 0)))
  const unitsPerRollNum = Math.max(0, Math.round(Number(unitsPerRoll || 0)))

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
          unitsPerRoll: unitsPerRollNum,
        },
        {},
      )
      return computeDerivedGeometryAndTotals(inputs, ratebook)
    } catch {
      return null
    }
  }, [ratebook, spec, effectiveQtyType, totalKgNum, numUnitsNum, numRollsNum, weightPerRollNum, unitsPerRollNum])

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
      effectiveQtyType === 'units'
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
    if (effectiveQtyType === 'units') return numUnitsNum
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
    (effectiveQtyType === 'units' && numUnitsNum > 0) ||
    (effectiveQtyType === 'rolls_units' && numRollsNum > 0 && unitsPerRollNum > 0) ||
    (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0)
  const haveDriverForWeightPerRoll =
    finishMode === 'Rolls' &&
    numRollsNum > 0 &&
    ((effectiveQtyType === 'kg' && totalKgNum > 0) ||
      (effectiveQtyType === 'units' && numUnitsNum > 0) ||
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
    if (effectiveQtyType === 'units' || effectiveQtyType === 'rolls_units') return
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
    if (effectiveQtyType !== 'rolls_units') return
    const w = derivedForDisplay?.billedKgPerRoll ?? derivedForDisplay?.kgPerRoll
    if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) {
      setWeightPerRoll(roundTo2Decimals(String(w)))
    }
  }, [effectiveQtyType, derivedForDisplay?.billedKgPerRoll, derivedForDisplay?.kgPerRoll])

  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`
  const productTypeIsBag = productType === 'Bag'

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
      unitsPerRollNum,
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
        setSpecDirty(false)
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
  /** Quantity is always edited in the Product Spec area (embedded paper), not in the header card. */
  const includeQuantityInHeader = false

  const bagsPerCartonStr = spec.packaging?.bags_per_carton != null ? String(spec.packaging.bags_per_carton) : ''

  const jobSheetQuantityFieldsProps: JobSheetQuantityFieldsProps = {
    productUnitLabel,
    productTypeIsBag,
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
    rollOrCartonSizingField: {
      rollsLabel: `${productUnitLabel} per roll`,
      rollsValue:
        effectiveQtyType === 'rolls_units'
          ? unitsPerRoll
          : productsPerRollDerived != null
            ? formatKgDisplay(productsPerRollDerived)
            : '',
      rollsOnChange: effectiveQtyType === 'rolls_units' ? (v) => setUnitsPerRoll(v) : undefined,
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
        if (mode === 'edit') setSpecDirty(true)
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
            : finishMode === 'Cartons'
              ? '—'
              : numRolls,
      onChange: rollsEditable ? (v) => setNumRolls(v) : undefined,
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
      onChange: unitsEditable ? (v) => setNumUnits(v) : undefined,
      disabled: !unitsEditable,
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
        {(createState.error || saveErr) && <Alert severity="error">{createState.error || saveErr}</Alert>}
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
          includeQuantity={includeQuantityInHeader}
          {...jobSheetQuantityFieldsProps}
          productRow={
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                {mode === 'new' ? 'Product code (generated)' : 'Product'}
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-word' }}>
                {previewProductCode.trim() || (mode === 'edit' ? productInfo?.code?.trim() : '') || '—'}
              </Typography>
              {(previewDescription.trim() || (mode === 'edit' ? (productInfo?.description || '').trim() : '')) ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {previewDescription.trim() || productInfo?.description}
                </Typography>
              ) : null}
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
            invoiceNo={invoiceNo}
            orderDate={orderDate}
            dueDate={dueDate}
            productCode={previewProductCode}
            description={previewDescription}
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
              value={spec}
              fieldErrors={specFieldErrors}
              onChange={(next) => {
                setSpec(next)
                setSpecDirty(true)
                setSpecFieldErrors({})
              }}
              afterDimensionsSlot={<JobSheetQuantityPaper {...jobSheetQuantityFieldsProps} />}
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


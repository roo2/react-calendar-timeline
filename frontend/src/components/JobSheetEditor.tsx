import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../store/slices/productsSlice'
import { Link, useNavigate } from 'react-router-dom'
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
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchCustomers } from '../store/slices/customersSlice'
import { clearCreateErrors, createProduct, fetchProduct, fetchProducts } from '../store/slices/productsSlice'
import { createJobSheet, fetchJobSheet, updateJobSheet } from '../store/slices/jobSheetsSlice'
import { computeProductDescriptionFromSpec, computeProductCodeFromSpec } from '../utils/productDescription'
import { JobSheetPreviewPanel } from './JobSheetPreviewPanel'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from './SpecPayloadForm'
import { StickySideAside } from './StickySideAside'

type Mode = 'new' | 'edit'

type ProductSummary = ProductListItem

type ProductVersionSummary = {
  id: string
  version_number?: number
  spec_payload?: any
}

type QuantityUnit = 'kg' | 'rolls' | 'bags' | 'meters'

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
  const [qtyUnit, setQtyUnit] = useState<QuantityUnit>('kg')
  const [qtyValue, setQtyValue] = useState<number | ''>('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)

  const [productId, setProductId] = useState('')
  const productDetail = useAppSelector((s) =>
    productId && productId !== NEW_PRODUCT_DRAFT_VALUE ? s.products.detail.byId[productId] : undefined,
  )
  const [productInfo, setProductInfo] = useState<ProductSummary | null>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [specDirty, setSpecDirty] = useState(false)

  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  /** New job sheet: show Product Spec after user clicks "New Product" or selects an existing product. */
  const [wantsNewProductFlow, setWantsNewProductFlow] = useState(false)

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers(undefined))
  }, [customersStatus, dispatch])

  const products = useMemo((): ProductSummary[] => {
    if (!customerId || productList.lastCustomerId !== customerId) return []
    return productList.items as ProductSummary[]
  }, [customerId, productList.items, productList.lastCustomerId])

  const productsErr =
    customerId && productList.lastCustomerId === customerId && productList.status === 'failed' ? productList.error : null

  const productsLoading = Boolean(customerId && productList.status === 'loading')

  const jobHydratedRef = useRef<string | null>(null)
  const productSpecHydratedRef = useRef<string | null>(null)

  useEffect(() => {
    jobHydratedRef.current = null
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
    if (jobHydratedRef.current === jobSheetId) return
    jobHydratedRef.current = jobSheetId
    setSaveErr(null)
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
    setQtyUnit((js?.quantity_unit as QuantityUnit) || 'kg')
    setQtyValue(typeof js?.quantity_value === 'number' ? js.quantity_value : Number(js?.quantity_value || '') || '')
    setSpec(ensureSpec(res?.spec_payload))
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

  const qtyLabel = useMemo(() => {
    if (qtyUnit === 'kg') return 'Total KGs'
    if (qtyUnit === 'rolls') return 'No. of Rolls'
    if (qtyUnit === 'bags') return 'No. of Bags'
    return 'Total Meters'
  }, [qtyUnit])

  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => computeProductCodeFromSpec(spec), [spec])

  async function onSave() {
    setSaveMsg(null)
    setSaveErr(null)

    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (!productId) missing.push('Product')
    if (!dueDate) missing.push('Due Date')
    if (qtyValue === '' || !Number.isFinite(Number(qtyValue)) || Number(qtyValue) <= 0) missing.push('Quantity')
    if (missing.length > 0) {
      setSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return
    }
    if (savingJobSheet) return

    try {
      setSavingJobSheet(true)

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
        } catch {
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
            quantity_value: Number(qtyValue),
            quantity_unit: qtyUnit,
            spec,
          }),
        ).unwrap()
        const id = res?.job_sheet?.id
        setSaveMsg('Saved job sheet.')
        setDirty(false)
        if (id) nav(returnTo || `/job-sheets/${id}`)
      } else {
        if (!jobSheetId) throw new Error('Missing job sheet id')
        const body: Record<string, unknown> = {
          due_date: dueDate,
          quantity_value: Number(qtyValue),
          quantity_unit: qtyUnit,
        }
        if (specDirty) body.spec = spec
        const res = await dispatch(updateJobSheet({ jobSheetId, body })).unwrap()
        const id = res?.job_sheet?.id
        setSaveMsg('Saved job sheet.')
        setDirty(false)
        if (id) nav(returnTo || `/job-sheets/${id}`)
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save job sheet')
    } finally {
      setSavingJobSheet(false)
    }
  }

  const disableIdentity = mode === 'edit'
  /** New job sheet: Product Spec card is always shown; spec form only after a product (or draft) is chosen. */
  const showSpecForm = mode === 'edit' || (mode === 'new' && !!productId)

  function renderJobSheetActions() {
    const cancelTo = mode === 'edit' && jobSheetId ? `/job-sheets/${jobSheetId}` : '/job-sheets'
    return (
      <>
        <Button variant="text" color="primary" component={Link} to={returnTo || cancelTo}>
          Cancel
        </Button>
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

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Job Sheet</Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>{renderJobSheetActions()}</Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
            <TextField
              select
              label="Customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              disabled={disableIdentity || customersStatus === 'loading' || customersStatus === 'idle'}
            >
              <MenuItem value="" disabled>
                Select…
              </MenuItem>
              {customers.map((c: any) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} {c.code ? `(${String(c.code).toUpperCase()})` : ''}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Due Date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onClick={() => {
                const el = dueDateInputRef.current as any
                if (el && typeof el.showPicker === 'function') el.showPicker()
              }}
              onFocus={() => {
                const el = dueDateInputRef.current as any
                if (el && typeof el.showPicker === 'function') el.showPicker()
              }}
              inputRef={dueDateInputRef}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Box>

          <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <TextField select label="Quantity Type" value={qtyUnit} onChange={(e) => setQtyUnit(e.target.value as any)}>
              <MenuItem value="kg">Total KGs</MenuItem>
              <MenuItem value="rolls">No. of Rolls</MenuItem>
              <MenuItem value="bags">No. of Bags</MenuItem>
              <MenuItem value="meters">Total Meters</MenuItem>
            </TextField>

            <TextField
              label={qtyLabel}
              type="number"
              value={qtyValue}
              onChange={(e) => setQtyValue(e.target.value === '' ? '' : Number(e.target.value))}
              inputProps={{ min: 0, step: 'any' }}
              required
            />
          </Box>

          {mode === 'edit' ? (
            <Box sx={{ mt: 2 }}>
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
            </Box>
          ) : null}

        </Paper>

        {isNarrow ? <JobSheetPreviewPanel invoiceNo={invoiceNo} orderDate={orderDate} dueDate={dueDate} productCode={previewProductCode} description={previewDescription} /> : null}

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
                value={spec}
                onChange={(next) => {
                  setSpec(next)
                  setSpecDirty(true)
                }}
              />
            ) : null}
          </Paper>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>{renderJobSheetActions()}</Box>
        </Stack>

        {!isNarrow ? (
          <StickySideAside>
            <JobSheetPreviewPanel invoiceNo={invoiceNo} orderDate={orderDate} dueDate={dueDate} productCode={previewProductCode} description={previewDescription} />
          </StickySideAside>
        ) : null}
      </Box>

    </Box>
  )
}


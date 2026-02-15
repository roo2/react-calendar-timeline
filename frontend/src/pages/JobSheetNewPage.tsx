import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { apiFetch } from '../api/client'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchCustomers } from '../store/slices/customersSlice'
import { clearCreateErrors, createProduct } from '../store/slices/productsSlice'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'

type ProductSummary = {
  id: string
  code: string
  description?: string | null
  customer_id: string
  active_version_id?: string | null
}

type ProductVersionSummary = {
  id: string
  version_number?: number
  spec_payload?: any
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

type QuantityUnit = 'kg' | 'rolls' | 'bags' | 'meters'

export function JobSheetNewPage() {
  const dispatch = useAppDispatch()
  const nav = useNavigate()

  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)

  const createState = useAppSelector((s) => s.products.create)
  const [savingJobSheet, setSavingJobSheet] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [qtyUnit, setQtyUnit] = useState<QuantityUnit>('kg')
  const [qtyValue, setQtyValue] = useState<number | ''>('')
  const [jobNo, setJobNo] = useState('')
  const [lastSavedJobNo, setLastSavedJobNo] = useState<string | null>(null)
  const dueDateInputRef = useRef<HTMLInputElement | null>(null)

  const [products, setProducts] = useState<ProductSummary[]>([])
  const [productsStatus, setProductsStatus] = useState<'idle' | 'loading' | 'failed' | 'succeeded'>('idle')
  const [productsErr, setProductsErr] = useState<string | null>(null)

  const [productId, setProductId] = useState('')
  const [productInfo, setProductInfo] = useState<ProductSummary | null>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [specLoading, setSpecLoading] = useState(false)

  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductCode, setNewProductCode] = useState('')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductSpec, setNewProductSpec] = useState<SpecPayload>(() => makeDefaultSpec())

  const customerCode = useMemo(() => {
    const c = customers.find((x) => x.id === customerId) as any
    return (c?.code ? String(c.code) : '').trim().toUpperCase()
  }, [customerId, customers])

  const newProductCodePrefixOk = useMemo(() => {
    if (!customerCode) return true
    const v = (newProductCode || '').trim().toUpperCase()
    return v.startsWith(`${customerCode}-`) || v.startsWith(`${customerCode}_`)
  }, [customerCode, newProductCode])

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers(undefined))
  }, [customersStatus, dispatch])

  async function loadProducts(cid: string) {
    setProductsErr(null)
    setProductsStatus('loading')
    try {
      const res = await apiFetch<{ items: ProductSummary[] }>(`/api/products?customer_id=${encodeURIComponent(cid)}`)
      setProducts(res.items || [])
      setProductsStatus('succeeded')
    } catch (e) {
      setProductsStatus('failed')
      setProductsErr(e instanceof Error ? e.message : 'Failed to load products')
    }
  }

  useEffect(() => {
    setProducts([])
    setProductId('')
    setProductInfo(null)
    setSpec(makeDefaultSpec())
    setSaveMsg(null)
    setLastSavedJobNo(null)
    setJobNo('')
    if (!customerId) return
    void loadProducts(customerId)
  }, [customerId])

  useEffect(() => {
    if (!customerId) return
    void (async () => {
      try {
        const res = await apiFetch<{ job_no: string }>(`/api/job-sheets/next-job-no?customer_id=${encodeURIComponent(customerId)}`)
        setJobNo(res.job_no || '')
      } catch {
        setJobNo('')
      }
    })()
  }, [customerId, customers])

  useEffect(() => {
    if (!productId) return
    setSaveMsg(null)
    setSpecLoading(true)
    void (async () => {
      try {
        const res = await apiFetch<{ product: ProductSummary; versions: ProductVersionSummary[] }>(`/api/products/${productId}`)
        setProductInfo(res.product || null)
        const vs = Array.isArray(res.versions) ? res.versions : []

        const activeId = res.product?.active_version_id
        const active = activeId ? vs.find((v) => v.id === activeId) : null
        const latest = vs.slice().sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0]
        const srcSpec = (active?.spec_payload || latest?.spec_payload) ?? null
        setSpec(ensureSpec(srcSpec))
      } catch (e) {
        setProductsErr(e instanceof Error ? e.message : 'Failed to load product details')
      } finally {
        setSpecLoading(false)
      }
    })()
  }, [productId])

  const qtyLabel = useMemo(() => {
    if (qtyUnit === 'kg') return 'Total KGs'
    if (qtyUnit === 'rolls') return 'No. of Rolls'
    if (qtyUnit === 'bags') return 'No. of Bags'
    return 'Total Meters'
  }, [qtyUnit])

  async function onSaveJobSheet() {
    setSaveMsg(null)
    setSaveErr(null)

    const missing: string[] = []
    if (!customerId) missing.push('Customer')
    if (!dueDate) missing.push('Due Date')
    if (!jobNo) missing.push('Job No')
    if (!productId) missing.push('Product')
    if (qtyValue === '' || !Number.isFinite(Number(qtyValue)) || Number(qtyValue) <= 0) missing.push('Quantity')
    if (missing.length > 0) {
      setSaveErr(`Missing required fields: ${missing.join(', ')}`)
      return
    }
    if (savingJobSheet) return

    try {
      setSavingJobSheet(true)
      setSpecLoading(true)
      const res = await apiFetch<{ ok: boolean; job_sheet: { id: string } }>('/api/job-sheets', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          job_no: jobNo,
          due_date: dueDate,
          quantity_value: Number(qtyValue),
          quantity_unit: qtyUnit,
          spec,
        }),
      })
      const id = res?.job_sheet?.id
      setLastSavedJobNo(jobNo)
      setSaveMsg(`Saved job sheet ${jobNo}.`)
      // Refresh suggested job number (prevents reusing an existing job no).
      try {
        const next = await apiFetch<{ job_no: string }>(`/api/job-sheets/next-job-no?customer_id=${encodeURIComponent(customerId)}`)
        setJobNo(next.job_no || '')
      } catch {
        // ignore
      }

      if (id) nav(`/job-sheets/${id}`)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save job sheet')
    } finally {
      setSavingJobSheet(false)
      setSpecLoading(false)
    }
  }

  async function onCreateNewProduct(e: FormEvent) {
    e.preventDefault()
    if (!customerId) return
    setSaveMsg(null)
    dispatch(clearCreateErrors())
    try {
      const res = await dispatch(
        createProduct({
          data: {
            customer_id: customerId,
            code: newProductCode.trim(),
            description: newProductDescription.trim() ? newProductDescription.trim() : null,
            spec: newProductSpec,
          },
        }),
      ).unwrap()
      const pid = res?.product?.id as string | undefined
      setNewProductOpen(false)
      setNewProductCode('')
      setNewProductDescription('')
      setNewProductSpec(makeDefaultSpec())
      await loadProducts(customerId)
      if (pid) setProductId(pid)
    } catch {
      // Errors are in products.create
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Job Sheet
      </Typography>

      <Stack spacing={2}>
        {(productsErr || createState.error || saveErr) && <Alert severity="error">{productsErr || createState.error || saveErr}</Alert>}
        {saveMsg && <Alert severity="success">{saveMsg}</Alert>}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Job Sheet</Typography>
            <Button variant="contained" onClick={onSaveJobSheet}>
              {savingJobSheet ? 'Saving…' : 'Save job sheet'}
            </Button>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField
              select
              label="Customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              disabled={customersStatus === 'loading' || customersStatus === 'idle'}
            >
              <MenuItem value="" disabled>
                Select customer
              </MenuItem>
              {customers.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
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
            />

            <TextField
              label="Job No"
              value={jobNo}
              InputProps={{ readOnly: true }}
              error={!!customerId && !jobNo}
              helperText={
                customerId
                  ? jobNo
                    ? `Generated from customer code. Last saved: ${lastSavedJobNo || '-'}`
                    : 'Customer code is required to generate a job number.'
                  : ''
              }
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Quantity
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField select label="Quantity type" value={qtyUnit} onChange={(e) => setQtyUnit(e.target.value as QuantityUnit)}>
              <MenuItem value="kg">Total KGs</MenuItem>
              <MenuItem value="rolls">No. of Rolls</MenuItem>
              <MenuItem value="bags">No. of Bags</MenuItem>
              <MenuItem value="meters">Total Meters</MenuItem>
            </TextField>

            <TextField
              label={qtyLabel}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={qtyValue}
              onChange={(e) => setQtyValue(e.target.value ? parseFloat(e.target.value) : '')}
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Product
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, alignItems: 'start' }}>
            <TextField
              select
              label="Product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!customerId || productsStatus === 'loading'}
              helperText={!customerId ? 'Select a customer first' : ''}
            >
              <MenuItem value="" disabled>
                Select product
              </MenuItem>
              {products.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.code}
                  {p.description ? ` — ${p.description}` : ''}
                </MenuItem>
              ))}
            </TextField>

            <Button
              variant="outlined"
              onClick={() => {
                dispatch(clearCreateErrors())
                setNewProductOpen(true)
              }}
            >
              New product…
            </Button>
          </Box>

          {productId && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Editing latest spec for: <strong>{productInfo?.code || productId}</strong>
              </Typography>

              {specLoading ? (
                <Typography color="text.secondary">Loading spec…</Typography>
              ) : (
                <SpecPayloadForm
                  value={spec}
                  onChange={setSpec}
                  fieldErrors={{}}
                  customerId={customerId || undefined}
                />
              )}
            </Box>
          )}
        </Paper>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={onSaveJobSheet}>
            {savingJobSheet ? 'Saving…' : 'Save job sheet'}
          </Button>
        </Box>
      </Stack>

      <Dialog open={newProductOpen} onClose={() => setNewProductOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>New product</DialogTitle>
        <DialogContent dividers>
          {!customerId ? (
            <Alert severity="warning">Select a customer first.</Alert>
          ) : (
            <form id="job-sheet-new-product-form" onSubmit={onCreateNewProduct}>
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Product Code"
                    value={newProductCode}
                    onChange={(e) => setNewProductCode(e.target.value)}
                    required
                    error={!!createState.fieldErrors['code'] || (!!customerId && !newProductCodePrefixOk)}
                    helperText={
                      createState.fieldErrors['code'] ||
                      (customerCode ? `Must start with ${customerCode}-` : '')
                    }
                  />
                  <TextField
                    label="Description"
                    value={newProductDescription}
                    onChange={(e) => setNewProductDescription(e.target.value)}
                    error={!!createState.fieldErrors['description']}
                    helperText={createState.fieldErrors['description'] || ''}
                  />
                </Box>

                <SpecPayloadForm
                  value={newProductSpec}
                  onChange={setNewProductSpec}
                  fieldErrors={createState.fieldErrors}
                  customerId={customerId || undefined}
                />
              </Stack>
            </form>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={() => {
              setNewProductOpen(false)
              dispatch(clearCreateErrors())
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="job-sheet-new-product-form"
            variant="contained"
            disabled={!customerId || createState.status === 'loading' || !newProductCode.trim() || !newProductCodePrefixOk}
          >
            {createState.status === 'loading' ? 'Creating…' : 'Create product'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}


import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
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
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ProductVersionEditor } from './ProductVersionEditor'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from './SpecPayloadForm'
import { clearCreateErrors, createProduct } from '../store/slices/productsSlice'
import { computeProductCodeFromSpec } from '../utils/productDescription'

type Mode = 'new' | 'edit'

type Customer = { id: string; name: string; code?: string | null }
type Product = { id: string; code: string; description?: string | null; customer_id: string; active_version_id?: string | null }
type QuantityUnit = 'kg' | 'rolls' | 'bags' | 'meters'

type OrderLine = {
  id: string // react key
  product_id: string
  product_code: string
  product_name?: string | null
  due_date: string
  quantity_unit: QuantityUnit
  quantity_value: string
  rate: string
  total_price: string
  // edit-mode only
  order_item_id?: string
  job_sheet_id?: string
}

function lineFromApiItem(it: any): OrderLine {
  return {
    id: String(it.id),
    order_item_id: String(it.id),
    job_sheet_id: String(it.job_sheet_id),
    product_id: String(it.product_id),
    product_code: String(it.product_code || ''),
    product_name: (it.product_name as string | null | undefined) ?? null,
    due_date: String(it.due_date || ''),
    quantity_unit: (it.quantity_unit as QuantityUnit) || 'kg',
    quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
    rate: it.rate != null && Number.isFinite(Number(it.rate)) ? String(it.rate) : '',
    total_price: it.total_price != null && Number.isFinite(Number(it.total_price)) ? String(it.total_price) : '',
  }
}

/** Default due date: 4 weeks from today (YYYY-MM-DD). */
function defaultDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 28)
  return d.toISOString().slice(0, 10)
}

/** Computed line total = quantity × rate. */
function computedLineTotal(it: OrderLine): number | null {
  const q = Number(it.quantity_value)
  const r = parseOptionalMoney(it.rate)
  if (!Number.isFinite(q) || q < 0 || r == null || r < 0) return null
  return q * r
}

function parseOptionalMoney(s: string): number | null {
  const t = (s || '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function isValidMoneyField(s: string): boolean {
  const t = (s || '').trim()
  if (t === '') return true
  const n = Number(t)
  return Number.isFinite(n) && n >= 0
}

type OrderNewDraft = {
  customerId: string
  items: OrderLine[]
}

function parseOrderNewDraftState(state: unknown): OrderNewDraft | null {
  const draft = (state as any)?.orderNewDraft
  if (!draft || typeof draft !== 'object') return null
  return {
    customerId: typeof (draft as any)?.customerId === 'string' ? (draft as any).customerId : '',
    items: Array.isArray((draft as any)?.items) ? ((draft as any).items as OrderLine[]) : [],
  }
}

export function OrderEditor(props: { mode: Mode; orderId?: string }) {
  const { mode, orderId } = props
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEditProduct = can(roles, 'PROD_MANAGER')
  const canPublish = can(roles, 'SALES', 'PROD_MANAGER')
  const createState = useAppSelector((s) => s.products.create)
  const { setDirty } = useUnsavedChanges()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [orderStatus, setOrderStatus] = useState<string>('draft')
  const orderLocked = mode === 'edit' && orderStatus !== 'draft'

  const [pvOpen, setPvOpen] = useState(false)
  const [pvProductId, setPvProductId] = useState<string | null>(null)
  const [pvTitle, setPvTitle] = useState<string>('')

  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductSpec, setNewProductSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [newProductCodeExists, setNewProductCodeExists] = useState(false)

  const initialDraftRef = useRef<OrderNewDraft | null>(mode === 'new' ? parseOrderNewDraftState(loc.state) : null)
  const initialDraft = initialDraftRef.current

  const [customerId, setCustomerId] = useState(initialDraft?.customerId || '')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [productId, setProductId] = useState('')
  const [items, setItems] = useState<OrderLine[]>(() =>
    (initialDraft?.items || []).map((it) => ({
      ...it,
      rate: (it as OrderLine).rate ?? '',
      total_price: (it as OrderLine).total_price ?? '',
    }))
  )

  const originalRef = useRef<{ lines: Record<string, OrderLine> } | null>(null)

  const prevCustomerId = useRef<string>(initialDraft?.customerId || '')

  function openProductVersionModal(p: { product_id: string; product_code?: string | null }) {
    setPvProductId(p.product_id)
    setPvTitle(p.product_code ? `Edit ${p.product_code}` : 'Edit product')
    setPvOpen(true)
  }

  function closeProductVersionModal() {
    setPvOpen(false)
    setPvProductId(null)
    setPvTitle('')
  }

  function openNewProductModal() {
    if (!customerId) return
    dispatch(clearCreateErrors())
    setNewProductOpen(true)
  }

  function closeNewProductModal() {
    setNewProductOpen(false)
    setNewProductSpec(makeDefaultSpec())
    setNewProductCodeExists(false)
  }

  const generatedProductCode = useMemo(() => (computeProductCodeFromSpec(newProductSpec) || '').trim(), [newProductSpec])

  useEffect(() => {
    // Debounced uniqueness check for product code.
    const v = (generatedProductCode || '').trim()
    if (!newProductOpen || !v) {
      setNewProductCodeExists(false)
      return
    }
    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch<{ exists: boolean }>(`/api/products/code-exists?code=${encodeURIComponent(v)}`, {
            signal: controller.signal as any,
          })
          setNewProductCodeExists(!!res?.exists)
        } catch {
          setNewProductCodeExists(false)
        }
      })()
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [generatedProductCode, newProductOpen])

  async function addProductFromSummary(p: Product) {
    if (!p.active_version_id) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    if (mode === 'new') {
      setItems((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          product_id: p.id,
          product_code: p.code,
          product_name: p.description || null,
          due_date: defaultDueDate(),
          quantity_unit: 'kg',
          quantity_value: '1',
          rate: '',
          total_price: '',
        },
      ])
      return
    }
    if (!orderId) return
    try {
      setErr(null)
      setSaving(true)
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/items`, {
        method: 'POST',
        body: JSON.stringify({
          product_id: p.id,
          due_date: defaultDueDate(),
          quantity_unit: 'kg',
          quantity_value: 1,
        }),
      })
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextItems: OrderLine[] = (res?.items || []).map((it: any) => lineFromApiItem(it))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add order item')
    } finally {
      setSaving(false)
    }
  }

  async function onCreateNewProduct(e: FormEvent) {
    e.preventDefault()
    if (!customerId) return
    if (!generatedProductCode.trim() || newProductCodeExists) return
    dispatch(clearCreateErrors())
    try {
      const res = await dispatch(
        createProduct({
          data: {
            customer_id: customerId,
            code: generatedProductCode.trim(),
            spec: newProductSpec,
          },
        }),
      ).unwrap()

      const pid = res?.product?.id as string | undefined
      if (!pid) return

      // Fetch full product summary (incl active_version_id) and add it immediately.
      const pres = await apiFetch<any>(`/api/products/${encodeURIComponent(pid)}`)
      const p = pres?.product as Product | undefined
      if (!p) return

      setProducts((prev) => [p, ...prev.filter((x) => x.id !== p.id)])
      closeNewProductModal()
      await addProductFromSummary(p)
    } catch {
      // Errors are stored in products.create
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<{ customers: Customer[] }>('/api/orders/bootstrap')
        setCustomers(res.customers)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load form data')
      }
    })()
  }, [])

  useEffect(() => {
    if (mode !== 'new') return
    // Allow deep-linking into "New Order for customer X" from Customers page.
    const qs = new URLSearchParams(loc.search)
    const pre = qs.get('customerId') || qs.get('customer_id')
    if (!pre) return
    if (pre === customerId && items.length > 0) return
    setCustomerId(pre)
    setItems([])
    setProducts([])
    setProductId('')
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (mode !== 'edit') return
    if (!orderId) return
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
        setOrderStatus(String(res?.status || 'draft'))
        setCustomerId(String(res?.customer_id || ''))
        setInvoiceNumber(String(res?.code ?? ''))
        setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
        const nextItems: OrderLine[] = (res?.items || []).map((it: any) => lineFromApiItem(it))
        setItems(nextItems)
        originalRef.current = {
          lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])),
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load order')
      }
    })()
  }, [mode, orderId])

  async function loadProductsForCustomer(id: string) {
    if (!id) return
    if (loadingProducts) return
    try {
      setLoadingProducts(true)
      const qs = new URLSearchParams()
      qs.set('customer_id', id)
      const res = await apiFetch<{ items: Product[] }>(`/api/products?${qs.toString()}`)
      setProducts(res.items || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load products')
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    if (!customerId) return
    const controller = new AbortController()
    void (async () => {
      try {
        setLoadingProducts(true)
        const qs = new URLSearchParams()
        qs.set('customer_id', customerId)
        const res = await apiFetch<{ items: Product[] }>(`/api/products?${qs.toString()}`, { signal: controller.signal as any })
        setProducts(res.items || [])
      } catch (e) {
        if (e instanceof Error && /aborted/i.test(e.message)) return
        setErr(e instanceof Error ? e.message : 'Failed to load products')
      } finally {
        setLoadingProducts(false)
      }
    })()
    return () => controller.abort()
  }, [customerId])

  useEffect(() => {
    if (mode !== 'new') return
    // Reset dependent fields when customer changes (user-driven).
    if (prevCustomerId.current === customerId) return
    prevCustomerId.current = customerId
    setProductId('')
    setProducts([])
    setItems([])
  }, [customerId, mode])

  function addSelectedProductToItems(nextProductId: string) {
    const p = products.find((x) => x.id === nextProductId)
    if (!p) return
    const pv = p.active_version_id || ''
    if (!pv) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        product_id: p.id,
        product_code: p.code,
        product_name: p.description || null,
        due_date: defaultDueDate(),
        quantity_unit: 'kg',
        quantity_value: '1',
        rate: '',
        total_price: '',
      },
    ])
    setProductId('')
  }

  async function addSelectedProductToOrder(nextProductId: string) {
    if (!orderId) return
    const p = products.find((x) => x.id === nextProductId)
    if (!p) return
    const pv = p.active_version_id || ''
    if (!pv) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    try {
      setErr(null)
      setSaving(true)
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/items`, {
        method: 'POST',
        body: JSON.stringify({
          product_id: p.id,
          due_date: defaultDueDate(),
          quantity_unit: 'kg',
          quantity_value: 1,
        }),
      })
      // reload order to pick up job_sheet_id/order_item_id
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextItems: OrderLine[] = (res?.items || []).map((it: any) => lineFromApiItem(it))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add order item')
    } finally {
      setSaving(false)
      setProductId('')
    }
  }

  const canSaveDraft = useMemo(() => {
    if (!customerId) return false
    if (saving || publishing) return false
    if (items.length === 0) return false
    return items.every((it) => {
      if (!it.product_id) return false
      const q = Number(it.quantity_value || '0')
      return Number.isFinite(q) && q > 0 && !!it.quantity_unit
    })
  }, [customerId, items, saving, publishing])

  const canPublishNow = useMemo(() => {
    if (!canPublish) return false
    if (!canSaveDraft) return false
    return items.every((it) => !!it.due_date)
  }, [canPublish, canSaveDraft, items])

  const grandTotal = useMemo(() => {
    return items.reduce((sum, it) => sum + (computedLineTotal(it) ?? 0), 0)
  }, [items])

  async function createDraft() {
    if (items.some((it) => !isValidMoneyField(it.rate))) {
      setErr('Rate must be empty or a valid non-negative number.')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          status: 'draft',
          ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
          ...(orderDate ? { order_date: orderDate } : {}),
          items: items.map((it) => {
            const rate = parseOptionalMoney(it.rate)
            const totalPrice = computedLineTotal(it)
            return {
              product_id: it.product_id,
              due_date: it.due_date || null,
              quantity_unit: it.quantity_unit,
              quantity_value: Number(it.quantity_value || '0'),
              ...(rate != null ? { rate } : {}),
              ...(totalPrice != null ? { total_price: totalPrice } : {}),
            }
          }),
        }),
      })
      setDirty(false)
      nav(`/orders/${res.order_id}/edit`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdits() {
    if (!orderId) return
    if (items.some((it) => !isValidMoneyField(it.rate))) {
      setErr('Rate must be empty or a valid non-negative number.')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          invoice_number: invoiceNumber.trim() || null,
          order_date: orderDate || null,
        }),
      })

      const orig = originalRef.current

      const updates = items.filter((it) => {
        const o = orig?.lines?.[it.id]
        if (!o) return true
        const totalNow = computedLineTotal(it)
        const totalOrig = computedLineTotal(o)
        return (
          o.due_date !== it.due_date ||
          o.quantity_unit !== it.quantity_unit ||
          o.quantity_value !== it.quantity_value ||
          o.rate !== it.rate ||
          totalNow !== totalOrig
        )
      })

      for (const it of updates) {
        if (!it.job_sheet_id) continue
        await apiFetch<any>(`/api/job-sheets/${encodeURIComponent(it.job_sheet_id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            due_date: it.due_date || null,
            quantity_value: Number(it.quantity_value || '0'),
            quantity_unit: it.quantity_unit,
            unit_rate: parseOptionalMoney(it.rate),
            line_total: computedLineTotal(it),
          }),
        })
      }

      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      setOrderStatus(String(res?.status || orderStatus))
      setInvoiceNumber(String(res?.code ?? ''))
      setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
      const nextItems: OrderLine[] = (res?.items || []).map((x: any) => lineFromApiItem(x))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function publishOrder() {
    if (mode === 'new' && items.some((it) => !isValidMoneyField(it.rate))) {
      setErr('Rate must be empty or a valid non-negative number.')
      return
    }
    setErr(null)
    setPublishing(true)
    try {
      if (mode === 'new') {
        const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            customer_id: customerId,
            status: 'draft',
            ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
            ...(orderDate ? { order_date: orderDate } : {}),
            items: items.map((it) => {
              const rate = parseOptionalMoney(it.rate)
              const totalPrice = computedLineTotal(it)
              return {
                product_id: it.product_id,
                due_date: it.due_date || null,
                quantity_unit: it.quantity_unit,
                quantity_value: Number(it.quantity_value || '0'),
                ...(rate != null ? { rate } : {}),
                ...(totalPrice != null ? { total_price: totalPrice } : {}),
              }
            }),
          }),
        })
        await apiFetch<any>(`/api/orders/${encodeURIComponent(res.order_id)}/publish`, { method: 'POST' })
        setDirty(false)
        nav('/orders')
        return
      }

      if (!orderId) return
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/publish`, { method: 'POST' })
      setDirty(false)
      nav('/orders')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to publish order')
    } finally {
      setPublishing(false)
    }
  }

  async function removeLine(it: OrderLine) {
    if (mode === 'new') {
      setItems((prev) => prev.filter((x) => x.id !== it.id))
      return
    }
    if (orderLocked) return
    if (!orderId || !it.order_item_id) return
    try {
      setErr(null)
      setSaving(true)
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(it.order_item_id)}`, { method: 'DELETE' })
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextItems: OrderLine[] = (res?.items || []).map((x: any) => lineFromApiItem(x))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove order item')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'new' ? 'New Order' : 'Edit Order'

  return (
    <Box onChange={() => setDirty(true)}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {title}
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 1100, width: '100%' }}>
        <Stack spacing={2}>
          <TextField
            select
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={mode === 'edit'}
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

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField
              label="Invoice Number"
              value={invoiceNumber}
              onChange={(e) => { setInvoiceNumber(e.target.value); setDirty(true) }}
              disabled={orderLocked}
              placeholder={mode === 'new' ? 'Leave blank to auto-generate' : undefined}
              inputProps={{ maxLength: 32 }}
            />
            <TextField
              label="Order Date"
              type="date"
              value={orderDate}
              onChange={(e) => { setOrderDate(e.target.value); setDirty(true) }}
              disabled={orderLocked}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          <Paper variant="outlined" sx={{ p: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', px: 1, pt: 1 }}>
              <Typography variant="subtitle2">Products</Typography>
              <TextField
                select
                size="small"
                label="Add product"
                value={productId}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === '__new_product__') {
                    setProductId('')
                    openNewProductModal()
                    return
                  }
                  setProductId(next)
                  if (!next) return
                  if (mode === 'new') addSelectedProductToItems(next)
                  else void addSelectedProductToOrder(next)
                }}
                disabled={!customerId || loadingProducts || saving || publishing || orderLocked}
                SelectProps={{
                  onOpen: () => {
                    if (customerId && products.length === 0) void loadProductsForCustomer(customerId)
                  },
                }}
                sx={{ minWidth: 240 }}
              >
                <MenuItem value="" disabled>
                  {loadingProducts ? 'Loading…' : products.length ? 'Select product' : 'No products found'}
                </MenuItem>
                {products.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.code}
                  </MenuItem>
                ))}
                <MenuItem divider />
                <MenuItem value="__new_product__">New Product…</MenuItem>
              </TextField>
            </Box>
            <Table size="small" sx={{ '& .MuiTableCell-root': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell>Qty Type</TableCell>
                  <TableCell>Qty Total</TableCell>
                  <TableCell>Rate ($)</TableCell>
                  <TableCell>Total ($)</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id} hover>
                    <TableCell>
                      <strong>{it.product_code}</strong>
                      {it.product_name ? <span style={{ color: 'rgba(0,0,0,0.6)' }}> — {it.product_name}</span> : null}
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="date"
                        value={it.due_date}
                        onChange={(e) => {
                          const v = e.currentTarget.value
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, due_date: v } : x)))
                        }}
                        InputLabelProps={{ shrink: true }}
                        disabled={saving || publishing || orderLocked}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={it.quantity_unit}
                        onChange={(e) => {
                          const v = e.target.value as QuantityUnit
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity_unit: v } : x)))
                        }}
                        sx={{ minWidth: 140 }}
                        disabled={saving || publishing || orderLocked}
                      >
                        <MenuItem value="kg">Total KGs</MenuItem>
                        <MenuItem value="rolls">No. of Rolls</MenuItem>
                        <MenuItem value="bags">No. of Bags</MenuItem>
                        <MenuItem value="meters">Total Meters</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={it.quantity_value}
                        onChange={(e) => {
                          const v = e.currentTarget.value
                          if (!/^\d*\.?\d*$/.test(v)) return
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity_value: v } : x)))
                        }}
                        inputProps={{ inputMode: 'decimal' }}
                        disabled={saving || publishing || orderLocked}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        placeholder="—"
                        value={it.rate}
                        onChange={(e) => {
                          const v = e.currentTarget.value
                          if (v !== '' && !/^\d*\.?\d*$/.test(v)) return
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rate: v } : x)))
                          setDirty(true)
                        }}
                        inputProps={{ inputMode: 'decimal' }}
                        disabled={saving || publishing || orderLocked}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {computedLineTotal(it) != null ? `$${Number(computedLineTotal(it)).toFixed(2)}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {canEditProduct && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => openProductVersionModal(it)}
                            disabled={saving || publishing}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          onClick={() => void removeLine(it)}
                          disabled={saving || publishing || orderLocked}
                        >
                          Remove
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary">No products added yet.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} align="right" sx={{ fontWeight: 600 }}>
                    Total
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    ${grandTotal.toFixed(2)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </Paper>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="text"
              color="primary"
              component={Link}
              to={mode === 'edit' && orderId ? `/orders/${orderId}` : '/orders'}
            >
              Cancel
            </Button>
            {mode === 'new' ? (
              <Button variant="outlined" onClick={createDraft} disabled={!canSaveDraft}>
                {saving ? 'Saving…' : 'Save Draft'}
              </Button>
            ) : (
              <Button variant="outlined" onClick={saveEdits} disabled={!canSaveDraft}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            )}
            {canPublish && (mode === 'new' || orderStatus === 'draft') && (
              <Button variant="contained" color="success" onClick={publishOrder} disabled={!canPublishNow}>
                {publishing ? 'Publishing…' : 'Publish Order'}
              </Button>
            )}
          </Box>
        </Stack>
      </Paper>

      <Dialog
        open={pvOpen}
        onClose={() => {
          if (saving || publishing) return
          closeProductVersionModal()
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent dividers>
          {pvProductId ? (
            <ProductVersionEditor
              productId={pvProductId}
              onCancel={closeProductVersionModal}
              onDone={() => closeProductVersionModal()}
              title={pvTitle || undefined}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={newProductOpen} onClose={() => closeNewProductModal()} maxWidth="lg" fullWidth>
        <form onSubmit={onCreateNewProduct}>
          <DialogTitle>New Product</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {createState.error ? <Alert severity="error">{createState.error}</Alert> : null}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Spec
                </Typography>
                <SpecPayloadForm
                  customerId={customerId || undefined}
                  value={newProductSpec}
                  onChange={(next) => setNewProductSpec(next)}
                  fieldErrors={createState.fieldErrors}
                />
              </Paper>

              <Box sx={{ mt: 0.5 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
                  Generated product code
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                  {generatedProductCode.trim() ? generatedProductCode : '—'}
                </Typography>
                {newProductCodeExists ? (
                  <Typography variant="caption" color="error">
                    This code already exists; you may need to adjust the spec.
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="primary" onClick={() => closeNewProductModal()}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                !generatedProductCode.trim() ||
                newProductCodeExists ||
                createState.status === 'loading'
              }
            >
              {createState.status === 'loading' ? 'Creating…' : 'Create product'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  )
}


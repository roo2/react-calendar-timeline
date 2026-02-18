import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
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
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ProductVersionEditor } from './ProductVersionEditor'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from './SpecPayloadForm'
import { clearCreateErrors, clearCreateFieldError, createProduct } from '../store/slices/productsSlice'

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
  // edit-mode only
  order_item_id?: string
  job_sheet_id?: string
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
  const [newProductCode, setNewProductCode] = useState('')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductSpec, setNewProductSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [newProductCodeExists, setNewProductCodeExists] = useState(false)
  const lastAutoNewProductPrefixRef = useRef<string>('')

  const initialDraftRef = useRef<OrderNewDraft | null>(mode === 'new' ? parseOrderNewDraftState(loc.state) : null)
  const initialDraft = initialDraftRef.current

  const [customerId, setCustomerId] = useState(initialDraft?.customerId || '')
  const [productId, setProductId] = useState('')
  const [items, setItems] = useState<OrderLine[]>(initialDraft?.items || [])

  const originalRef = useRef<{ lines: Record<string, OrderLine> } | null>(null)

  const customerCode = useMemo(() => {
    const c = customers.find((x) => x.id === customerId) as any
    return (c?.code ? String(c.code) : '').trim().toUpperCase()
  }, [customerId, customers])

  const newProductCodePrefixOk = useMemo(() => {
    if (!customerCode) return true
    const v = (newProductCode || '').trim().toUpperCase()
    return v.startsWith(`${customerCode}-`) || v.startsWith(`${customerCode}_`)
  }, [customerCode, newProductCode])

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
    if (!newProductCode.trim()) {
      // leave as-is; if we later add customer code prefill, this is where it goes
      setNewProductCode('')
    }
  }

  function closeNewProductModal() {
    setNewProductOpen(false)
    setNewProductCode('')
    setNewProductDescription('')
    setNewProductSpec(makeDefaultSpec())
    setNewProductCodeExists(false)
    lastAutoNewProductPrefixRef.current = ''
  }

  useEffect(() => {
    // Auto-fill the product code prefix when opening the modal (or when customer code loads).
    if (!newProductOpen) return
    if (!customerCode) return
    const nextPrefix = `${customerCode}-`
    const cur = (newProductCode || '').trim()
    const curUp = cur.toUpperCase()
    const lastAuto = (lastAutoNewProductPrefixRef.current || '').toUpperCase()
    const isEmpty = !curUp
    const isOnlyAutoPrefix = !!lastAuto && curUp === lastAuto
    if (isEmpty || isOnlyAutoPrefix) {
      setNewProductCode(nextPrefix)
      lastAutoNewProductPrefixRef.current = nextPrefix
    }
  }, [customerCode, newProductCode, newProductOpen])

  useEffect(() => {
    // Debounced uniqueness check for product code.
    const v = (newProductCode || '').trim()
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
  }, [newProductCode, newProductOpen])

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
          due_date: '',
          quantity_unit: 'kg',
          quantity_value: '1',
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
          due_date: null,
          quantity_unit: 'kg',
          quantity_value: 1,
        }),
      })
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextItems: OrderLine[] = (res?.items || []).map((it: any) => ({
        id: String(it.id),
        order_item_id: String(it.id),
        job_sheet_id: String(it.job_sheet_id),
        product_id: String(it.product_id),
        product_code: String(it.product_code || ''),
        product_name: (it.product_name as string | null | undefined) ?? null,
        due_date: String(it.due_date || ''),
        quantity_unit: (it.quantity_unit as QuantityUnit) || 'kg',
        quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
      }))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add order item')
    } finally {
      setSaving(false)
    }
  }

  async function onCreateNewProduct(e: FormEvent) {
    e.preventDefault()
    if (!customerId) return
    if (!newProductCode.trim() || newProductCodeExists || !newProductCodePrefixOk) return
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
        const nextItems: OrderLine[] = (res?.items || []).map((it: any) => ({
          id: String(it.id),
          order_item_id: String(it.id),
          job_sheet_id: String(it.job_sheet_id),
          product_id: String(it.product_id),
          product_code: String(it.product_code || ''),
          product_name: (it.product_name as string | null | undefined) ?? null,
          due_date: String(it.due_date || ''),
          quantity_unit: (it.quantity_unit as QuantityUnit) || 'kg',
          quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
        }))
        setItems(nextItems)
        originalRef.current = {
          lines: Object.fromEntries(nextItems.map((l) => [l.id, l])),
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
        due_date: '',
        quantity_unit: 'kg',
        quantity_value: '1',
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
          due_date: null,
          quantity_unit: 'kg',
          quantity_value: 1,
        }),
      })
      // reload order to pick up job_sheet_id/order_item_id
      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextItems: OrderLine[] = (res?.items || []).map((it: any) => ({
        id: String(it.id),
        order_item_id: String(it.id),
        job_sheet_id: String(it.job_sheet_id),
        product_id: String(it.product_id),
        product_code: String(it.product_code || ''),
        product_name: (it.product_name as string | null | undefined) ?? null,
        due_date: String(it.due_date || ''),
        quantity_unit: (it.quantity_unit as QuantityUnit) || 'kg',
        quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
      }))
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

  async function createDraft() {
    setErr(null)
    setSaving(true)
    try {
      const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          status: 'draft',
          items: items.map((it) => ({
            product_id: it.product_id,
            due_date: it.due_date || null,
            quantity_unit: it.quantity_unit,
            quantity_value: Number(it.quantity_value || '0'),
          })),
        }),
      })
      // Stay in the editor flow after saving.
      nav(`/orders/${res.order_id}/edit`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdits() {
    if (!orderId) return
    setErr(null)
    setSaving(true)
    try {
      const orig = originalRef.current

      const updates = items.filter((it) => {
        const o = orig?.lines?.[it.id]
        if (!o) return true
        return o.due_date !== it.due_date || o.quantity_unit !== it.quantity_unit || o.quantity_value !== it.quantity_value
      })

      for (const it of updates) {
        if (!it.job_sheet_id) continue
        await apiFetch<any>(`/api/job-sheets/${encodeURIComponent(it.job_sheet_id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            due_date: it.due_date,
            quantity_value: Number(it.quantity_value || '0'),
            quantity_unit: it.quantity_unit,
          }),
        })
      }

      const res = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
      setOrderStatus(String(res?.status || orderStatus))
      const nextItems: OrderLine[] = (res?.items || []).map((x: any) => ({
        id: String(x.id),
        order_item_id: String(x.id),
        job_sheet_id: String(x.job_sheet_id),
        product_id: String(x.product_id),
        product_code: String(x.product_code || ''),
        product_name: (x.product_name as string | null | undefined) ?? null,
        due_date: String(x.due_date || ''),
        quantity_unit: (x.quantity_unit as QuantityUnit) || 'kg',
        quantity_value: x.quantity_value != null ? String(x.quantity_value) : '1',
      }))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function publishOrder() {
    setErr(null)
    setPublishing(true)
    try {
      if (mode === 'new') {
        const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            customer_id: customerId,
            status: 'draft',
            items: items.map((it) => ({
              product_id: it.product_id,
              due_date: it.due_date || null,
              quantity_unit: it.quantity_unit,
              quantity_value: Number(it.quantity_value || '0'),
            })),
          }),
        })
        await apiFetch<any>(`/api/orders/${encodeURIComponent(res.order_id)}/publish`, { method: 'POST' })
        nav('/orders')
        return
      }

      if (!orderId) return
      await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}/publish`, { method: 'POST' })
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
      const nextItems: OrderLine[] = (res?.items || []).map((x: any) => ({
        id: String(x.id),
        order_item_id: String(x.id),
        job_sheet_id: String(x.job_sheet_id),
        product_id: String(x.product_id),
        product_code: String(x.product_code || ''),
        product_name: (x.product_name as string | null | undefined) ?? null,
        due_date: String(x.due_date || ''),
        quantity_unit: (x.quantity_unit as QuantityUnit) || 'kg',
        quantity_value: x.quantity_value != null ? String(x.quantity_value) : '1',
      }))
      setItems(nextItems)
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove order item')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'new' ? 'New Order' : 'Edit Order'

  return (
    <Box>
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
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell sx={{ width: 170 }}>Qty Type</TableCell>
                  <TableCell sx={{ width: 160 }}>Qty Total</TableCell>
                  <TableCell sx={{ width: 160 }}>Due Date</TableCell>
                  <TableCell sx={{ width: 220 }}>Actions</TableCell>
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
                        select
                        size="small"
                        value={it.quantity_unit}
                        onChange={(e) => {
                          const v = e.target.value as QuantityUnit
                          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity_unit: v } : x)))
                        }}
                        sx={{ minWidth: 140 }}
                        disabled={saving || publishing}
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
                        disabled={saving || publishing}
                      />
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
                        disabled={saving || publishing}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary">No products added yet.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {mode === 'new' ? (
              <Button variant="contained" onClick={createDraft} disabled={!canSaveDraft}>
                {saving ? 'Saving…' : 'Save Draft'}
              </Button>
            ) : (
              <Button variant="contained" onClick={saveEdits} disabled={!canSaveDraft}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            )}

            {canPublish && (mode === 'new' || orderStatus === 'draft') && (
              <Button variant="contained" color="success" onClick={publishOrder} disabled={!canPublishNow}>
                {publishing ? 'Publishing…' : 'Publish Order'}
              </Button>
            )}

            <Button variant="outlined" component={Link} to={mode === 'edit' && orderId ? `/orders/${orderId}` : '/orders'}>
              Cancel
            </Button>
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
              <TextField
                label="Product Code"
                value={newProductCode}
                onChange={(e) => {
                  setNewProductCode(e.target.value)
                  dispatch(clearCreateFieldError('code'))
                }}
                required
                error={newProductCodeExists || !newProductCodePrefixOk || !!createState.fieldErrors?.code}
                helperText={
                  newProductCodeExists
                    ? 'Product code already exists.'
                    : !newProductCodePrefixOk && customerCode
                      ? `Must start with ${customerCode}- or ${customerCode}_`
                      : customerCode
                        ? `Suggested format: ${customerCode}-XXXX`
                        : undefined
                }
              />
              <TextField
                label="Description"
                value={newProductDescription}
                onChange={(e) => setNewProductDescription(e.target.value)}
              />
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
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeNewProductModal()}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                !newProductCode.trim() ||
                !newProductCodePrefixOk ||
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


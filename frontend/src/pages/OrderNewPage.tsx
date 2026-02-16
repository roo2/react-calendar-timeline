import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import {
  Alert,
  Box,
  Button,
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

type Customer = { id: string; name: string }
type Product = { id: string; code: string; description?: string | null; customer_id: string; active_version_id?: string | null }
type QuantityUnit = 'kg' | 'rolls' | 'bags' | 'meters'
type OrderLine = {
  id: string
  product_id: string
  product_code: string
  product_name?: string | null
  due_date: string
  quantity_unit: QuantityUnit
  quantity_value: string
}
type ProductDetailResponse = { product: Product }

type OrderNewDraft = {
  customerId: string
  items: OrderLine[]
  currency: string
}

function parseOrderNewDraftState(state: unknown): OrderNewDraft | null {
  const draft = (state as any)?.orderNewDraft
  if (!draft || typeof draft !== 'object') return null
  return {
    customerId: typeof (draft as any)?.customerId === 'string' ? (draft as any).customerId : '',
    items: Array.isArray((draft as any)?.items) ? ((draft as any).items as OrderLine[]) : [],
    currency: typeof (draft as any)?.currency === 'string' ? (draft as any).currency : 'AUD',
  }
}

export function OrderNewPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEditProduct = can(roles, 'PROD_MANAGER')
  const canPublish = can(roles, 'SALES', 'PROD_MANAGER')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`

  // We intentionally keep the draft only in-memory. When we navigate away to create/edit
  // a product, we pass the in-progress order through router state (not storage), so that
  // "starting a new order" always begins clean.
  const initialDraftRef = useRef<OrderNewDraft | null>(parseOrderNewDraftState(loc.state))
  const initialDraft = initialDraftRef.current

  const [customerId, setCustomerId] = useState(initialDraft?.customerId || '')
  const [productId, setProductId] = useState('')
  const [currency, setCurrency] = useState(initialDraft?.currency || 'AUD')
  const [items, setItems] = useState<OrderLine[]>(initialDraft?.items || [])

  // Track the last customerId that the form was "stable" with. This prevents the
  // customer-change reset effect from wiping items during initial draft hydration.
  const prevCustomerId = useRef<string>(initialDraft?.customerId || '')
  const orderNewDraftState = useMemo(
    () => ({
      orderNewDraft: {
        customerId,
        items,
        currency,
      },
    }),
    [customerId, items, currency]
  )

  useEffect(() => {
    // Allow deep-linking into "New Order for customer X" from Customers page.
    // If present, we treat it as an explicit intent to start a new order for that customer.
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
  }, [])

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

  useEffect(() => {
    // Reset dependent fields when customer changes (user-driven).
    if (prevCustomerId.current === customerId) return
    prevCustomerId.current = customerId
    setProductId('')
    setProducts([])
    setItems([])
  }, [customerId])

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
    // pre-load products so the dropdown feels instant
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
    return () => {
      controller.abort()
    }
  }, [customerId])

  useEffect(() => {
    // If we returned from creating a new product, auto-add it to the order.
    const qs = new URLSearchParams(loc.search)
    const addedId = qs.get('addedProductId')
    if (!addedId) return
    if (!customerId) return

    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch<ProductDetailResponse>(`/api/products/${encodeURIComponent(addedId)}`)
        if (cancelled) return
        const p = res?.product
        if (!p) return
        if (p.customer_id !== customerId) return

        // Ensure the product appears in the add dropdown list (nice UX) without
        // requiring the user to open it.
        setProducts((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]))

        // Auto-add to line items using the same logic as the dropdown.
        setItems((prev) => {
          const pv = p.active_version_id || ''
          if (!pv) return prev
          return [
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
          ]
        })

        // Clean up the URL so refresh won't re-add.
        qs.delete('addedProductId')
        const nextSearch = qs.toString()
        nav(`${loc.pathname}${nextSearch ? `?${nextSearch}` : ''}${loc.hash}`, { replace: true })
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [customerId, loc.hash, loc.pathname, loc.search, nav])

  function addSelectedProductToItems(nextProductId: string) {
    const p = products.find((x) => x.id === nextProductId)
    if (!p) return
    const pv = p.active_version_id || ''
    if (!pv) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    setItems((prev) => {
      return [
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
      ]
    })
    setProductId('')
  }

  async function submit() {
    setErr(null)
    setSaving(true)
    try {
      const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          currency,
          status: 'draft',
          items: items.map((it) => ({
            product_id: it.product_id,
            due_date: it.due_date || null,
            quantity_unit: it.quantity_unit,
            quantity_value: Number(it.quantity_value || '0'),
          })),
        }),
      })
      nav(`/orders/${res.order_id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  async function publishOrder() {
    setErr(null)
    setPublishing(true)
    try {
      const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          currency,
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
      nav(`/orders/${res.order_id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to publish order')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Order
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
                    const qs = new URLSearchParams()
                    qs.set('customerId', customerId)
                    qs.set('returnTo', returnTo)
                    nav(`/products/new?${qs.toString()}`, { state: orderNewDraftState })
                    return
                  }
                  setProductId(next)
                  if (next) addSelectedProductToItems(next)
                }}
                disabled={!customerId || loadingProducts}
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
                  <TableCell sx={{ width: 200 }}>Actions</TableCell>
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
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="text"
                          component={Link}
                          to={`/products/${it.product_id}`}
                          state={orderNewDraftState}
                        >
                          View
                        </Button>
                        {canEditProduct && (
                          <Button
                            size="small"
                            variant="text"
                            component={Link}
                            to={`/products/${it.product_id}/versions/new?returnTo=${encodeURIComponent(returnTo)}`}
                            state={orderNewDraftState}
                          >
                            Edit (new version)
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
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

          <TextField
            label="Currency"
            value={currency}
            inputProps={{ maxLength: 3 }}
            onChange={(e) => setCurrency(e.currentTarget.value)}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={!canSaveDraft}>
              {saving ? 'Saving…' : 'Save Draft'}
            </Button>
            {canPublish && (
              <Button variant="contained" color="success" onClick={publishOrder} disabled={!canPublishNow}>
                {publishing ? 'Publishing…' : 'Publish Order'}
              </Button>
            )}
            <Button variant="outlined" component={Link} to="/orders">
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}


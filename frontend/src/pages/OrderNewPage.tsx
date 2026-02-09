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
type OrderItem = { product_id: string; product_version_id: string; product_code: string; product_name?: string | null; quantity: string }
type ProductDetailResponse = { product: Product }

export function OrderNewPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEditProduct = can(roles, 'PROD_MANAGER')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const draftKey = 'order_new_draft_v1'

  function loadDraft():
    | {
        customerId: string
        items: OrderItem[]
        currency: string
        status: 'confirmed' | 'draft'
      }
    | null {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (!raw) return null
      const d = JSON.parse(raw) as any
      return {
        customerId: typeof d?.customerId === 'string' ? d.customerId : '',
        items: Array.isArray(d?.items) ? d.items : [],
        currency: typeof d?.currency === 'string' ? d.currency : 'AUD',
        status: d?.status === 'confirmed' || d?.status === 'draft' ? d.status : 'confirmed',
      }
    } catch {
      return null
    }
  }

  const initialDraft = loadDraft()
  const [customerId, setCustomerId] = useState(initialDraft?.customerId || '')
  const [productId, setProductId] = useState('')
  const [currency, setCurrency] = useState(initialDraft?.currency || 'AUD')
  const [status, setStatus] = useState<'confirmed' | 'draft'>(initialDraft?.status || 'confirmed')
  const [items, setItems] = useState<OrderItem[]>(initialDraft?.items || [])

  // Track the last customerId that the form was "stable" with. This prevents the
  // customer-change reset effect from wiping items during initial draft hydration.
  const prevCustomerId = useRef<string>(initialDraft?.customerId || '')

  function saveDraft(next?: {
    customerId: string
    items: OrderItem[]
    currency: string
    status: 'confirmed' | 'draft'
  }) {
    try {
      const payload =
        next ?? ({
          customerId,
          items,
          currency,
          status,
        } as const)
      if (!payload.customerId && payload.items.length === 0) {
        sessionStorage.removeItem(draftKey)
        return
      }
      sessionStorage.setItem(draftKey, JSON.stringify({ ...payload, savedAt: Date.now() }))
    } catch {
      // ignore draft storage failures
    }
  }

  useEffect(() => {
    // Allow deep-linking into "New Order for customer X" from Customers page.
    // If present, we treat it as an explicit intent to start a new order for that customer.
    const qs = new URLSearchParams(loc.search)
    const pre = qs.get('customerId') || qs.get('customer_id')
    if (!pre) return
    if (pre === customerId && items.length > 0) return
    try {
      sessionStorage.removeItem(draftKey)
    } catch {
      // ignore
    }
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

  useEffect(() => {
    saveDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, items, currency, status])

  const canSubmit = useMemo(() => !!(customerId && items.length > 0 && !saving), [customerId, items.length, saving])

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
          if (prev.some((it) => it.product_id === p.id)) return prev
          const pv = p.active_version_id || ''
          if (!pv) return prev
          return [
            ...prev,
            {
              product_id: p.id,
              product_version_id: pv,
              product_code: p.code,
              product_name: p.description || null,
              quantity: '1',
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
      if (prev.some((it) => it.product_id === p.id)) return prev
      return [
        ...prev,
        {
          product_id: p.id,
          product_version_id: pv,
          product_code: p.code,
          product_name: p.description || null,
          quantity: '1',
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
          status,
          items: items.map((it) => ({
            product_version_id: it.product_version_id,
            quantity: Number(it.quantity || '0'),
          })),
        }),
      })
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        // ignore
      }
      nav(`/orders/${res.order_id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
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
                    saveDraft()
                    const qs = new URLSearchParams()
                    qs.set('customerId', customerId)
                    qs.set('returnTo', returnTo)
                    nav(`/products/new?${qs.toString()}`)
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
                  <TableCell>Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell sx={{ width: 140 }}>Quantity</TableCell>
                  <TableCell sx={{ width: 200 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.product_id} hover>
                    <TableCell>{it.product_code}</TableCell>
                    <TableCell>{it.product_name || '-'}</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={it.quantity}
                        onChange={(e) => {
                          const v = e.currentTarget.value
                          if (!/^\d*\.?\d*$/.test(v)) return
                          setItems((prev) => prev.map((x) => (x.product_id === it.product_id ? { ...x, quantity: v } : x)))
                        }}
                        inputProps={{ inputMode: 'decimal' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="text"
                          component={Link}
                          to={`/products/${it.product_id}`}
                          onClick={() => saveDraft()}
                        >
                          View
                        </Button>
                        {canEditProduct && (
                          <Button
                            size="small"
                            variant="text"
                            component={Link}
                            to={`/products/${it.product_id}/versions/new?returnTo=${encodeURIComponent(returnTo)}`}
                            onClick={() => saveDraft()}
                          >
                            Edit (new version)
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          onClick={() => setItems((prev) => prev.filter((x) => x.product_id !== it.product_id))}
                        >
                          Remove
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
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

          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <MenuItem value="confirmed">confirmed</MenuItem>
            <MenuItem value="draft">draft</MenuItem>
          </TextField>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={!canSubmit}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="outlined" component={Link} to="/orders">
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}


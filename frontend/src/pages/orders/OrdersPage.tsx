import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api/client'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchOrders, fetchOrdersBootstrap, type OrderRow, type OrdersListQuery } from '../../store/slices/ordersSlice'
import { can } from '../../auth/permissions'
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Link as MuiLink,
  Chip,
} from '@mui/material'
import { LIST_PAGE_SIZE, ListFiltersCard, ListPaginationBar, ListTableSurface } from '../../components/list'
import { useUrlSyncedFilters } from '../../hooks/urlSearchParamsSync'
import { formatDateDMYShort } from '../../utils/dateFormat'

const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'dispatched',
  'partially_fulfilled',
  'closed',
  'cancelled',
] as const

const ORDER_FILTER_DEFAULTS: Record<string, string> = {
  search: '',
  invoiceNumber: '',
  customerPo: '',
  customer: '',
  brandCode: '',
  product: '',
  lineItemSearch: '',
  orderTotalMin: '',
  orderTotalMax: '',
  statusFilter: '',
  orderDateFrom: '',
  orderDateTo: '',
  advanced: '',
}

const ORDER_URL_KEYS: Record<string, string> = {
  search: 'q',
  invoiceNumber: 'inv',
  customerPo: 'cpo',
  customer: 'cust',
  brandCode: 'brand',
  product: 'prod',
  lineItemSearch: 'line',
  orderTotalMin: 'tmin',
  orderTotalMax: 'tmax',
  statusFilter: 'st',
  orderDateFrom: 'df',
  orderDateTo: 'dt',
  advanced: 'adv',
}

function ProductsSummary({
  firstManufacturedCode,
  manufacturedOther,
  outsourced,
  resold,
}: {
  firstManufacturedCode?: string | null
  manufacturedOther: number
  outsourced: number
  resold: number
}) {
  const parts: string[] = []
  const first = (firstManufacturedCode || '').trim()
  if (first) {
    parts.push(first)
    if (manufacturedOther > 0) parts.push(`${manufacturedOther} other`)
  }
  if (outsourced > 0) parts.push(`${outsourced} outsourced`)
  if (resold > 0) parts.push(`${resold} resold`)
  if (parts.length === 0) {
    return <Typography component="span" variant="body2" color="text.secondary">—</Typography>
  }
  if (first) {
    return <Typography component="span" variant="body2">{parts[0]}{parts.slice(1).map((p) => ` + ${p}`).join('')}</Typography>
  }
  return <Typography component="span" variant="body2">{parts.join(' + ')}</Typography>
}

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function OrdersPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const { items, status, error, total } = useAppSelector((s) => s.orders.list)
  const ordersBootstrap = useAppSelector((s) => s.orders.bootstrap)
  const canCreate = can(roles, 'SALES', 'PROD_MANAGER')
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const loading = status === 'loading'
  const [debouncing, setDebouncing] = useState(false)
  const [brands, setBrands] = useState<Array<{ id: string; code: string; name: string }>>([])

  const { filters, setFilter, pageIdx, setPageIdx, clearFilters } = useUrlSyncedFilters({
    defaults: ORDER_FILTER_DEFAULTS,
    urlKeys: ORDER_URL_KEYS,
  })

  const query = useMemo((): OrdersListQuery => {
    const q: OrdersListQuery = {}
    const s = filters.search.trim()
    if (s) q.search = s
    if (filters.invoiceNumber.trim()) q.invoice_number = filters.invoiceNumber.trim()
    if (filters.customerPo.trim()) q.customer_po = filters.customerPo.trim()
    if (filters.customer.trim()) q.customer = filters.customer.trim()
    if (filters.brandCode.trim()) q.brand_code = filters.brandCode.trim()
    if (filters.product.trim()) q.product = filters.product.trim()
    if (filters.lineItemSearch.trim()) q.line_item_search = filters.lineItemSearch.trim()
    const min = parseOptionalNumber(filters.orderTotalMin)
    const max = parseOptionalNumber(filters.orderTotalMax)
    if (min !== undefined) q.order_total_min = min
    if (max !== undefined) q.order_total_max = max
    if (filters.statusFilter) q.status = filters.statusFilter
    if (filters.orderDateFrom) q.order_date_from = filters.orderDateFrom
    if (filters.orderDateTo) q.order_date_to = filters.orderDateTo
    q.page = pageIdx + 1
    q.page_size = LIST_PAGE_SIZE
    return q
  }, [filters, pageIdx])

  useEffect(() => {
    void dispatch(fetchOrdersBootstrap(undefined))
  }, [dispatch])

  useEffect(() => {
    let cancelled = false
    void apiFetch<{ items: Array<{ id: string; code: string; name: string }> }>('/api/customers/brands')
      .then((r) => {
        if (!cancelled && Array.isArray(r?.items)) setBrands(r.items)
      })
      .catch(() => {
        if (!cancelled) setBrands([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setDebouncing(true)
    const t = window.setTimeout(() => {
      setDebouncing(false)
      void dispatch(fetchOrders(query))
    }, 300)
    return () => {
      window.clearTimeout(t)
      setDebouncing(false)
    }
  }, [dispatch, query])

  const searching = debouncing || loading

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5">Orders</Typography>
          <Typography variant="body2" color="text.secondary">
            Search orders with advanced filters and line-item matching.
          </Typography>
        </Box>
        {canCreate ? (
          <Button variant="contained" component={Link} to="/orders/new">
            New Order
          </Button>
        ) : null}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <ListFiltersCard
        title="Find orders"
        search={{
          label: 'Search orders',
          placeholder: 'Invoice, customer PO, customer, product, line items...',
          value: filters.search,
          onChange: (v) => setFilter('search', v),
        }}
        advanced={
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(4, 1fr)',
              },
            }}
          >
            <TextField size="small" label="Invoice Number" value={filters.invoiceNumber} onChange={(e) => setFilter('invoiceNumber', e.target.value)} />
            <TextField size="small" label="Customer PO" value={filters.customerPo} onChange={(e) => setFilter('customerPo', e.target.value)} />
            <TextField size="small" label="Customer" value={filters.customer} onChange={(e) => setFilter('customer', e.target.value)} />
            <FormControl size="small" fullWidth>
              <InputLabel id="orders-filter-brand">Brand</InputLabel>
              <Select
                labelId="orders-filter-brand"
                label="Brand"
                value={filters.brandCode}
                onChange={(e) => setFilter('brandCode', e.target.value)}
              >
                <MenuItem value="">
                  <em>Any</em>
                </MenuItem>
                {brands.map((b) => (
                  <MenuItem key={b.id} value={b.code}>
                    {b.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" label="Product" value={filters.product} onChange={(e) => setFilter('product', e.target.value)} />
            <TextField size="small" label="Line item contains" value={filters.lineItemSearch} onChange={(e) => setFilter('lineItemSearch', e.target.value)} />
            <TextField size="small" label="Order total min" type="number" value={filters.orderTotalMin} onChange={(e) => setFilter('orderTotalMin', e.target.value)} />
            <TextField size="small" label="Order total max" type="number" value={filters.orderTotalMax} onChange={(e) => setFilter('orderTotalMax', e.target.value)} />
            <FormControl size="small" fullWidth>
              <InputLabel id="orders-filter-status">Status</InputLabel>
              <Select
                labelId="orders-filter-status"
                label="Status"
                value={filters.statusFilter}
                onChange={(e) => setFilter('statusFilter', e.target.value)}
              >
                <MenuItem value=""><em>Any</em></MenuItem>
                {ORDER_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" type="date" label="Order Date from" InputLabelProps={{ shrink: true }} value={filters.orderDateFrom} onChange={(e) => setFilter('orderDateFrom', e.target.value)} />
            <TextField size="small" type="date" label="Order Date to" InputLabelProps={{ shrink: true }} value={filters.orderDateTo} onChange={(e) => setFilter('orderDateTo', e.target.value)} />
            <TextField
              size="small"
              label="Customers loaded"
              value={String((ordersBootstrap.customers || []).length)}
              disabled
            />
          </Box>
        }
        advancedOpen={filters.advanced === '1'}
        onToggleAdvanced={() => setFilter('advanced', filters.advanced === '1' ? '' : '1')}
        resultCount={total}
        onClearFilters={clearFilters}
      />

      <ListTableSurface loadingOverlay={searching} initialLoading={loading && items.length === 0}>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice Number</TableCell>
                <TableCell>Customer PO</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell sx={{ minWidth: 220 }}>Products</TableCell>
                <TableCell align="right">Order total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell sx={{ minWidth: 140 }}>Import review</TableCell>
                <TableCell>Order Date</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(items as OrderRow[]).map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/orders/${o.id}`} underline="hover">
                      {o.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{o.customer_purchase_order_number || '—'}</TableCell>
                  <TableCell>{o.customer_name || '-'}</TableCell>
                  <TableCell>
                    <ProductsSummary
                      firstManufacturedCode={o.manufactured_first_product_code || o.product_code || null}
                      manufacturedOther={o.manufactured_other_line_count ?? 0}
                      outsourced={o.resell_outsourced_line_count ?? 0}
                      resold={o.resell_supply_line_count ?? 0}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {o.order_total != null && Number.isFinite(Number(o.order_total))
                      ? `$${Number(o.order_total).toFixed(2)}`
                      : '—'}
                  </TableCell>
                  <TableCell>{o.status}</TableCell>
                  <TableCell>
                    {o.import_source ? (
                      o.import_review_status === 'complete' ? (
                        <Chip size="small" color="success" label="Done" />
                      ) : (
                        <Chip size="small" color="warning" label="Pending" variant="outlined" />
                      )
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{formatDateDMYShort(o.order_date || o.created_at, '')}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <Button size="small" variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(o.id)}`}>
                        View
                      </Button>
                      {canEdit ? (
                        <Button size="small" variant="outlined" component={Link} to={`/orders/${encodeURIComponent(o.id)}/edit`}>
                          Edit
                        </Button>
                      ) : null}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </ListTableSurface>

      <ListPaginationBar total={total} page={pageIdx} onPageChange={setPageIdx} />
    </Stack>
  )
}

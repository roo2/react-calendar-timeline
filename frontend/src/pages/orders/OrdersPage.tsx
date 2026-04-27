import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
} from '@mui/material'
import { LIST_PAGE_SIZE, ListFiltersCard, ListPaginationBar, ListTableSurface } from '../../components/list'
import { formatDateDMYShort } from '../../utils/dateFormat'

const ORDER_STATUSES = ['draft', 'confirmed', 'dispatched', 'closed', 'cancelled'] as const

function ResellLineSummary({ outsourced, supply }: { outsourced: number; supply: number }) {
  if (!outsourced && !supply) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        —
      </Typography>
    )
  }
  const parts: string[] = []
  if (outsourced > 0) {
    parts.push(`${outsourced} outsourced mfg${outsourced === 1 ? '' : ''}`)
  }
  if (supply > 0) {
    parts.push(`${supply} resell${supply === 1 ? '' : ''}`)
  }
  return (
    <Typography component="span" variant="body2" sx={{ whiteSpace: 'normal' }}>
      {parts.join(' · ')}
    </Typography>
  )
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

  const [search, setSearch] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [customerPo, setCustomerPo] = useState('')
  const [customer, setCustomer] = useState('')
  const [product, setProduct] = useState('')
  const [lineItemSearch, setLineItemSearch] = useState('')
  const [orderTotalMin, setOrderTotalMin] = useState('')
  const [orderTotalMax, setOrderTotalMax] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [orderDateFrom, setOrderDateFrom] = useState('')
  const [orderDateTo, setOrderDateTo] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)

  const query = useMemo((): OrdersListQuery => {
    const q: OrdersListQuery = {}
    const s = search.trim()
    if (s) q.search = s
    if (invoiceNumber.trim()) q.invoice_number = invoiceNumber.trim()
    if (customerPo.trim()) q.customer_po = customerPo.trim()
    if (customer.trim()) q.customer = customer.trim()
    if (product.trim()) q.product = product.trim()
    if (lineItemSearch.trim()) q.line_item_search = lineItemSearch.trim()
    const min = parseOptionalNumber(orderTotalMin)
    const max = parseOptionalNumber(orderTotalMax)
    if (min !== undefined) q.order_total_min = min
    if (max !== undefined) q.order_total_max = max
    if (statusFilter) q.status = statusFilter
    if (orderDateFrom) q.order_date_from = orderDateFrom
    if (orderDateTo) q.order_date_to = orderDateTo
    q.page = pageIdx + 1
    q.page_size = LIST_PAGE_SIZE
    return q
  }, [search, invoiceNumber, customerPo, customer, product, lineItemSearch, orderTotalMin, orderTotalMax, statusFilter, orderDateFrom, orderDateTo, pageIdx])

  useEffect(() => {
    void dispatch(fetchOrdersBootstrap())
  }, [dispatch])

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

  const clearFilters = () => {
    setSearch('')
    setInvoiceNumber('')
    setCustomerPo('')
    setCustomer('')
    setProduct('')
    setLineItemSearch('')
    setOrderTotalMin('')
    setOrderTotalMax('')
    setStatusFilter('')
    setOrderDateFrom('')
    setOrderDateTo('')
    setPageIdx(0)
  }

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
          value: search,
          onChange: (v) => {
            setPageIdx(0)
            setSearch(v)
          },
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
            <TextField size="small" label="Invoice Number" value={invoiceNumber} onChange={(e) => { setPageIdx(0); setInvoiceNumber(e.target.value) }} />
            <TextField size="small" label="Customer PO" value={customerPo} onChange={(e) => { setPageIdx(0); setCustomerPo(e.target.value) }} />
            <TextField size="small" label="Customer" value={customer} onChange={(e) => { setPageIdx(0); setCustomer(e.target.value) }} />
            <TextField size="small" label="Product" value={product} onChange={(e) => { setPageIdx(0); setProduct(e.target.value) }} />
            <TextField size="small" label="Line item contains" value={lineItemSearch} onChange={(e) => { setPageIdx(0); setLineItemSearch(e.target.value) }} />
            <TextField size="small" label="Order total min" type="number" value={orderTotalMin} onChange={(e) => { setPageIdx(0); setOrderTotalMin(e.target.value) }} />
            <TextField size="small" label="Order total max" type="number" value={orderTotalMax} onChange={(e) => { setPageIdx(0); setOrderTotalMax(e.target.value) }} />
            <FormControl size="small" fullWidth>
              <InputLabel id="orders-filter-status">Status</InputLabel>
              <Select
                labelId="orders-filter-status"
                label="Status"
                value={statusFilter}
                onChange={(e) => { setPageIdx(0); setStatusFilter(e.target.value) }}
              >
                <MenuItem value=""><em>Any</em></MenuItem>
                {ORDER_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" type="date" label="Order Date from" InputLabelProps={{ shrink: true }} value={orderDateFrom} onChange={(e) => { setPageIdx(0); setOrderDateFrom(e.target.value) }} />
            <TextField size="small" type="date" label="Order Date to" InputLabelProps={{ shrink: true }} value={orderDateTo} onChange={(e) => { setPageIdx(0); setOrderDateTo(e.target.value) }} />
            <TextField
              size="small"
              label="Customers loaded"
              value={String((ordersBootstrap.customers || []).length)}
              disabled
            />
          </Box>
        }
        advancedOpen={showAdvancedFilters}
        onToggleAdvanced={() => setShowAdvancedFilters((v) => !v)}
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
                  <TableCell>{formatDateDMYShort(o.order_date || o.created_at, '')}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <Button size="small" variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(o.id)}`}>
                        View
                      </Button>
                      {canEdit && (o.status === 'draft' || o.status === 'confirmed') ? (
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

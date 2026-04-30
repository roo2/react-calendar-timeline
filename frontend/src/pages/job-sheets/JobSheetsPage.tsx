import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  fetchJobSheets,
  type JobSheetListQuery,
  type JobSheetSummary,
} from '../../store/slices/jobSheetsSlice'
import {
  CUSTOMER_PICKER_PAGE_SIZE,
  fetchCustomer,
  fetchCustomers,
  type CustomerSummary,
} from '../../store/slices/customersSlice'
import { fmtDollarsLineItem, fmtDollarsPreview } from '../../utils/quoteFormat'
import {
  Alert,
  Autocomplete,
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
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ListFiltersCard, ListPaginationBar, ListTableSurface, LIST_PAGE_SIZE } from '../../components/list'
import { useUrlSyncedFilters } from '../../hooks/urlSearchParamsSync'
import { formatDateDMYShort } from '../../utils/dateFormat'

const PRODUCT_TYPES = ['Bag', 'Tube', 'Sleeve', 'Sheet', 'Centerfold', 'U-Film'] as const
const PRINT_METHODS = ['None', 'Inline', 'Uteco'] as const
const FINISH_MODES = ['Rolls', 'Cartons'] as const
const ORDER_STATUSES = [
  'Draft',
  'Confirmed',
  'Dispatched',
  'Partially fulfilled',
  'Closed',
  'Cancelled',
] as const
const PRODUCTION_STATUS_FILTER_OPTIONS = [
  { value: 'planned', label: 'Backlog' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Running' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

function formatProductionStatusForDisplay(raw: string | null | undefined): string {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!t) return ''
  if (t === 'planned') return 'Backlog'
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const JOB_SHEET_FILTER_DEFAULTS: Record<string, string> = {
  search: '',
  customerId: '',
  productType: '',
  printed: '',
  finishMode: '',
  widthMin: '',
  widthMax: '',
  lengthMin: '',
  lengthMax: '',
  gaugeMin: '',
  gaugeMax: '',
  fromDate: '',
  toDate: '',
  orderStatus: '',
  productionStatus: '',
  advanced: '',
}

const JOB_SHEET_URL_KEYS: Record<string, string> = {
  search: 'q',
  customerId: 'cid',
  productType: 'ptype',
  printed: 'prt',
  finishMode: 'finish',
  widthMin: 'wmin',
  widthMax: 'wmax',
  lengthMin: 'lmin',
  lengthMax: 'lmax',
  gaugeMin: 'gmin',
  gaugeMax: 'gmax',
  fromDate: 'df',
  toDate: 'dt',
  orderStatus: 'ost',
  productionStatus: 'pst',
  advanced: 'adv',
}
function fmtQty(v: number, u: string) {
  const unit =
    u === 'kg' ? 'kg' : u === 'rolls' ? 'rolls' : u === 'bags' ? 'bags' : u === 'meters' ? 'm' : u
  return `${v} ${unit}`
}

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

function fmtPricePerKg(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return fmtDollarsPreview(n, 2)
}

function fmtDateDdMmYy(v: string | null | undefined): string {
  return formatDateDMYShort(v, '-')
}

export function JobSheetsPage() {
  const dispatch = useAppDispatch()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const { items, status, error, total } = useAppSelector((s) => s.jobSheets.list)
  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)
  const loading = status === 'loading'
  const [debouncing, setDebouncing] = useState(false)
  const [customerSearchQ, setCustomerSearchQ] = useState('')
  const [unlistedFilterCustomer, setUnlistedFilterCustomer] = useState<CustomerSummary | null>(null)

  const { filters, setFilter, pageIdx, setPageIdx, clearFilters } = useUrlSyncedFilters({
    defaults: JOB_SHEET_FILTER_DEFAULTS,
    urlKeys: JOB_SHEET_URL_KEYS,
  })

  const query = useMemo((): JobSheetListQuery => {
    const q: JobSheetListQuery = {}
    if (filters.customerId) q.customer_id = filters.customerId
    const s = filters.search.trim()
    if (s) q.search = s
    if (filters.productType) q.product_type = filters.productType
    if (filters.printed) q.printed = filters.printed
    if (filters.finishMode) q.finish_mode = filters.finishMode
    const wmin = parseOptionalNumber(filters.widthMin)
    const wmax = parseOptionalNumber(filters.widthMax)
    const lmin = parseOptionalNumber(filters.lengthMin)
    const lmax = parseOptionalNumber(filters.lengthMax)
    const gmin = parseOptionalNumber(filters.gaugeMin)
    const gmax = parseOptionalNumber(filters.gaugeMax)
    if (wmin !== undefined) q.width_min_mm = wmin
    if (wmax !== undefined) q.width_max_mm = wmax
    if (lmin !== undefined) q.length_min_mm = lmin
    if (lmax !== undefined) q.length_max_mm = lmax
    if (gmin !== undefined) q.gauge_min_um = gmin
    if (gmax !== undefined) q.gauge_max_um = gmax
    if (filters.fromDate) q.from_date = filters.fromDate
    if (filters.toDate) q.to_date = filters.toDate
    if (filters.orderStatus) q.order_status = filters.orderStatus
    if (filters.productionStatus) q.production_status = filters.productionStatus
    q.page = pageIdx + 1
    q.page_size = LIST_PAGE_SIZE
    return q
  }, [filters, pageIdx])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void dispatch(
        fetchCustomers({
          q: customerSearchQ,
          page: 1,
          page_size: Math.min(200, CUSTOMER_PICKER_PAGE_SIZE),
        }),
      )
    }, 300)
    return () => window.clearTimeout(t)
  }, [customerSearchQ, dispatch])

  useEffect(() => {
    const id = (filters.customerId || '').trim()
    if (!id) {
      setUnlistedFilterCustomer(null)
      return
    }
    if (customers.some((c) => c.id === id)) {
      setUnlistedFilterCustomer(null)
      return
    }
    let cancelled = false
    void (async () => {
      const a = await dispatch(fetchCustomer(id))
      if (cancelled) return
      if (fetchCustomer.fulfilled.match(a) && a.payload?.customer) {
        const c = a.payload.customer
        setUnlistedFilterCustomer({ id: c.id, name: c.name, status: c.status || 'Active' })
      } else {
        setUnlistedFilterCustomer(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters.customerId, customers, dispatch])

  const customerFilterOptions = useMemo(() => {
    const m = new Map<string, CustomerSummary>()
    for (const c of customers) m.set(c.id, c)
    if (unlistedFilterCustomer) m.set(unlistedFilterCustomer.id, unlistedFilterCustomer)
    return Array.from(m.values())
  }, [customers, unlistedFilterCustomer])

  const selectedFilterCustomer: CustomerSummary | null = useMemo(() => {
    const id = (filters.customerId || '').trim()
    if (!id) return null
    return customerFilterOptions.find((c) => c.id === id) || null
  }, [filters.customerId, customerFilterOptions])

  useEffect(() => {
    setDebouncing(true)
    const t = window.setTimeout(() => {
      setDebouncing(false)
      void dispatch(fetchJobSheets(query))
    }, 300)
    return () => {
      window.clearTimeout(t)
      setDebouncing(false)
    }
  }, [dispatch, query])

  const colCount = 9
  const searching = debouncing || loading

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h5">Job Sheets</Typography>
          <Typography variant="body2" color="text.secondary">
            Past job sheets with pricing — use filters to find similar products for quoting.
          </Typography>
        </Box>
        <Button variant="contained" component={Link} to="/job-sheets/new">
          New Job Sheet
        </Button>
      </Box>

      <ListFiltersCard
        title="Match past orders"
        search={{
          value: filters.search,
          onChange: (v) => setFilter('search', v),
        }}
        advanced={
          <Box>
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
                <TextField
                  size="small"
                  label="From date"
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => setFilter('fromDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  label="To date"
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => setFilter('toDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-order-status">Order status</InputLabel>
                  <Select
                    labelId="job-sheet-filter-order-status"
                    label="Order status"
                    value={filters.orderStatus}
                    onChange={(e) => setFilter('orderStatus', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {ORDER_STATUSES.map((s) => (
                      <MenuItem
                        key={s}
                        value={s === 'Partially fulfilled' ? 'partially_fulfilled' : s.toLowerCase()}
                      >
                        {s}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-production-status">Production status</InputLabel>
                  <Select
                    labelId="job-sheet-filter-production-status"
                    label="Production status"
                    value={filters.productionStatus}
                    onChange={(e) => setFilter('productionStatus', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {PRODUCTION_STATUS_FILTER_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              <Box
                sx={{
                  mt: 2,
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(4, 1fr)',
                  },
                }}
              >
                <Autocomplete<CustomerSummary, false, false, false>
                  size="small"
                  fullWidth
                  options={customerFilterOptions}
                  getOptionLabel={(c) => (c.name || c.id).trim() || c.id}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  value={selectedFilterCustomer}
                  onChange={(_e, v) => {
                    setFilter('customerId', v?.id || '')
                  }}
                  onInputChange={(_e, v, reason) => {
                    if (reason === 'input' || reason === 'clear' || reason === 'reset') {
                      setCustomerSearchQ(v)
                    }
                  }}
                  onOpen={() => {
                    void dispatch(
                      fetchCustomers({
                        q: customerSearchQ,
                        page: 1,
                        page_size: Math.min(200, CUSTOMER_PICKER_PAGE_SIZE),
                      }),
                    )
                  }}
                  filterOptions={(opts) => opts}
                  loading={customersStatus === 'loading'}
                  noOptionsText={customerSearchQ.trim() ? 'No customers' : 'Type to search'}
                  renderInput={(params) => <TextField {...params} label="Customer" placeholder="Search…" />}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-product-type">Product type</InputLabel>
                  <Select
                    labelId="job-sheet-filter-product-type"
                    label="Product type"
                    value={filters.productType}
                    onChange={(e) => setFilter('productType', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {PRODUCT_TYPES.map((pt) => (
                      <MenuItem key={pt} value={pt}>
                        {pt}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-printed">Printed</InputLabel>
                  <Select
                    labelId="job-sheet-filter-printed"
                    label="Printed"
                    value={filters.printed}
                    onChange={(e) => setFilter('printed', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {PRINT_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>
                        {m}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-finish-mode">Cartons / Rolls</InputLabel>
                  <Select
                    labelId="job-sheet-filter-finish-mode"
                    label="Cartons / Rolls"
                    value={filters.finishMode}
                    onChange={(e) => setFilter('finishMode', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {FINISH_MODES.map((m) => (
                      <MenuItem key={m} value={m}>
                        {m}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              <Box
                sx={{
                  mt: 2,
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(6, 1fr)',
                  },
                }}
              >
                <TextField
                  size="small"
                  label="Width min (mm)"
                  value={filters.widthMin}
                  onChange={(e) => setFilter('widthMin', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Width max (mm)"
                  value={filters.widthMax}
                  onChange={(e) => setFilter('widthMax', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Length min (mm)"
                  value={filters.lengthMin}
                  onChange={(e) => setFilter('lengthMin', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Length max (mm)"
                  value={filters.lengthMax}
                  onChange={(e) => setFilter('lengthMax', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Gauge min (µm)"
                  value={filters.gaugeMin}
                  onChange={(e) => setFilter('gaugeMin', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Gauge max (µm)"
                  value={filters.gaugeMax}
                  onChange={(e) => setFilter('gaugeMax', e.target.value)}
                  inputProps={{ inputMode: 'decimal' }}
                />
              </Box>
            </Box>
        }
        advancedOpen={filters.advanced === '1'}
        onToggleAdvanced={() => setFilter('advanced', filters.advanced === '1' ? '' : '1')}
        resultCount={total}
        onClearFilters={clearFilters}
        clearDisabled={loading}
      />

      {error && <Alert severity="error">{error}</Alert>}

      <ListTableSurface
        loadingOverlay={searching}
        loadingOverlayMessage="Searching…"
        initialLoading={loading && items.length === 0}
      >
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 120, whiteSpace: 'nowrap' }}>Invoice No</TableCell>
                  <TableCell sx={{ width: 88, maxWidth: 100, whiteSpace: 'nowrap' }}>Customer</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>Product</TableCell>
                  <TableCell sx={{ minWidth: 160, maxWidth: 280 }}>Status</TableCell>
                  <TableCell sx={{ width: 110, whiteSpace: 'nowrap' }}>Order Date</TableCell>
                  <TableCell>Qty</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Price/kg
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    Line total
                  </TableCell>
                  <TableCell sx={{ width: 200, whiteSpace: 'nowrap' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(items as JobSheetSummary[]).map((r) => {
                  const statusText =
                    (r.status_label && String(r.status_label).trim()) ||
                    [r.order_status, r.production_status ? formatProductionStatusForDisplay(r.production_status) : '']
                      .filter(Boolean)
                      .join(' · ') ||
                    '—'
                  const statusTitle =
                    [r.order_status, r.production_status ? formatProductionStatusForDisplay(r.production_status) : '']
                      .filter(Boolean)
                      .join(' · ') || undefined
                  const productCode = String(r.product_code || '').trim()
                  const productDesc = String(r.product_description || '').trim()
                  const productPlaceholderMyob = productCode.toLowerCase() === 'myob' && Boolean(productDesc)
                  return (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{r.invoice_no ?? ''}</TableCell>
                      <TableCell
                        sx={{ width: 140, maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}
                        title={r.customer_name || undefined}
                      >
                        {r.customer_name || '—'}
                      </TableCell>
                      <TableCell sx={{ minWidth: 220, verticalAlign: 'top' }}>
                        {productPlaceholderMyob ? (
                          <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>
                            {r.product_description}
                          </Typography>
                        ) : (
                          <>
                            <Typography variant="body2" component="div" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                              {r.product_code}
                            </Typography>
                            {r.product_description ? (
                              <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                                {r.product_description}
                              </Typography>
                            ) : null}
                          </>
                        )}
                      </TableCell>
                      <TableCell
                        sx={{
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                          color: 'text.secondary',
                          fontSize: '0.8125rem',
                          maxWidth: 280,
                          verticalAlign: 'top',
                        }}
                        title={statusTitle}
                      >
                        {statusText}
                      </TableCell>
                      <TableCell>{fmtDateDdMmYy(r.order_date)}</TableCell>
                      <TableCell>{fmtQty(Number(r.quantity_value || 0), r.quantity_unit)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {fmtPricePerKg(r.price_per_kg)}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {fmtDollarsLineItem(r.line_total, 2)}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Button size="small" variant="text" color="primary" component={Link} to={`/job-sheets/${r.id}`}>
                            View
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            component={Link}
                            to={`/job-sheets/${r.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                          >
                            Edit
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {items.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={colCount} sx={{ color: 'text.secondary' }}>
                      No job sheets match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
      </ListTableSurface>
      <ListPaginationBar
        total={total}
        page={Math.min(pageIdx, Math.max(0, Math.ceil(total / LIST_PAGE_SIZE) - 1))}
        onPageChange={(p) => setPageIdx(p)}
      />
    </Stack>
  )
}

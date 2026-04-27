import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  fetchJobSheets,
  type JobSheetListQuery,
  type JobSheetSummary,
} from '../../store/slices/jobSheetsSlice'
import { fmtDollarsLineItem, fmtDollarsPreview } from '../../utils/quoteFormat'
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
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ListFiltersCard, ListPaginationBar, ListTableSurface, LIST_PAGE_SIZE } from '../../components/list'
import { fetchCustomers, CUSTOMER_PICKER_PAGE_SIZE } from '../../store/slices/customersSlice'
import { formatDateDMYShort } from '../../utils/dateFormat'

const PRODUCT_TYPES = ['Bag', 'Tube', 'Sleeve', 'Sheet', 'Centerfold', 'U-Film'] as const
const PRINT_METHODS = ['None', 'Inline', 'Uteco'] as const
const FINISH_MODES = ['Rolls', 'Cartons'] as const
const ORDER_STATUSES = ['Draft', 'Confirmed', 'Dispatched', 'Closed', 'Cancelled'] as const
const PRODUCTION_STATUSES = ['Planned', 'Scheduled', 'Running', 'Dispatched', 'Cancelled'] as const
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
  const loading = status === 'loading'
  const [debouncing, setDebouncing] = useState(false)

  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [productType, setProductType] = useState<string>('')
  const [printed, setPrinted] = useState<string>('')
  const [finishMode, setFinishMode] = useState<string>('')
  const [widthMin, setWidthMin] = useState('')
  const [widthMax, setWidthMax] = useState('')
  const [lengthMin, setLengthMin] = useState('')
  const [lengthMax, setLengthMax] = useState('')
  const [gaugeMin, setGaugeMin] = useState('')
  const [gaugeMax, setGaugeMax] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [orderStatus, setOrderStatus] = useState('')
  const [productionStatus, setProductionStatus] = useState('')
  const [pageIdx, setPageIdx] = useState(0)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  const query = useMemo((): JobSheetListQuery => {
    const q: JobSheetListQuery = {}
    if (customerId) q.customer_id = customerId
    const s = search.trim()
    if (s) q.search = s
    if (productType) q.product_type = productType
    if (printed) q.printed = printed
    if (finishMode) q.finish_mode = finishMode
    const wmin = parseOptionalNumber(widthMin)
    const wmax = parseOptionalNumber(widthMax)
    const lmin = parseOptionalNumber(lengthMin)
    const lmax = parseOptionalNumber(lengthMax)
    const gmin = parseOptionalNumber(gaugeMin)
    const gmax = parseOptionalNumber(gaugeMax)
    if (wmin !== undefined) q.width_min_mm = wmin
    if (wmax !== undefined) q.width_max_mm = wmax
    if (lmin !== undefined) q.length_min_mm = lmin
    if (lmax !== undefined) q.length_max_mm = lmax
    if (gmin !== undefined) q.gauge_min_um = gmin
    if (gmax !== undefined) q.gauge_max_um = gmax
    if (fromDate) q.from_date = fromDate
    if (toDate) q.to_date = toDate
    if (orderStatus) q.order_status = orderStatus
    if (productionStatus) q.production_status = productionStatus
    q.page = pageIdx + 1
    q.page_size = LIST_PAGE_SIZE
    return q
  }, [customerId, search, productType, printed, finishMode, widthMin, widthMax, lengthMin, lengthMax, gaugeMin, gaugeMax, fromDate, toDate, orderStatus, productionStatus, pageIdx])

  useEffect(() => {
    void dispatch(fetchCustomers({ page: 1, page_size: CUSTOMER_PICKER_PAGE_SIZE, q: '' }))
  }, [dispatch])

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

  const handleClearFilters = () => {
    setSearch('')
    setCustomerId('')
    setProductType('')
    setPrinted('')
    setFinishMode('')
    setWidthMin('')
    setWidthMax('')
    setLengthMin('')
    setLengthMax('')
    setGaugeMin('')
    setGaugeMax('')
    setFromDate('')
    setToDate('')
    setOrderStatus('')
    setProductionStatus('')
    setPageIdx(0)
  }

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
          value: search,
          onChange: (v) => {
            setPageIdx(0)
            setSearch(v)
          },
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
                  value={fromDate}
                  onChange={(e) => {
                    setPageIdx(0)
                    setFromDate(e.target.value)
                  }}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  label="To date"
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setPageIdx(0)
                    setToDate(e.target.value)
                  }}
                  InputLabelProps={{ shrink: true }}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-order-status">Order status</InputLabel>
                  <Select
                    labelId="job-sheet-filter-order-status"
                    label="Order status"
                    value={orderStatus}
                    onChange={(e) => {
                      setPageIdx(0)
                      setOrderStatus(e.target.value)
                    }}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {ORDER_STATUSES.map((s) => (
                      <MenuItem key={s} value={s.toLowerCase()}>
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
                    value={productionStatus}
                    onChange={(e) => {
                      setPageIdx(0)
                      setProductionStatus(e.target.value)
                    }}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {PRODUCTION_STATUSES.map((s) => (
                      <MenuItem key={s} value={s.toLowerCase()}>
                        {s}
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
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-customer">Customer</InputLabel>
                  <Select
                    labelId="job-sheet-filter-customer"
                    label="Customer"
                    value={customerId}
                    onChange={(e) => {
                      setPageIdx(0)
                      setCustomerId(e.target.value)
                    }}
                  >
                    <MenuItem value="">
                      <em>Any</em>
                    </MenuItem>
                    {customers.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="job-sheet-filter-product-type">Product type</InputLabel>
                  <Select
                    labelId="job-sheet-filter-product-type"
                    label="Product type"
                    value={productType}
                    onChange={(e) => {
                      setPageIdx(0)
                      setProductType(e.target.value)
                    }}
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
                    value={printed}
                    onChange={(e) => {
                      setPageIdx(0)
                      setPrinted(e.target.value)
                    }}
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
                    value={finishMode}
                    onChange={(e) => {
                      setPageIdx(0)
                      setFinishMode(e.target.value)
                    }}
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
                  value={widthMin}
                  onChange={(e) => {
                    setPageIdx(0)
                    setWidthMin(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Width max (mm)"
                  value={widthMax}
                  onChange={(e) => {
                    setPageIdx(0)
                    setWidthMax(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Length min (mm)"
                  value={lengthMin}
                  onChange={(e) => {
                    setPageIdx(0)
                    setLengthMin(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Length max (mm)"
                  value={lengthMax}
                  onChange={(e) => {
                    setPageIdx(0)
                    setLengthMax(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Gauge min (µm)"
                  value={gaugeMin}
                  onChange={(e) => {
                    setPageIdx(0)
                    setGaugeMin(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label="Gauge max (µm)"
                  value={gaugeMax}
                  onChange={(e) => {
                    setPageIdx(0)
                    setGaugeMax(e.target.value)
                  }}
                  inputProps={{ inputMode: 'decimal' }}
                />
              </Box>
            </Box>
        }
        advancedOpen={showAdvancedFilters}
        onToggleAdvanced={() => setShowAdvancedFilters((v) => !v)}
        resultCount={total}
        onClearFilters={handleClearFilters}
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
                    [r.order_status, r.production_status].filter(Boolean).join(' · ') ||
                    '—'
                  const statusTitle = [r.order_status, r.production_status].filter(Boolean).join(' · ') || undefined
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
                        <Typography variant="body2" component="div" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                          {r.product_code}
                        </Typography>
                        {r.product_description ? (
                          <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                            {r.product_description}
                          </Typography>
                        ) : null}
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

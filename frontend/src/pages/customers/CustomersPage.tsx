import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api/client'
import { useAppSelector } from '../../store/hooks'
import { useAppDispatch } from '../../store/hooks'
import { can } from '../../auth/permissions'
import { fetchCustomers, type CustomersListQuery } from '../../store/slices/customersSlice'
import { useUrlSyncedFilters } from '../../hooks/urlSearchParamsSync'
import {
  ListFiltersCard,
  ListPaginationBar,
  ListTableSurface,
  LIST_PAGE_SIZE,
  SortHeaderCell,
  type UrlSortDir,
} from '../../components/list'
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

const CUSTOMER_STATUSES = ['Active', 'Inactive', 'Archived'] as const

const CUSTOMER_FILTER_DEFAULTS: Record<string, string> = {
  search: '',
  brandCode: '',
  statusFilter: '',
  contact: '',
  email: '',
  phone: '',
  abn: '',
  myobDisplayId: '',
  sortBy: '',
  sortDir: '',
  advanced: '',
}

const CUSTOMER_URL_KEYS: Record<string, string> = {
  search: 'q',
  brandCode: 'brand',
  statusFilter: 'st',
  contact: 'contact',
  email: 'email',
  phone: 'phone',
  abn: 'abn',
  myobDisplayId: 'myob',
  sortBy: 'sb',
  sortDir: 'sd',
  advanced: 'adv',
}

function brandLabel(row: { brand_name?: string | null; brand_code?: string | null }): string {
  const name = String(row.brand_name || '').trim()
  const code = String(row.brand_code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code || '—'
}

export function CustomersPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const canCreateOrder = can(roles, 'SALES', 'PROD_MANAGER')

  const { filters, setFilter, patchFilters, pageIdx, setPageIdx, clearFilters } = useUrlSyncedFilters({
    defaults: CUSTOMER_FILTER_DEFAULTS,
    urlKeys: CUSTOMER_URL_KEYS,
  })

  const items = useAppSelector((s) => s.customers.list.items)
  const total = useAppSelector((s) => s.customers.list.total)
  const status = useAppSelector((s) => s.customers.list.status)
  const err = useAppSelector((s) => s.customers.list.error)

  const loading = status === 'loading'
  const [debouncing, setDebouncing] = useState(false)
  const [brands, setBrands] = useState<Array<{ id: string; code: string; name: string }>>([])

  const query = useMemo((): CustomersListQuery => {
    const q: CustomersListQuery = {}
    const s = filters.search.trim()
    if (s) q.search = s
    if (filters.brandCode.trim()) q.brand_code = filters.brandCode.trim()
    if (filters.statusFilter.trim()) q.status = filters.statusFilter.trim()
    if (filters.contact.trim()) q.contact = filters.contact.trim()
    if (filters.email.trim()) q.email = filters.email.trim()
    if (filters.phone.trim()) q.phone = filters.phone.trim()
    if (filters.abn.trim()) q.abn = filters.abn.trim()
    if (filters.myobDisplayId.trim()) q.myob_display_id = filters.myobDisplayId.trim()
    const sb = filters.sortBy.trim()
    const sd = filters.sortDir.trim().toLowerCase()
    if (sb && (sd === 'asc' || sd === 'desc')) {
      q.sort_by = sb
      q.sort_dir = sd
    }
    q.page = pageIdx + 1
    q.page_size = LIST_PAGE_SIZE
    return q
  }, [filters, pageIdx])

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
      void dispatch(fetchCustomers(query))
    }, 300)
    return () => {
      window.clearTimeout(t)
      setDebouncing(false)
    }
  }, [dispatch, query])

  const searching = debouncing || loading
  const sortDirSafe: UrlSortDir =
    filters.sortDir === 'asc' || filters.sortDir === 'desc' ? filters.sortDir : ''

  const onSortColumn = (column: string, dir: 'asc' | 'desc') => {
    patchFilters({ sortBy: column, sortDir: dir })
  }

  const colCount = 7

  return (
    <Stack spacing={2}>
      <Box
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}
      >
        <Box>
          <Typography variant="h5">Customers</Typography>
          <Typography variant="body2" color="text.secondary">
            Search and filter customers by name, brand, contact, and account details.
          </Typography>
        </Box>
        {canEdit && (
          <Button variant="contained" component={Link} to="/customers/new">
            New Customer
          </Button>
        )}
      </Box>

      {err && <Alert severity="error">{err}</Alert>}

      <ListFiltersCard
        title="Find customers"
        search={{
          label: 'Search customers',
          placeholder: 'Name, contact, email, phone, ABN, MYOB display…',
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
            <FormControl size="small" fullWidth>
              <InputLabel id="customers-filter-brand">Brand</InputLabel>
              <Select
                labelId="customers-filter-brand"
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
            <FormControl size="small" fullWidth>
              <InputLabel id="customers-filter-status">Status</InputLabel>
              <Select
                labelId="customers-filter-status"
                label="Status"
                value={filters.statusFilter}
                onChange={(e) => setFilter('statusFilter', e.target.value)}
              >
                <MenuItem value="">
                  <em>Any</em>
                </MenuItem>
                {CUSTOMER_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Contact"
              value={filters.contact}
              onChange={(e) => setFilter('contact', e.target.value)}
            />
            <TextField
              size="small"
              label="Email"
              value={filters.email}
              onChange={(e) => setFilter('email', e.target.value)}
            />
            <TextField
              size="small"
              label="Phone"
              value={filters.phone}
              onChange={(e) => setFilter('phone', e.target.value)}
            />
            <TextField size="small" label="ABN" value={filters.abn} onChange={(e) => setFilter('abn', e.target.value)} />
            <TextField
              size="small"
              label="MYOB display ID"
              value={filters.myobDisplayId}
              onChange={(e) => setFilter('myobDisplayId', e.target.value)}
            />
          </Box>
        }
        advancedOpen={filters.advanced === '1'}
        onToggleAdvanced={() => setFilter('advanced', filters.advanced === '1' ? '' : '1')}
        resultCount={total}
        onClearFilters={clearFilters}
        clearDisabled={loading}
      />

      <ListTableSurface
        loadingOverlay={searching}
        loadingOverlayMessage="Searching…"
        initialLoading={loading && items.length === 0}
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortHeaderCell column="name" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Name
                </SortHeaderCell>
                <SortHeaderCell column="brand" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Brand
                </SortHeaderCell>
                <SortHeaderCell column="contact" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Contact
                </SortHeaderCell>
                <SortHeaderCell column="quotes" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Quotes
                </SortHeaderCell>
                <SortHeaderCell column="orders" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Orders
                </SortHeaderCell>
                <SortHeaderCell column="status" sortBy={filters.sortBy} sortDir={sortDirSafe} onSort={onSortColumn}>
                  Status
                </SortHeaderCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((c) => {
                const quoteCount = Number(c.quotes_count ?? 0)
                const orderCount = Number(c.orders_count ?? 0)
                const quotesLinkLabel = quoteCount > 0 ? `quotes(${quoteCount})` : 'quotes'
                const ordersLinkLabel = orderCount > 0 ? `orders(${orderCount})` : 'orders'
                const contactName = String(c.contact_first_name || '').trim() || '—'
                return (
                  <TableRow key={c.id} hover>
                    <TableCell>
                      <MuiLink component={Link} to={`/customers/${c.id}`} underline="hover">
                        {c.name}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{brandLabel(c)}</TableCell>
                    <TableCell>{contactName}</TableCell>
                    <TableCell>
                      <MuiLink
                        component={Link}
                        to={`/customers/${c.id}#quotes`}
                        underline="hover"
                        variant="body2"
                      >
                        {quotesLinkLabel}
                      </MuiLink>
                    </TableCell>
                    <TableCell>
                      <MuiLink
                        component={Link}
                        to={`/customers/${c.id}#orders`}
                        underline="hover"
                        variant="body2"
                      >
                        {ordersLinkLabel}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{c.status}</TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Button size="small" variant="text" color="primary" component={Link} to={`/customers/${c.id}`}>
                          View
                        </Button>
                        {canEdit && (
                          <Button size="small" variant="outlined" component={Link} to={`/customers/${c.id}/edit`}>
                            Edit
                          </Button>
                        )}
                        {canCreateOrder && (
                          <Button
                            size="small"
                            variant="contained"
                            component={Link}
                            to={`/orders/new?customerId=${encodeURIComponent(c.id)}`}
                          >
                            New Order
                          </Button>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                )
              })}
              {items.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={colCount} sx={{ color: 'text.secondary' }}>
                    No customers found.{' '}
                    {canEdit && (
                      <MuiLink component={Link} to="/customers/new" underline="hover">
                        Create your first customer
                      </MuiLink>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </ListTableSurface>

      <ListPaginationBar
        total={total}
        page={Math.min(pageIdx, Math.max(0, Math.ceil(total / LIST_PAGE_SIZE) - 1))}
        onPageChange={setPageIdx}
      />
    </Stack>
  )
}

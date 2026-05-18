import { useEffect, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppSelector } from '../../store/hooks'
import { useAppDispatch } from '../../store/hooks'
import { can } from '../../auth/permissions'
import { fetchCustomers } from '../../store/slices/customersSlice'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useCustomersListUrlSync } from '../../hooks/urlSearchParamsSync'
import {
  ListFiltersCard,
  ListPaginationBar,
  ListTableSurface,
  CUSTOMERS_LIST_PAGE_SIZE,
} from '../../components/list'
import { Alert, Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography, Link as MuiLink } from '@mui/material'

export function CustomersPage() {
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const canCreateOrder = can(roles, 'SALES', 'PROD_MANAGER')

  const { searchInput, setSearchInput, pageIdx, setPageIdx, writeUrl } = useCustomersListUrlSync()
  const debouncedQ = useDebouncedValue(searchInput, 300)

  const items = useAppSelector((s) => s.customers.list.items)
  const total = useAppSelector((s) => s.customers.list.total)
  const status = useAppSelector((s) => s.customers.list.status)
  const err = useAppSelector((s) => s.customers.list.error)

  const loading = status === 'loading'
  const debouncing = searchInput.trim() !== debouncedQ.trim()
  const searching = debouncing || loading
  const showInitialLoading = loading && items.length === 0 && !debouncing

  useLayoutEffect(() => {
    setPageIdx(0)
  }, [debouncedQ, setPageIdx])

  useEffect(() => {
    writeUrl(debouncedQ, pageIdx)
  }, [debouncedQ, pageIdx, writeUrl])

  useEffect(() => {
    void dispatch(
      fetchCustomers({
        q: debouncedQ.trim(),
        page: pageIdx + 1,
        page_size: CUSTOMERS_LIST_PAGE_SIZE,
      }),
    )
  }, [dispatch, debouncedQ, pageIdx])

  function handleClearFilters() {
    setSearchInput('')
    setPageIdx(0)
  }

  const maxPage = Math.max(0, Math.ceil(total / CUSTOMERS_LIST_PAGE_SIZE) - 1)
  const safePageIdx = Math.min(pageIdx, maxPage)

  return (
    <Box>
      <Box
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}
      >
        <Typography variant="h5">Customers</Typography>
        {canEdit && (
          <Button variant="contained" component={Link} to="/customers/new">
            New Customer
          </Button>
        )}
      </Box>

      <Box sx={{ mb: 2 }}>
        <ListFiltersCard
          search={{
            label: 'Search',
            placeholder: 'Search by name…',
            value: searchInput,
            onChange: (v) => setSearchInput(v),
          }}
          resultCount={total}
          onClearFilters={handleClearFilters}
          clearDisabled={loading}
        />
      </Box>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <ListTableSurface
        loadingOverlay={searching && !showInitialLoading}
        loadingOverlayMessage="Searching…"
        initialLoading={showInitialLoading}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Quotes</TableCell>
              <TableCell>Orders</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((c) => {
              const quoteCount = Number(c.quotes_count ?? 0)
              const orderCount = Number(c.orders_count ?? 0)
              const quotesLinkLabel = quoteCount > 0 ? `quotes(${quoteCount})` : 'quotes'
              const ordersLinkLabel = orderCount > 0 ? `orders(${orderCount})` : 'orders'
              return (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/customers/${c.id}`} underline="hover">
                      {c.name}
                    </MuiLink>
                  </TableCell>
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
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No customers found{debouncedQ.trim() ? '. Try a different search term.' : '.'}{' '}
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
      </ListTableSurface>

      <Box sx={{ mt: 2 }}>
        <ListPaginationBar total={total} page={safePageIdx} onPageChange={(p) => setPageIdx(p)} />
      </Box>
    </Box>
  )
}

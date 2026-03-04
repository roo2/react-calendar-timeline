import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { fetchMe, logout } from './store/slices/authSlice'
import { can, isSysAdmin as isSysAdminRole } from './auth/permissions'
import { LoginPage } from './pages/LoginPage'
import { OrdersPage } from './pages/OrdersPage'
import { InventoryPage } from './pages/InventoryPage'
import { QuotesPage } from './pages/QuotesPage'
import { QuotesListPage } from './pages/QuotesListPage'
import { QuoteEditPage } from './pages/QuoteEditPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { CustomersPage } from './pages/CustomersPage'
import { ProductsPage } from './pages/ProductsPage'
import { DashboardPage } from './pages/DashboardPage'
import { SchedulePage } from './pages/SchedulePage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { JobSheetNewPage } from './pages/JobSheetNewPage.tsx'
import { JobSheetsPage } from './pages/JobSheetsPage.tsx'
import { JobSheetShowPage } from './pages/JobSheetShowPage.tsx'
import { JobSheetEditPage } from './pages/JobSheetEditPage.tsx'
import { CustomerShowPage } from './pages/CustomerShowPage'
import { CustomerUpsertPage } from './pages/CustomerUpsertPage'
import { ProductShowPage } from './pages/ProductShowPage'
import { ProductNewPage } from './pages/ProductNewPage'
import { ProductVersionNewPage } from './pages/ProductVersionNewPage'
import { ProductVersionShowPage } from './pages/ProductVersionShowPage'
import { ProductVersionPrintPage } from './pages/ProductVersionPrintPage'
import { InventoryReceivePage } from './pages/InventoryReceivePage'
import { InventoryAdjustPage } from './pages/InventoryAdjustPage'
import { InventoryTransactionsPage } from './pages/InventoryTransactionsPage'
import { OrderNewPage } from './pages/OrderNewPage.tsx'
import { OrderShowPage } from './pages/OrderShowPage.tsx'
import { OrderAddJobPage } from './pages/OrderAddJobPage.tsx'
import { OrderEditPage } from './pages/OrderEditPage.tsx'
import {
  AppBar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext'

const ResinsAdminPage = lazy(async () => ({ default: (await import('./pages/admin/ResinsAdminPage')).ResinsAdminPage }))
const ExtrusionAdminPage = lazy(async () => ({ default: (await import('./pages/admin/ExtrusionAdminPage')).ExtrusionAdminPage }))
const ConversionAdminPage = lazy(async () => ({ default: (await import('./pages/admin/ConversionAdminPage')).ConversionAdminPage }))
const PrintingAdminPage = lazy(async () => ({ default: (await import('./pages/admin/PrintingAdminPage')).PrintingAdminPage }))
const CoresAdminPage = lazy(async () => ({ default: (await import('./pages/admin/CoresAdminPage')).CoresAdminPage }))
const PackagingAdminPage = lazy(async () => ({ default: (await import('./pages/admin/PackagingAdminPage')).PackagingAdminPage }))

function PageLoading() {
  return (
    <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
      <Typography color="text.secondary">Loading…</Typography>
    </Box>
  )
}

function RequireAuth() {
  const auth = useAppSelector((s) => s.auth)
  const location = useLocation()

  if (auth.status === 'idle' || auth.status === 'loading') {
    return (
      <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    )
  }

  if (!auth.identity?.user) {
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}

function App() {
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const auth = useAppSelector((s) => s.auth)
  const roles = auth.identity?.roles || []
  const isSalesOrPm = can(roles, 'SALES', 'PROD_MANAGER')
  const isPm = can(roles, 'PROD_MANAGER')
  // Note: used to control Admin nav visibility (and can be reused elsewhere).
  const isSysAdmin = isSysAdminRole(roles)

  useEffect(() => {
    void dispatch(fetchMe())
  }, [dispatch])

  const mainLinks = [
    { to: '/', label: 'Home', visible: true },
    { to: '/customers', label: 'Customers', visible: isSalesOrPm },
    { to: '/quotes', label: 'Quotes', visible: isSalesOrPm },
    { to: '/orders', label: 'Orders', visible: isSalesOrPm },
    { to: '/job-sheets', label: 'Job Sheets', visible: isSalesOrPm },
    { to: '/products', label: 'Products', visible: isSalesOrPm },
    { to: '/schedule', label: 'Schedule', visible: isPm },
    { to: '/inventory', label: 'Inventory', visible: isPm },
    { to: '/admin', label: 'Admin', visible: isSysAdmin },
  ].filter((x) => x.visible)

  return (
    <>
      <AppBar position="sticky" color="inherit" elevation={1}>
        <Toolbar>
          <Container maxWidth="lg" disableGutters>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexGrow: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  CrownPack
                </Typography>
              </Box>

              <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 1, flexWrap: 'wrap', mr: 2 }}>
                {mainLinks.map((l) => (
                  <Button
                    key={l.to}
                    component={NavLink}
                    to={l.to}
                    color="inherit"
                    size="small"
                    sx={{
                      textTransform: 'none',
                      '&.active': { bgcolor: 'action.selected' },
                    }}
                  >
                    {l.label}
                  </Button>
                ))}
              </Box>

              <Stack spacing={0} alignItems="flex-end" sx={{ mr: 2 }}>
                <Typography variant="body2">
                  {auth.identity?.user ? (
                    <>
                      Signed in as <strong>{auth.identity.user}</strong>
                    </>
                  ) : (
                    'Anonymous'
                  )}
                </Typography>
                {roles.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    [{roles.join(', ')}]
                  </Typography>
                )}
              </Stack>

              {auth.identity?.user ? (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={async () => {
                    await dispatch(logout()).unwrap()
                    nav('/login')
                  }}
                >
                  Logout
                </Button>
              ) : (
                <Button variant="contained" size="small" component={NavLink} to="/login">
                  Login
                </Button>
              )}
            </Box>
          </Container>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ bgcolor: 'background.default', py: 3 }}>
        <Container maxWidth="lg">
          <UnsavedChangesProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/new" element={<CustomerUpsertPage />} />
              <Route path="/customers/:customerId" element={<CustomerShowPage />} />
              <Route path="/customers/:customerId/edit" element={<CustomerUpsertPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/new" element={<ProductNewPage />} />
              <Route path="/products/:productId" element={<ProductShowPage />} />
              <Route path="/products/:productId/versions/new" element={<ProductVersionNewPage />} />
              <Route path="/products/:productId/versions/:versionId" element={<ProductVersionShowPage />} />
              <Route path="/products/:productId/versions/:versionId/print" element={<ProductVersionPrintPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/new" element={<OrderNewPage />} />
              <Route path="/orders/:orderId" element={<OrderShowPage />} />
              <Route path="/orders/:orderId/edit" element={<OrderEditPage />} />
              <Route path="/orders/:orderId/jobs/new" element={<OrderAddJobPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/inventory/receive" element={<InventoryReceivePage />} />
              <Route path="/inventory/adjust" element={<InventoryAdjustPage />} />
              <Route path="/inventory/transactions" element={<InventoryTransactionsPage />} />
              <Route path="/quotes" element={<QuotesListPage />} />
              <Route path="/quotes/new" element={<QuotesPage />} />
              <Route path="/quotes/:id/edit" element={<QuoteEditPage />} />
              <Route path="/job-sheets" element={<JobSheetsPage />} />
              <Route path="/job-sheets/new" element={<JobSheetNewPage />} />
              <Route path="/job-sheets/:jobSheetId" element={<JobSheetShowPage />} />
              <Route path="/job-sheets/:jobSheetId/edit" element={<JobSheetEditPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="resins" replace />} />
                <Route
                  path="resins"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <ResinsAdminPage />
                    </Suspense>
                  }
                />
                <Route path="additives" element={<Navigate to="../resins" replace />} />
                <Route path="colours" element={<Navigate to="../resins" replace />} />
                <Route path="resin-blends" element={<Navigate to="../resins" replace />} />
                <Route
                  path="extrusion"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <ExtrusionAdminPage />
                    </Suspense>
                  }
                />
                <Route
                  path="conversion"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <ConversionAdminPage />
                    </Suspense>
                  }
                />
                <Route
                  path="printing"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <PrintingAdminPage />
                    </Suspense>
                  }
                />
                <Route
                  path="cores"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <CoresAdminPage />
                    </Suspense>
                  }
                />
                <Route
                  path="packaging"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <PackagingAdminPage />
                    </Suspense>
                  }
                />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </UnsavedChangesProvider>
        </Container>

        <Container maxWidth="lg" sx={{ mt: 6 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              © CrownPack — Built for manufacturing excellence
            </Typography>
            <Typography variant="body2" color="text.secondary">
              v0.1
            </Typography>
          </Box>
        </Container>
      </Box>
    </>
  )
}

export default App

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ApiError, apiFetch } from '../../api/client'
import { AdminPageHeader } from './components/AdminPageHeader'

type XeroConnectionRow = {
  tenantId?: string
  tenantName?: string
  tenantType?: string
}

type XeroStatus = {
  configured: boolean
  connected: boolean
  tenant_id: string | null
  tenant_name: string | null
  access_token_expires_at: string | null
  last_refreshed_at: string | null
  scope: string | null
  connections: XeroConnectionRow[]
}

type XeroCustomerLinkMatch = {
  contact_id: string
  xero_name: string
  xero_account_code?: string | null
  app_customer_id: string
  app_customer_name: string
  myob_display_id?: string | null
  reason: string
  already_linked: boolean
  will_link: boolean
}

type XeroCustomerLinkPreview = {
  xero_contacts_count: number
  matched_count: number
  will_link_count: number
  already_linked_count: number
  unmatched_xero_count: number
  conflict_count: number
  linked_count?: number
  errors?: string[]
  matches: XeroCustomerLinkMatch[]
  unmatched_xero: Array<Record<string, unknown>>
  conflicts: Array<Record<string, unknown>>
}

type XeroUnlinkedCustomerRow = {
  id: string
  name: string
  status?: string | null
  myob_display_id?: string | null
  myob_customer_uid?: string | null
  orders_count: number
  quotes_count: number
  products_count: number
}

type XeroUnlinkedCustomerReview = {
  total: number
  with_orders_count: number
  without_orders_count: number
  items: XeroUnlinkedCustomerRow[]
}

export function XeroAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<XeroStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'error' | null>(null)
  const [bannerDetail, setBannerDetail] = useState<string | null>(null)
  const [tenantPick, setTenantPick] = useState('')
  const [quoteCustomerId, setQuoteCustomerId] = useState('')
  const [quoteTitle, setQuoteTitle] = useState('Quote')
  const [quoteLineDesc, setQuoteLineDesc] = useState('Line item')
  const [quoteQty, setQuoteQty] = useState('1')
  const [quoteAmount, setQuoteAmount] = useState('0')
  const [quoteResult, setQuoteResult] = useState<unknown>(null)
  const [apiEndpoint, setApiEndpoint] = useState('/Contacts?where=IsCustomer==true&page=1')
  const [apiResult, setApiResult] = useState<unknown>(null)
  const [linkPreview, setLinkPreview] = useState<XeroCustomerLinkPreview | null>(null)
  const [unlinkedReview, setUnlinkedReview] = useState<XeroUnlinkedCustomerReview | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch<XeroStatus>('/api/xero/status')
      setStatus(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load Xero status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const m = searchParams.get('xero')
    if (m !== 'connected' && m !== 'error') return
    setBanner(m === 'connected' ? 'success' : 'error')
    setBannerDetail(searchParams.get('detail'))
    const next = new URLSearchParams(searchParams)
    next.delete('xero')
    next.delete('detail')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const tid = (status?.tenant_id || '').trim()
    if (tid) setTenantPick(tid)
  }, [status?.tenant_id])

  async function doRefresh() {
    setBusy('refresh')
    setErr(null)
    try {
      await apiFetch<{ ok: boolean }>('/api/xero/refresh', { method: 'POST' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(null)
    }
  }

  async function doSetTenant() {
    const tid = tenantPick.trim()
    if (!tid) return
    setBusy('tenant')
    setErr(null)
    try {
      await apiFetch<{ ok: boolean }>('/api/xero/tenant', {
        method: 'POST',
        body: JSON.stringify({ tenant_id: tid }),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to set tenant')
    } finally {
      setBusy(null)
    }
  }

  async function doDisconnect() {
    if (!window.confirm('Disconnect Xero on this server? Stored tokens and tenant will be cleared.')) return
    setBusy('disconnect')
    setErr(null)
    setQuoteResult(null)
    setApiResult(null)
    try {
      await apiFetch<{ ok: boolean }>('/api/xero/disconnect', { method: 'POST' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setBusy(null)
    }
  }

  async function doXeroApiGet() {
    const endpoint = apiEndpoint.trim()
    if (!endpoint) {
      setErr('Enter a Xero Accounting API endpoint, for example /Contacts?page=1.')
      return
    }
    setBusy('api-get')
    setErr(null)
    setApiResult(null)
    try {
      const out = await apiFetch<unknown>('/api/xero/api-get', {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      })
      setApiResult(out)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Xero API GET failed')
    } finally {
      setBusy(null)
    }
  }

  async function doPreviewCustomerLinks() {
    setBusy('xero-customer-preview')
    setErr(null)
    try {
      const out = await apiFetch<XeroCustomerLinkPreview>('/api/xero/customers/link-preview')
      setLinkPreview(out)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Xero customer link preview failed')
    } finally {
      setBusy(null)
    }
  }

  async function doImportCustomerLinks() {
    setBusy('xero-customer-import')
    setErr(null)
    try {
      const out = await apiFetch<XeroCustomerLinkPreview>('/api/xero/customers/link-import', { method: 'POST' })
      setLinkPreview(out)
      await load()
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Xero customer link import failed')
    } finally {
      setBusy(null)
    }
  }

  async function doLoadUnlinkedCustomers() {
    setBusy('xero-unlinked')
    setErr(null)
    try {
      const out = await apiFetch<XeroUnlinkedCustomerReview>('/api/xero/customers/unlinked')
      setUnlinkedReview(out)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Failed to load unlinked customers')
    } finally {
      setBusy(null)
    }
  }

  async function doCreateDraftQuote() {
    const customerId = quoteCustomerId.trim()
    if (!customerId) {
      setErr('Enter a customer id (the app customer UUID). The customer must have xero_contact_id set.')
      return
    }
    setBusy('quote')
    setErr(null)
    setQuoteResult(null)
    const qty = Number(quoteQty)
    const amt = Number(quoteAmount)
    try {
      const out = await apiFetch<unknown>('/api/xero/quotes/draft', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          title: quoteTitle.trim() || 'Quote',
          line_description: quoteLineDesc.trim() || 'Line item',
          quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
          unit_amount: Number.isFinite(amt) ? amt : 0,
        }),
      })
      setQuoteResult(out)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Create quote failed')
    } finally {
      setBusy(null)
    }
  }

  const orgConnections = (status?.connections || []).filter(
    (c) => String(c.tenantType || '').toUpperCase() === 'ORGANISATION' || !c.tenantType,
  )

  return (
    <Box>
      <AdminPageHeader title="Xero" subtitle="OAuth connection, tenant selection, and draft quotes." />

      {banner === 'success' ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Xero connected successfully.
        </Alert>
      ) : null}
      {banner === 'error' ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Xero connection failed{bannerDetail ? `: ${bannerDetail}` : '.'}
        </Alert>
      ) : null}
      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2">
              <strong>API configured:</strong> {status?.configured ? 'yes' : 'no'}
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                (XERO_CLIENT_ID / XERO_CLIENT_SECRET on the server)
              </Typography>
            </Typography>
            <Typography variant="body2">
              <strong>Connected:</strong> {status?.connected ? 'yes' : 'no'}
            </Typography>
            {status?.connected ? (
              <>
                <Typography variant="body2">
                  <strong>Active tenant:</strong> {status.tenant_name || '—'}{' '}
                  {status.tenant_id ? (
                    <Typography component="span" variant="body2" color="text.secondary">
                      (<code>{status.tenant_id}</code>)
                    </Typography>
                  ) : null}
                </Typography>
                <Typography variant="body2">
                  <strong>Scopes:</strong> {status.scope ?? '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Access token expires (UTC):</strong> {status.access_token_expires_at ?? '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Last refreshed (UTC):</strong> {status.last_refreshed_at ?? '—'}
                </Typography>
              </>
            ) : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
              <Button component="a" href="/api/xero/oauth/start" variant="contained" disabled={!status?.configured}>
                {status?.connected ? 'Reconnect Xero' : 'Connect Xero'}
              </Button>
              <Button variant="outlined" onClick={() => void doRefresh()} disabled={!status?.connected || busy !== null}>
                Refresh access token (no browser login)
              </Button>
              <Button
                color="error"
                variant="outlined"
                onClick={() => void doDisconnect()}
                disabled={!status?.connected || busy !== null}
              >
                Disconnect
              </Button>
            </Stack>

            {status?.connected && orgConnections.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Organisation tenant
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  After OAuth, pick which Xero organisation to use for API calls (stored as{' '}
                  <code>xero-tenant-id</code>).
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControl size="small" sx={{ minWidth: 280 }}>
                    <InputLabel id="xero-tenant-label">Tenant</InputLabel>
                    <Select
                      labelId="xero-tenant-label"
                      label="Tenant"
                      value={tenantPick}
                      onChange={(e) => setTenantPick(String(e.target.value))}
                    >
                      {orgConnections.map((c) => {
                        const id = String(c.tenantId || '').trim()
                        if (!id) return null
                        const name = String(c.tenantName || '').trim() || id
                        return (
                          <MenuItem key={id} value={id}>
                            {name}
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                  <Button variant="contained" onClick={() => void doSetTenant()} disabled={busy !== null || !tenantPick}>
                    Save tenant
                  </Button>
                </Stack>
              </Paper>
            ) : null}

            {status?.connected ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Link Xero customers
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Matches Xero customer contacts to existing app customers and only writes{' '}
                  <code>xero_contact_id</code>. App customer details are not synced from Xero.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="outlined"
                    onClick={() => void doPreviewCustomerLinks()}
                    disabled={busy !== null}
                  >
                    Preview customer links
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void doImportCustomerLinks()}
                    disabled={busy !== null || (linkPreview != null && linkPreview.will_link_count === 0)}
                  >
                    Apply safe links
                  </Button>
                  <Button variant="outlined" onClick={() => void doLoadUnlinkedCustomers()} disabled={busy !== null}>
                    Show unlinked app customers
                  </Button>
                </Stack>

                {linkPreview ? (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      Xero contacts: <strong>{linkPreview.xero_contacts_count}</strong> · Matched:{' '}
                      <strong>{linkPreview.matched_count}</strong> · To link:{' '}
                      <strong>{linkPreview.will_link_count}</strong> · Already linked:{' '}
                      <strong>{linkPreview.already_linked_count}</strong> · Unmatched Xero:{' '}
                      <strong>{linkPreview.unmatched_xero_count}</strong> · Conflicts:{' '}
                      <strong>{linkPreview.conflict_count}</strong>
                      {linkPreview.linked_count != null ? (
                        <>
                          {' '}
                          · Linked this run: <strong>{linkPreview.linked_count}</strong>
                        </>
                      ) : null}
                    </Typography>
                    {linkPreview.errors && linkPreview.errors.length > 0 ? (
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        {linkPreview.errors.join('; ')}
                      </Alert>
                    ) : null}
                    <Paper variant="outlined" sx={{ maxHeight: 320, overflow: 'auto' }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Xero customer</TableCell>
                            <TableCell>App customer</TableCell>
                            <TableCell>Reason</TableCell>
                            <TableCell>Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {linkPreview.matches.slice(0, 50).map((m) => (
                            <TableRow key={m.contact_id}>
                              <TableCell>
                                <Typography variant="body2">{m.xero_name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {m.xero_account_code || m.contact_id}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">{m.app_customer_name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {m.myob_display_id || m.app_customer_id}
                                </Typography>
                              </TableCell>
                              <TableCell>{m.reason}</TableCell>
                              <TableCell>{m.already_linked ? 'Already linked' : m.will_link ? 'Will link' : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                    {linkPreview.matches.length > 50 ? (
                      <Typography variant="caption" color="text.secondary">
                        Showing first 50 matched rows.
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}

                {unlinkedReview ? (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      Unlinked app customers: <strong>{unlinkedReview.total}</strong> · With orders:{' '}
                      <strong>{unlinkedReview.with_orders_count}</strong> · Without orders:{' '}
                      <strong>{unlinkedReview.without_orders_count}</strong>
                    </Typography>
                    <Paper variant="outlined" sx={{ maxHeight: 360, overflow: 'auto' }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Customer</TableCell>
                            <TableCell>MYOB display</TableCell>
                            <TableCell align="right">Orders</TableCell>
                            <TableCell align="right">Quotes</TableCell>
                            <TableCell align="right">Products</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {unlinkedReview.items.map((row) => (
                            <TableRow key={row.id} hover>
                              <TableCell>{row.name}</TableCell>
                              <TableCell>{row.myob_display_id || '—'}</TableCell>
                              <TableCell align="right">{row.orders_count}</TableCell>
                              <TableCell align="right">{row.quotes_count}</TableCell>
                              <TableCell align="right">{row.products_count}</TableCell>
                              <TableCell>{row.status || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                ) : null}
              </Paper>
            ) : null}

            {status?.connected ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Xero API GET utility
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Enter a relative Xero Accounting API endpoint. Authentication and <code>xero-tenant-id</code> are added by the
                  server.
                </Typography>
                <Stack spacing={1.5}>
                  <TextField
                    size="small"
                    label="Endpoint"
                    value={apiEndpoint}
                    onChange={(e) => setApiEndpoint(e.target.value)}
                    helperText="Examples: /Contacts?where=IsCustomer==true&page=1, /Contacts/{ContactID}, /Accounts"
                    fullWidth
                  />
                  <Button
                    variant="contained"
                    onClick={() => void doXeroApiGet()}
                    disabled={busy !== null || !apiEndpoint.trim()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Call Xero GET endpoint
                  </Button>
                </Stack>
                {apiResult ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      mt: 2,
                      p: 1,
                      maxHeight: 420,
                      overflow: 'auto',
                      bgcolor: 'background.paper',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 11,
                    }}
                    component="pre"
                  >
                    {JSON.stringify(apiResult, null, 2)}
                  </Paper>
                ) : null}
              </Paper>
            ) : null}

            {status?.connected ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Create draft quote (Xero)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {"Uses the customer's "}
                  <code>xero_contact_id</code>
                  {' (Xero Contact UUID). Set it on the customer record in the app before creating quotes.'}
                </Typography>
                <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
                  <TextField
                    size="small"
                    label="Customer id (app)"
                    value={quoteCustomerId}
                    onChange={(e) => setQuoteCustomerId(e.target.value)}
                    helperText="UUID from /customers — not the Xero contact id."
                  />
                  <TextField size="small" label="Title" value={quoteTitle} onChange={(e) => setQuoteTitle(e.target.value)} />
                  <TextField
                    size="small"
                    label="Line description"
                    value={quoteLineDesc}
                    onChange={(e) => setQuoteLineDesc(e.target.value)}
                  />
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small"
                      label="Quantity"
                      type="number"
                      value={quoteQty}
                      onChange={(e) => setQuoteQty(e.target.value)}
                      sx={{ width: 120 }}
                    />
                    <TextField
                      size="small"
                      label="Unit amount"
                      type="number"
                      value={quoteAmount}
                      onChange={(e) => setQuoteAmount(e.target.value)}
                      sx={{ width: 140 }}
                    />
                  </Stack>
                  <Button variant="contained" onClick={() => void doCreateDraftQuote()} disabled={busy !== null}>
                    Create draft quote in Xero
                  </Button>
                </Stack>
                {quoteResult ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      mt: 2,
                      p: 1,
                      maxHeight: 360,
                      overflow: 'auto',
                      bgcolor: 'background.paper',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 11,
                    }}
                    component="pre"
                  >
                    {JSON.stringify(quoteResult, null, 2)}
                  </Paper>
                ) : null}
              </Paper>
            ) : null}
          </Stack>
        )}
      </Paper>
    </Box>
  )
}

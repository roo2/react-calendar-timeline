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
    try {
      await apiFetch<{ ok: boolean }>('/api/xero/disconnect', { method: 'POST' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disconnect failed')
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

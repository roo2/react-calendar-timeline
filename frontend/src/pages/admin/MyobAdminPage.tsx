import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminPageHeader } from './components/AdminPageHeader'

type MyobStatus = {
  configured: boolean
  connected: boolean
  business_id: string | null
  /** Where the effective company file id comes from: env MYOB_COMPANY_FILE_ID vs database. */
  business_id_source: 'config' | 'database' | null
  access_token_expires_at: string | null
  last_refreshed_at: string | null
  scope: string | null
  myob_username: string | null
}

type MyobCustomersPreview = {
  business_id: string
  count: number
  pages_fetched: number
  truncated: boolean
  items: unknown[]
}

export function MyobAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<MyobStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'error' | null>(null)
  const [bannerDetail, setBannerDetail] = useState<string | null>(null)
  const [preview, setPreview] = useState<MyobCustomersPreview | null>(null)
  const [companyFileId, setCompanyFileId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch<MyobStatus>('/api/myob/status')
      setStatus(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load MYOB status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (status?.business_id_source === 'config') return
    if (status?.business_id != null) setCompanyFileId(status.business_id)
  }, [status?.business_id, status?.business_id_source])

  useEffect(() => {
    const m = searchParams.get('myob')
    if (m !== 'connected' && m !== 'error') return
    setBanner(m === 'connected' ? 'success' : 'error')
    setBannerDetail(searchParams.get('detail'))
    const next = new URLSearchParams(searchParams)
    next.delete('myob')
    next.delete('detail')
    setSearchParams(next, { replace: true })
    // Only read OAuth redirect params once on return from MYOB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doRefresh() {
    setBusy('refresh')
    setErr(null)
    try {
      await apiFetch<{ ok: boolean; message?: string }>('/api/myob/refresh', { method: 'POST' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(null)
    }
  }

  async function saveCompanyFileId() {
    const trimmed = companyFileId.trim()
    if (!trimmed) return
    setBusy('company-id')
    setErr(null)
    try {
      await apiFetch<{ ok: boolean }>('/api/myob/company-file-id', {
        method: 'POST',
        body: JSON.stringify({ business_id: trimmed }),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save company file id')
    } finally {
      setBusy(null)
    }
  }

  async function doDisconnect() {
    if (!window.confirm('Disconnect MYOB on this server? Stored tokens and company file id will be cleared.')) return
    setBusy('disconnect')
    setErr(null)
    setPreview(null)
    try {
      await apiFetch<{ ok: boolean }>('/api/myob/disconnect', { method: 'POST' })
      setCompanyFileId('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setBusy(null)
    }
  }

  async function doPreviewCustomers() {
    setBusy('preview')
    setErr(null)
    setPreview(null)
    try {
      const data = await apiFetch<MyobCustomersPreview>('/api/myob/customers/preview', { method: 'POST' })
      setPreview(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to fetch MYOB customers')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Box>
      <AdminPageHeader title="MYOB" subtitle="Connect your MYOB Business file for read-only integration (customers)." />

      {banner === 'success' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          MYOB connected successfully.
        </Alert>
      )}
      {banner === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          MYOB connection failed{bannerDetail ? `: ${bannerDetail}` : '.'}
        </Alert>
      )}
      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2">
              <strong>API configured:</strong> {status?.configured ? 'yes' : 'no'}{' '}
              <Typography component="span" variant="body2" color="text.secondary">
                (MYOB_APP_KEY / MYOB_APP_SECRET on the server)
              </Typography>
            </Typography>
            <Typography variant="body2">
              <strong>Connected:</strong> {status?.connected ? 'yes' : 'no'}
            </Typography>
            {status?.connected && !status.business_id ? (
              <Alert severity="warning">
                No company file id for API calls. Set <code>MYOB_COMPANY_FILE_ID</code> on the server, paste the GUID
                below and click <strong>Save company file id</strong>, or reconnect OAuth so MYOB appends{' '}
                <code>businessId</code> to the redirect URL.
              </Alert>
            ) : null}

            {status?.business_id_source === 'config' ? (
              <Alert severity="info">
                Company file id is taken from <code>MYOB_COMPANY_FILE_ID</code> (overrides any value stored in the
                database).
              </Alert>
            ) : null}

            {status?.connected ? (
              <>
                <Typography variant="body2">
                  <strong>Company file id (API):</strong> {status.business_id ?? '—'}
                  {status.business_id_source ? (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                      ({status.business_id_source === 'config' ? 'from MYOB_COMPANY_FILE_ID' : 'from database'})
                    </Typography>
                  ) : null}
                </Typography>
                <Typography variant="body2">
                  <strong>MYOB user:</strong> {status.myob_username ?? '—'}
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
              <Button
                component="a"
                href="/api/myob/oauth/start"
                variant="contained"
                disabled={!status?.configured}
              >
                {status?.connected ? 'Reconnect MYOB' : 'Connect MYOB'}
              </Button>
              <Button variant="outlined" onClick={() => void doRefresh()} disabled={!status?.connected || busy !== null}>
                Refresh access token (no browser login)
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => void doPreviewCustomers()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'preview' ? 'Fetching customers…' : 'Test: fetch customers from MYOB (read-only)'}
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => void doDisconnect()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect MYOB'}
              </Button>
            </Stack>

            {status?.connected && status.business_id_source !== 'config' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField
                  label="Company file id (MYOB business GUID)"
                  value={companyFileId}
                  onChange={(e) => setCompanyFileId(e.target.value)}
                  size="small"
                  fullWidth
                  sx={{ maxWidth: 520 }}
                  placeholder="e.g. 553ede42-d314-4823-9ba7-023b9ac8b99d"
                  helperText="Stored in the app database. Prefer MYOB_COMPANY_FILE_ID in server env for production. Does not change your MYOB file."
                />
                <Button
                  variant="contained"
                  color="inherit"
                  onClick={() => void saveCompanyFileId()}
                  disabled={busy !== null || !companyFileId.trim()}
                >
                  {busy === 'company-id' ? 'Saving…' : 'Save company file id'}
                </Button>
              </Stack>
            ) : null}

            <Typography variant="body2" color="text.secondary">
              Connect opens MYOB&apos;s login/consent page. After approval, tokens are stored on the server. Use{' '}
              <strong>Refresh access token</strong> to rotate the access token using the stored refresh token; check the{' '}
              <strong>Python process stdout</strong> for <code>[MYOB] access_token=...</code> while developing.
            </Typography>

            <Typography variant="body2" color="text.secondary">
              <strong>Test: fetch customers</strong> runs GET-only requests to MYOB&apos;s API (no changes to your MYOB
              file). Set <code>MYOB_COMPANY_FILE_USER</code> and <code>MYOB_COMPANY_FILE_PASSWORD</code> on the server
              (company file login) if MYOB returns 401 — see MYOB API headers documentation.
            </Typography>

            {preview ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  MYOB customers preview ({preview.count} records
                  {preview.truncated ? ', truncated — hit page cap' : ''})
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    maxHeight: 480,
                    overflow: 'auto',
                    bgcolor: 'action.hover',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                  }}
                  component="pre"
                >
                  {JSON.stringify(preview, null, 2)}
                </Paper>
              </Box>
            ) : null}

            <Typography variant="body2" color="text.secondary">
              Docs:{' '}
              <Link
                href="https://apisupport.myob.com/hc/en-us/articles/13065472856719-MYOB-OAuth2-0-Authentication-Guide-Post-March-2025"
                target="_blank"
                rel="noreferrer"
              >
                MYOB OAuth 2.0 guide (post–March 2025)
              </Link>
            </Typography>
          </Stack>
        )}
      </Paper>
    </Box>
  )
}

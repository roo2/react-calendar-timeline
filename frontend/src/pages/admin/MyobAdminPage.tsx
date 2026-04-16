import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Link, Paper, Stack, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminPageHeader } from './components/AdminPageHeader'

type MyobStatus = {
  configured: boolean
  connected: boolean
  business_id: string | null
  access_token_expires_at: string | null
  last_refreshed_at: string | null
  scope: string | null
  myob_username: string | null
}

export function MyobAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<MyobStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'error' | null>(null)
  const [bannerDetail, setBannerDetail] = useState<string | null>(null)

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
            {status?.connected ? (
              <>
                <Typography variant="body2">
                  <strong>Business ID:</strong> {status.business_id ?? '—'}
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

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
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
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Connect opens MYOB&apos;s login/consent page. After approval, tokens are stored on the server. Use{' '}
              <strong>Refresh access token</strong> to rotate the access token using the stored refresh token; check the{' '}
              <strong>Python process stdout</strong> for <code>[MYOB] access_token=...</code> while developing.
            </Typography>

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

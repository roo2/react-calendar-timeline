import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, Paper, Stack, TextField, Typography } from '@mui/material'
import { ApiError, apiFetch } from '../../api/client'
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

type MyobSyncResult = {
  ok: boolean
  business_id?: string
  source_count: number
  truncated: boolean
  created: number
  updated: number
  errors: string[]
  /** Aggregated MYOB GET response (business_id, count, pages_fetched, truncated, items) used for this import. */
  myob_json?: MyobCustomersPreview
}

type MyobImportOneResult = {
  ok: boolean
  order_id: string
  myob_order_uid: string
  myob_all_job_sheets_entered: boolean
  lines_synced: number
}

type MyobImportFromListResult = {
  ok: boolean
  list_request_url: string
  top: number
  skip: number
  list_item_count: number
  imported: number
  failed: number
  results: MyobImportOneResult[]
  errors: Array<{ order_uid?: string | null; order_uri?: string | null; error: string }>
}

type MyobImportAllResult = {
  ok: boolean
  pages_fetched: number
  truncated: boolean
  top: number
  first_list_request_url: string | null
  last_list_request_url: string | null
  imported: number
  skipped: number
  failed: number
  results: MyobImportOneResult[]
  skipped_results: unknown[]
  errors: Array<{ order_uid?: string | null; order_uri?: string | null; error: string }>
}

type MyobItemUomSummary = {
  row_count: number
  by_selling_unit_of_measure: Array<{ selling_unit_of_measure: string | null; count: number }>
  by_is_bought?: Array<{ is_bought: boolean | 'null'; count: number }>
}

type MyobItemUomRebuildResult = {
  ok: boolean
  rows_inserted: number
  pages_fetched: number
  truncated: boolean
}

/** Response from ``POST /api/myob/import/pipeline`` (customers → item cache → orders). */
type MyobImportPipelineResult = {
  ok: boolean
  orders_mode: 'all' | 'page'
  customers: MyobSyncResult
  item_cache: MyobItemUomRebuildResult
  orders: MyobImportAllResult | MyobImportFromListResult
}

type MyobPipelineStartResponse = {
  job_id: string
  status_path: string
}

/** ``GET /api/myob/import/jobs/{job_id}`` while a background pipeline runs. */
/** Must match ``MYOB_SALE_ORDER_LIST_HARD_CAP`` in ``app/integrations/myob/service.py`` (API request validation). */
const MYOB_SALE_ORDER_LIST_HARD_CAP = 10_000

type MyobImportJobStatus = {
  job_id: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  phase: 'customers' | 'item_cache' | 'orders' | 'done'
  message: string
  orders_mode: 'all' | 'page'
  orders_top: number
  orders_skip: number
  created_at: string
  updated_at: string
  partial: Record<string, unknown>
  result: MyobImportPipelineResult | null
  error: string | null
}

export function MyobAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<MyobStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'error' | null>(null)
  const [bannerDetail, setBannerDetail] = useState<string | null>(null)
  const [companyFileId, setCompanyFileId] = useState('')
  const [importAllTop, setImportAllTop] = useState(200)
  const [skipCustomers, setSkipCustomers] = useState(false)
  const [skipItemCache, setSkipItemCache] = useState(false)
  const [arbitraryGetUrl, setArbitraryGetUrl] = useState('')
  const [arbitraryGetResult, setArbitraryGetResult] = useState<{ request_url: string; myob: unknown } | null>(null)
  const [itemUomSummary, setItemUomSummary] = useState<MyobItemUomSummary | null>(null)
  const [itemUomRebuildResult, setItemUomRebuildResult] = useState<MyobItemUomRebuildResult | null>(null)
  const [pipelineResult, setPipelineResult] = useState<MyobImportPipelineResult | null>(null)
  const [pipelineJob, setPipelineJob] = useState<MyobImportJobStatus | null>(null)
  const pipelinePollRef = useRef<number | null>(null)

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
    return () => {
      if (pipelinePollRef.current !== null) {
        window.clearInterval(pipelinePollRef.current)
        pipelinePollRef.current = null
      }
    }
  }, [])

  const stopPipelinePolling = useCallback(() => {
    if (pipelinePollRef.current !== null) {
      window.clearInterval(pipelinePollRef.current)
      pipelinePollRef.current = null
    }
  }, [])

  const beginPipelinePolling = useCallback(
    async (jobId: string) => {
      const finish = () => {
        stopPipelinePolling()
        setBusy(null)
      }
      const pollOnce = async () => {
        try {
          const st = await apiFetch<MyobImportJobStatus>(`/api/myob/import/jobs/${encodeURIComponent(jobId)}`)
          setPipelineJob(st)
          if (st.status === 'completed') {
            finish()
            if (st.result) setPipelineResult(st.result)
            await doLoadItemUomSummary()
          } else if (st.status === 'failed' || st.status === 'interrupted') {
            finish()
            setErr(st.error || st.message || 'MYOB import pipeline failed')
          }
        } catch (e) {
          finish()
          setErr(e instanceof Error ? e.message : 'MYOB import job poll failed')
        }
      }

      await pollOnce()
      pipelinePollRef.current = window.setInterval(() => void pollOnce(), 1500)
    },
    [stopPipelinePolling],
  )

  useEffect(() => {
    const loadCurrentJob = async () => {
      try {
        const current = await apiFetch<MyobImportJobStatus | null>('/api/myob/import/jobs/current')
        if (current && current.status === 'running') {
          setPipelineJob(current)
          setBusy('import-pipeline-all')
          await beginPipelinePolling(current.job_id)
        }
      } catch {
        // Best effort only; page still works without this.
      }
    }
    void loadCurrentJob()
  }, [beginPipelinePolling])

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
    setArbitraryGetResult(null)
    setItemUomSummary(null)
    setItemUomRebuildResult(null)
    setPipelineResult(null)
    setPipelineJob(null)
    if (pipelinePollRef.current !== null) {
      window.clearInterval(pipelinePollRef.current)
      pipelinePollRef.current = null
    }
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

  async function doLoadItemUomSummary() {
    setBusy('item-uom-summary')
    setErr(null)
    try {
      const data = await apiFetch<MyobItemUomSummary>('/api/myob/item-selling-uoms/summary')
      setItemUomSummary(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load item UOM summary')
    } finally {
      setBusy(null)
    }
  }

  async function doArbitraryGetJson() {
    const u = arbitraryGetUrl.trim()
    if (!u) {
      setErr('Paste a full https URL under your company file (e.g. Inventory/Item/…).')
      return
    }
    setBusy('arbitrary-get')
    setErr(null)
    setArbitraryGetResult(null)
    try {
      const data = await apiFetch<{ request_url: string; myob: unknown }>('/api/myob/get-json', {
        method: 'POST',
        body: JSON.stringify({ url: u }),
      })
      setArbitraryGetResult(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'MYOB GET failed')
    } finally {
      setBusy(null)
    }
  }

  async function doImportPipeline() {
    const topAll = Number.isFinite(importAllTop)
      ? Math.min(MYOB_SALE_ORDER_LIST_HARD_CAP, Math.max(1, importAllTop))
      : 200
    const msg = [
      'Run the full MYOB import pipeline?',
      '',
      skipCustomers ? '1. Skip customer sync (as selected)' : '1. Sync ALL customers from MYOB into this app',
      skipItemCache
        ? '2. Skip item UOM cache rebuild (as selected)'
        : '2. Rebuild the local item UOM cache (full Inventory/Item list + income accounts)',
      `3. Page through all sale orders (GET …/Sale/Order, $top=${topAll} per list page until none remain), fetch/import only Open orders`,
      '4. Import all sale invoices',
      '',
      'This can take many minutes and performs many API calls.',
      'The server runs the work in the background; this page polls for status.',
    ].join('\n')
    if (!window.confirm(msg)) return
    stopPipelinePolling()
    setBusy('import-pipeline-all')
    setErr(null)
    setPipelineResult(null)
    setPipelineJob(null)
    setItemUomRebuildResult(null)
    const body = {
      orders: 'all' as const,
      orders_top: topAll,
      orders_skip: 0,
      skip_customers: skipCustomers,
      skip_item_cache: skipItemCache,
    }
    try {
      const start = await apiFetch<MyobPipelineStartResponse>('/api/myob/import/pipeline/start', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await beginPipelinePolling(start.job_id)
    } catch (e) {
      setBusy(null)
      if (e instanceof ApiError && e.status === 409) {
        const d = e.body?.detail
        const msg =
          typeof d === 'object' && d !== null && 'message' in d && typeof (d as { message: unknown }).message === 'string'
            ? (d as { message: string }).message
            : e.message
        const rj =
          typeof d === 'object' && d !== null && 'running_job' in d ? (d as { running_job: unknown }).running_job : null
        if (rj && typeof rj === 'object' && 'job_id' in (rj as Record<string, unknown>)) {
          const running = rj as MyobImportJobStatus
          setPipelineJob(running)
          setBusy('import-pipeline-all')
          await beginPipelinePolling(running.job_id)
        }
        setErr(`${msg}${rj != null ? ` ${typeof rj === 'string' ? rj : JSON.stringify(rj)}` : ''}`)
      } else {
        setErr(e instanceof Error ? e.message : 'MYOB import pipeline failed to start')
      }
    }
  }

  return (
    <Box>
      <AdminPageHeader
        title="MYOB"
        subtitle="Connect your MYOB Business file for read-only integration (customers, sale orders, item-invoice API testing, and one-order import)."
      />

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
      {pipelineJob && pipelineJob.status === 'running' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            MYOB import pipeline (background)
          </Typography>
          <Typography variant="body2">{pipelineJob.message}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Phase: <code>{pipelineJob.phase}</code> · job <code>{pipelineJob.job_id}</code>
          </Typography>
          {Object.keys(pipelineJob.partial).length > 0 ? (
            <Paper
              variant="outlined"
              sx={{
                mt: 1,
                p: 1,
                maxHeight: 200,
                overflow: 'auto',
                bgcolor: 'action.hover',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 11,
              }}
              component="pre"
            >
              {JSON.stringify(pipelineJob.partial, null, 2)}
            </Paper>
          ) : null}
        </Alert>
      ) : null}
      {pipelineResult ? (
        <Alert
          severity={(() => {
            if (!pipelineResult.ok) return 'warning'
            if (!pipelineResult.customers.ok || pipelineResult.customers.errors.length > 0) return 'warning'
            if (pipelineResult.item_cache.truncated) return 'warning'
            const o = pipelineResult.orders as MyobImportAllResult
            if (o.truncated || o.failed > 0) return 'warning'
            return 'success'
          })()}
          sx={{ mb: 2 }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Import pipeline finished (all orders + invoices)
          </Typography>
          <Typography variant="body2" component="div">
            Customers: {pipelineResult.customers.created} created, {pipelineResult.customers.updated} updated
            {pipelineResult.customers.truncated ? ' (customer fetch truncated)' : ''}. Item cache:{' '}
            {pipelineResult.item_cache.rows_inserted} row(s), {pipelineResult.item_cache.pages_fetched} MYOB page(s)
            {pipelineResult.item_cache.truncated ? ' (cache rebuild hit page cap)' : ''}.
            {' '}
            Orders/invoices: {(pipelineResult.orders as MyobImportAllResult).imported} imported,{' '}
            {(pipelineResult.orders as MyobImportAllResult).skipped} skipped,{' '}
            {(pipelineResult.orders as MyobImportAllResult).failed} failed (
            {(pipelineResult.orders as MyobImportAllResult).pages_fetched} sale-order list page(s)).
          </Typography>
          {(pipelineResult.orders as MyobImportAllResult).results[0] ? (
            <Button
              size="small"
              component={RouterLink}
              to={`/orders/${encodeURIComponent((pipelineResult.orders as MyobImportAllResult).results[0].order_id)}`}
              variant="outlined"
              sx={{ mt: 1 }}
            >
              Open first imported order
            </Button>
          ) : null}
          <Paper
            variant="outlined"
            sx={{
              mt: 1,
              p: 1,
              maxHeight: 320,
              overflow: 'auto',
              bgcolor: 'action.hover',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 11,
            }}
            component="pre"
          >
            {JSON.stringify(pipelineResult, null, 2)}
          </Paper>
        </Alert>
      ) : null}

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

            {status?.connected && status.business_id ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Full import pipeline
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Runs in order: (1) sync customers from MYOB, (2) rebuild the local item UOM cache (full{' '}
                  <code>Inventory/Item</code> list and income accounts), (3) list all sale orders and import only{' '}
                  <strong>Open</strong> ones, then (4) import all sale invoices. Work runs on a{' '}
                  <strong>background thread</strong> so the API stays responsive; this page polls for phase updates.
                  (Job state is kept in server memory per process — use a single worker or sticky sessions if you scale
                  horizontally.)
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Use the controls below to run this pipeline and optionally skip customer sync or item cache rebuild.
                </Typography>
              </Paper>
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField
                  label="Orders page size ($top)"
                  type="number"
                  size="small"
                  value={importAllTop}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isNaN(n)) return
                    setImportAllTop(Math.min(MYOB_SALE_ORDER_LIST_HARD_CAP, Math.max(1, n)))
                  }}
                  inputProps={{ min: 1, max: MYOB_SALE_ORDER_LIST_HARD_CAP }}
                  sx={{ width: 160 }}
                  helperText={`1–${MYOB_SALE_ORDER_LIST_HARD_CAP} per MYOB request; import walks every page until done. Server default/env: MYOB_SALE_ORDER_LIST_MAX_TOP.`}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={skipCustomers}
                      onChange={(e) => setSkipCustomers(e.target.checked)}
                      disabled={!status?.connected || busy !== null}
                    />
                  }
                  label="Skip customer import"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={skipItemCache}
                      onChange={(e) => setSkipItemCache(e.target.checked)}
                      disabled={!status?.connected || busy !== null}
                    />
                  }
                  label="Skip item cache rebuild"
                />
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => void doImportPipeline()}
                  disabled={!status?.connected || busy !== null}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                >
                  {busy === 'import-pipeline-all' ? 'Running pipeline…' : 'Run main import pipeline'}
                </Button>
              </Stack>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => void doDisconnect()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect MYOB'}
              </Button>
            </Stack>

            {itemUomRebuildResult ? (
              <Alert severity={itemUomRebuildResult.truncated ? 'warning' : 'success'} sx={{ mt: 1 }}>
                Item UOM cache rebuilt: {itemUomRebuildResult.rows_inserted} row(s), {itemUomRebuildResult.pages_fetched}{' '}
                page(s) fetched
                {itemUomRebuildResult.truncated ? ' (stopped at safety page cap — increase cap in code if needed).' : '.'}
              </Alert>
            ) : null}

            {itemUomSummary ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Cached MYOB <code>SellingUnitOfMeasure</code> values ({itemUomSummary.row_count} items)
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    maxHeight: 360,
                    overflow: 'auto',
                    bgcolor: 'action.hover',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                  }}
                  component="pre"
                >
                  {JSON.stringify(itemUomSummary, null, 2)}
                </Paper>
              </Box>
            ) : null}

            <Typography variant="body2" color="text.secondary">
              <strong>Item UOM cache:</strong> stores each MYOB inventory item UID and{' '}
              <code>SellingDetails.SellingUnitOfMeasure</code>. Rebuild pulls the full <code>Inventory/Item</code> list
              (paged). Sale order import reads this table first so it does not GET every line&apos;s item again; items
              missing from the cache are fetched once and then stored.
            </Typography>

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

            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              <strong>Arbitrary GET:</strong> paste a full <code>https://api.myob.com/accountright/&#123;your company
              file&#125;/…</code> (or regional <code>*.api.myob.com</code>) URL that your OAuth token can read — for
              example an <code>Inventory/Item/&#123;uid&#125;</code> link from a sale line. The server validates the host
              and that the path matches the configured company file, then returns JSON for mapping fields (e.g. UOM).
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
              <TextField
                label="MYOB GET URL (full https)"
                value={arbitraryGetUrl}
                onChange={(e) => setArbitraryGetUrl(e.target.value)}
                size="small"
                fullWidth
                placeholder="https://api.myob.com/accountright/…/Inventory/Item/…"
              />
              <Button
                variant="contained"
                color="secondary"
                onClick={() => void doArbitraryGetJson()}
                disabled={!status?.connected || busy !== null}
                sx={{ flexShrink: 0 }}
              >
                {busy === 'arbitrary-get' ? 'GET…' : 'Run GET'}
              </Button>
            </Stack>

            {arbitraryGetResult ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  GET JSON (read-only)
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  {arbitraryGetResult.request_url}
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    maxHeight: 560,
                    overflow: 'auto',
                    bgcolor: 'action.hover',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                  }}
                  component="pre"
                >
                  {JSON.stringify(arbitraryGetResult.myob, null, 2)}
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

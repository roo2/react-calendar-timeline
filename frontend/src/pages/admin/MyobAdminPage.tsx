import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material'
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

type MyobSaleOrdersListPreview = {
  business_id: string
  request_url: string
  top: number
  skip: number
  item_count: number
  next_page_link: unknown
  myob: unknown
}

/** Same response envelope as {@link MyobSaleOrdersListPreview} (MYOB list-preview endpoints). */
type MyobSaleInvoiceItemsListPreview = MyobSaleOrdersListPreview

type MyobSaleOrderFetchResult = {
  request_url: string
  resolved_by: string
  myob: unknown
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
type MyobImportJobStatus = {
  job_id: string
  status: 'running' | 'completed' | 'failed'
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
  const [preview, setPreview] = useState<MyobCustomersPreview | null>(null)
  const [syncResult, setSyncResult] = useState<MyobSyncResult | null>(null)
  const [companyFileId, setCompanyFileId] = useState('')
  const [saleOrdersTop, setSaleOrdersTop] = useState(20)
  const [saleOrdersSkip, setSaleOrdersSkip] = useState(0)
  const [saleOrderUri, setSaleOrderUri] = useState('')
  const [saleOrderUid, setSaleOrderUid] = useState('')
  const [saleOrdersPreview, setSaleOrdersPreview] = useState<MyobSaleOrdersListPreview | null>(null)
  const [saleOrderFetch, setSaleOrderFetch] = useState<MyobSaleOrderFetchResult | null>(null)
  const [invoiceItemsTop, setInvoiceItemsTop] = useState(20)
  const [invoiceItemsSkip, setInvoiceItemsSkip] = useState(0)
  const [invoiceItemsPreview, setInvoiceItemsPreview] = useState<MyobSaleInvoiceItemsListPreview | null>(null)
  const [importOneResult, setImportOneResult] = useState<MyobImportOneResult | null>(null)
  const [importBatchResult, setImportBatchResult] = useState<MyobImportFromListResult | null>(null)
  const [importAllResult, setImportAllResult] = useState<MyobImportAllResult | null>(null)
  const [importAllTop, setImportAllTop] = useState(200)
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
    setSaleOrdersPreview(null)
    setSaleOrderFetch(null)
    setInvoiceItemsPreview(null)
    setImportOneResult(null)
    setImportBatchResult(null)
    setImportAllResult(null)
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

  async function doSyncCustomers() {
    if (
      !window.confirm(
        'Import / update customers from MYOB into Production Software? Existing rows with the same MYOB UID will be updated; new MYOB customers will be created. Brand is set on each sync: a leading “D -” on the individual last name or company name maps to the Dolphin brand (code DOLPHIN); otherwise Crown Pack (CROWN_PACK). Default brand rows are created by the database migration (and ensured at sync if missing). Other app-only fields (priority, delivery preferences, notes) are preserved where the sync does not overwrite them.',
      )
    ) {
      return
    }
    setBusy('sync')
    setErr(null)
    setSyncResult(null)
    try {
      const data = await apiFetch<MyobSyncResult>('/api/myob/customers/sync', { method: 'POST' })
      setSyncResult(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'MYOB customer sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function doSaleOrdersListPreview() {
    setBusy('sale-orders-preview')
    setErr(null)
    setSaleOrdersPreview(null)
    setSaleOrderFetch(null)
    try {
      const data = await apiFetch<MyobSaleOrdersListPreview>('/api/myob/sale/orders/list-preview', {
        method: 'POST',
        body: JSON.stringify({
          top: Number.isFinite(saleOrdersTop) ? saleOrdersTop : 20,
          skip: Number.isFinite(saleOrdersSkip) ? saleOrdersSkip : 0,
        }),
      })
      setSaleOrdersPreview(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list MYOB sale orders')
    } finally {
      setBusy(null)
    }
  }

  async function doSaleOrderFetchJson() {
    const uri = saleOrderUri.trim()
    const uid = saleOrderUid.trim()
    if (!uri && !uid) {
      setErr('Paste an order URI from the list preview, or a 32–40 character order UID (GUID).')
      return
    }
    if (uid && (uid.length < 32 || uid.length > 40)) {
      setErr('Order UID must be 32–40 characters (MYOB GUID, with or without hyphens).')
      return
    }
    setBusy('sale-order-fetch')
    setErr(null)
    setSaleOrderFetch(null)
    try {
      const body: { order_uri?: string; order_uid?: string } = {}
      if (uri) body.order_uri = uri
      else body.order_uid = uid
      const data = await apiFetch<MyobSaleOrderFetchResult>('/api/myob/sale/orders/fetch-json', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setSaleOrderFetch(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to fetch MYOB sale order')
    } finally {
      setBusy(null)
    }
  }

  async function doSaleInvoiceItemsListPreview() {
    setBusy('sale-invoice-items-preview')
    setErr(null)
    setInvoiceItemsPreview(null)
    try {
      const data = await apiFetch<MyobSaleInvoiceItemsListPreview>('/api/myob/sale/invoice/items/list-preview', {
        method: 'POST',
        body: JSON.stringify({
          top: Number.isFinite(invoiceItemsTop) ? invoiceItemsTop : 20,
          skip: Number.isFinite(invoiceItemsSkip) ? invoiceItemsSkip : 0,
        }),
      })
      setInvoiceItemsPreview(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list MYOB Sale/Invoice/Item')
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

  async function doRebuildItemUomCache() {
    if (
      !window.confirm(
        'Rebuild the local MYOB item UOM cache? This deletes all cached rows and re-downloads every Inventory/Item from MYOB (GET-only). Order import then uses the cache and only fetches items not yet cached.',
      )
    ) {
      return
    }
    setBusy('item-uom-rebuild')
    setErr(null)
    setItemUomRebuildResult(null)
    try {
      const data = await apiFetch<MyobItemUomRebuildResult>('/api/myob/item-selling-uoms/rebuild', { method: 'POST' })
      setItemUomRebuildResult(data)
      await doLoadItemUomSummary()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to rebuild item UOM cache')
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

  async function doImportFirstFiftyOrders() {
    if (
      !window.confirm(
        'Import the first 50 MYOB sale orders from the list page (OData $top=50, $skip=0)? ' +
          'Each order is created or updated the same way as a single import. ' +
          'Customers must already be synced from MYOB. Rows that error are reported; others are still saved.',
      )
    ) {
      return
    }
    setBusy('import-batch-50')
    setErr(null)
    setImportBatchResult(null)
    setImportAllResult(null)
    try {
      const data = await apiFetch<MyobImportFromListResult>('/api/myob/orders/import-from-list', {
        method: 'POST',
        body: JSON.stringify({ top: 50, skip: 0 }),
      })
      setImportBatchResult(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'MYOB batch order import failed')
    } finally {
      setBusy(null)
    }
  }

  async function doImportPipeline(mode: 'all' | 'page') {
    const topAll = Number.isFinite(importAllTop) ? Math.min(1000, Math.max(1, importAllTop)) : 200
    const topPage = Number.isFinite(saleOrdersTop) ? Math.min(1000, Math.max(1, saleOrdersTop)) : 50
    const skipPage = Number.isFinite(saleOrdersSkip) ? Math.max(0, saleOrdersSkip) : 0
    const msg =
      mode === 'all'
        ? [
            'Run the full MYOB import pipeline?',
            '',
            '1. Sync customers from MYOB into this app',
            '2. Rebuild the local item UOM cache (full Inventory/Item list + income accounts)',
            `3. Import every sale order (GET …/Sale/Order, $top=${topAll} per list page until empty)`,
            '',
            'This can take many minutes and performs many API calls.',
            'The server runs the work in the background; this page polls for status.',
          ].join('\n')
        : [
            'Run the MYOB import pipeline for one order list page?',
            '',
            '1. Sync customers from MYOB into this app',
            '2. Rebuild the local item UOM cache (full Inventory/Item list + income accounts)',
            `3. Import sale orders from a single list page ($top=${topPage}, $skip=${skipPage})`,
            'The server runs the work in the background; this page polls for status.',
          ].join('\n')
    if (!window.confirm(msg)) return
    if (pipelinePollRef.current !== null) {
      window.clearInterval(pipelinePollRef.current)
      pipelinePollRef.current = null
    }
    setBusy(mode === 'all' ? 'import-pipeline-all' : 'import-pipeline-page')
    setErr(null)
    setPipelineResult(null)
    setPipelineJob(null)
    setSyncResult(null)
    setItemUomRebuildResult(null)
    setImportBatchResult(null)
    setImportAllResult(null)
    const body =
      mode === 'all'
        ? { orders: 'all' as const, orders_top: topAll, orders_skip: 0 }
        : { orders: 'page' as const, orders_top: topPage, orders_skip: skipPage }
    try {
      const start = await apiFetch<MyobPipelineStartResponse>('/api/myob/import/pipeline/start', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const jobId = start.job_id

      const finish = () => {
        if (pipelinePollRef.current !== null) {
          window.clearInterval(pipelinePollRef.current)
          pipelinePollRef.current = null
        }
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
          } else if (st.status === 'failed') {
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
        setErr(
          `${msg}${rj != null ? ` ${typeof rj === 'string' ? rj : JSON.stringify(rj)}` : ''}`,
        )
      } else {
        setErr(e instanceof Error ? e.message : 'MYOB import pipeline failed to start')
      }
    }
  }

  async function doImportAllSaleOrders() {
    if (
      !window.confirm(
        'Import every MYOB sale order? The server will page through GET …/Sale/Order (OData) until there are no more rows, importing each order the same way as a single import. Customers must already be synced from MYOB. This can take many minutes and perform a large number of API calls. Continue?',
      )
    ) {
      return
    }
    setBusy('import-all-orders')
    setErr(null)
    setImportAllResult(null)
    setImportBatchResult(null)
    try {
      const top = Number.isFinite(importAllTop) ? Math.min(1000, Math.max(1, importAllTop)) : 200
      const data = await apiFetch<MyobImportAllResult>('/api/myob/orders/import-all', {
        method: 'POST',
        body: JSON.stringify({ top }),
      })
      setImportAllResult(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'MYOB import all orders failed')
    } finally {
      setBusy(null)
    }
  }

  async function doImportOneOrder() {
    const uri = saleOrderUri.trim()
    const uid = saleOrderUid.trim()
    if (!uri && !uid) {
      setErr('Paste an order URI from the list preview, or a 32–40 character order UID, then import.')
      return
    }
    if (uid && (uid.length < 32 || uid.length > 40)) {
      setErr('Order UID must be 32–40 characters (MYOB GUID, with or without hyphens).')
      return
    }
    if (
      !window.confirm(
        'Import this MYOB sale order into Production Software? The customer must already be synced from MYOB. Existing order with the same MYOB order UID will be updated.',
      )
    ) {
      return
    }
    setBusy('import-one-order')
    setErr(null)
    setImportOneResult(null)
    setImportAllResult(null)
    try {
      const body: { order_uri?: string; order_uid?: string } = {}
      if (uri) body.order_uri = uri
      else body.order_uid = uid
      const data = await apiFetch<MyobImportOneResult>('/api/myob/orders/import-one', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setImportOneResult(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'MYOB order import failed')
    } finally {
      setBusy(null)
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
      {importOneResult ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Order imported. MYOB UID {importOneResult.myob_order_uid} — {importOneResult.lines_synced} line(s) synced. Job
          sheet placeholders: {importOneResult.myob_all_job_sheets_entered ? 'all linked' : 'pending'}.{' '}
          <Button
            size="small"
            component={RouterLink}
            to={`/orders/${encodeURIComponent(importOneResult.order_id)}`}
            sx={{ ml: 1 }}
            variant="outlined"
          >
            Open order
          </Button>
        </Alert>
      ) : null}
      {importBatchResult ? (
        <Alert
          severity={importBatchResult.failed > 0 || !importBatchResult.ok ? 'warning' : 'success'}
          sx={{ mb: 2 }}
        >
          Batch import: {importBatchResult.imported} imported, {importBatchResult.failed} failed of{' '}
          {importBatchResult.list_item_count} list row(s) ($top={importBatchResult.top}, $skip={importBatchResult.skip}).
          {importBatchResult.results[0] ? (
            <>
              {' '}
              <Button
                size="small"
                component={RouterLink}
                to={`/orders/${encodeURIComponent(importBatchResult.results[0].order_id)}`}
                variant="outlined"
                sx={{ ml: 1 }}
              >
                Open first imported order
              </Button>
            </>
          ) : null}
          {importBatchResult.errors.length > 0 ? (
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1,
                maxHeight: 200,
                overflow: 'auto',
                bgcolor: 'action.hover',
                fontSize: 12,
                borderRadius: 0.5,
              }}
            >
              {JSON.stringify(importBatchResult.errors, null, 2)}
            </Box>
          ) : null}
        </Alert>
      ) : null}
      {importAllResult ? (
        <Alert
          severity={
            importAllResult.truncated || importAllResult.failed > 0 || !importAllResult.ok ? 'warning' : 'success'
          }
          sx={{ mb: 2 }}
        >
          Import all: {importAllResult.imported} imported, {importAllResult.skipped} skipped, {importAllResult.failed}{' '}
          failed — {importAllResult.pages_fetched} MYOB list page(s), $top={importAllResult.top}.
          {importAllResult.truncated ? (
            <Typography component="span" variant="body2" display="block" sx={{ mt: 0.5 }}>
              Stopped at the server&apos;s maximum page count; run again or raise the cap in code if more orders remain.
            </Typography>
          ) : null}
          {importAllResult.results[0] ? (
            <>
              {' '}
              <Button
                size="small"
                component={RouterLink}
                to={`/orders/${encodeURIComponent(importAllResult.results[0].order_id)}`}
                variant="outlined"
                sx={{ ml: 1 }}
              >
                Open first imported order
              </Button>
            </>
          ) : null}
          {importAllResult.errors.length > 0 ? (
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1,
                maxHeight: 200,
                overflow: 'auto',
                bgcolor: 'action.hover',
                fontSize: 12,
                borderRadius: 0.5,
              }}
            >
              {JSON.stringify(importAllResult.errors, null, 2)}
            </Box>
          ) : null}
        </Alert>
      ) : null}
      {pipelineResult ? (
        <Alert
          severity={(() => {
            if (!pipelineResult.ok) return 'warning'
            if (!pipelineResult.customers.ok || pipelineResult.customers.errors.length > 0) return 'warning'
            if (pipelineResult.item_cache.truncated) return 'warning'
            if (pipelineResult.orders_mode === 'all') {
              const o = pipelineResult.orders as MyobImportAllResult
              if (o.truncated || o.failed > 0) return 'warning'
            } else {
              const o = pipelineResult.orders as MyobImportFromListResult
              if (!o.ok || o.failed > 0) return 'warning'
            }
            return 'success'
          })()}
          sx={{ mb: 2 }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Import pipeline finished ({pipelineResult.orders_mode === 'all' ? 'all orders' : 'one list page'})
          </Typography>
          <Typography variant="body2" component="div">
            Customers: {pipelineResult.customers.created} created, {pipelineResult.customers.updated} updated
            {pipelineResult.customers.truncated ? ' (customer fetch truncated)' : ''}. Item cache:{' '}
            {pipelineResult.item_cache.rows_inserted} row(s), {pipelineResult.item_cache.pages_fetched} MYOB page(s)
            {pipelineResult.item_cache.truncated ? ' (cache rebuild hit page cap)' : ''}.
            {pipelineResult.orders_mode === 'all' ? (
              <>
                {' '}
                Orders: {(pipelineResult.orders as MyobImportAllResult).imported} imported,{' '}
                {(pipelineResult.orders as MyobImportAllResult).skipped} skipped,{' '}
                {(pipelineResult.orders as MyobImportAllResult).failed} failed (
                {(pipelineResult.orders as MyobImportAllResult).pages_fetched} list page(s)).
              </>
            ) : (
              <>
                {' '}
                Orders: {(pipelineResult.orders as MyobImportFromListResult).imported} imported,{' '}
                {(pipelineResult.orders as MyobImportFromListResult).failed} failed of{' '}
                {(pipelineResult.orders as MyobImportFromListResult).list_item_count} list row(s).
              </>
            )}
          </Typography>
          {pipelineResult.orders_mode === 'all' &&
          (pipelineResult.orders as MyobImportAllResult).results[0] ? (
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
          {pipelineResult.orders_mode === 'page' &&
          (pipelineResult.orders as MyobImportFromListResult).results[0] ? (
            <Button
              size="small"
              component={RouterLink}
              to={`/orders/${encodeURIComponent((pipelineResult.orders as MyobImportFromListResult).results[0].order_id)}`}
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
                  <code>Inventory/Item</code> list and income accounts), (3) import sale orders. Work runs on a{' '}
                  <strong>background thread</strong> so the API stays responsive; this page polls for phase updates.
                  (Job state is kept in server memory per process — use a single worker or sticky sessions if you scale
                  horizontally.)
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => void doImportPipeline('all')}
                    disabled={busy !== null}
                  >
                    {busy === 'import-pipeline-all'
                      ? 'Running pipeline (all orders)…'
                      : 'Pipeline: customers → items → ALL sale orders'}
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => void doImportPipeline('page')}
                    disabled={busy !== null}
                  >
                    {busy === 'import-pipeline-page'
                      ? 'Running pipeline (one page)…'
                      : 'Pipeline: customers → items → one order list page'}
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  &quot;ALL sale orders&quot; uses the <strong>Import-all $top</strong> field further down. &quot;One
                  list page&quot; uses <strong>Orders $top</strong> and <strong>Orders $skip</strong>.
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
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => void doPreviewCustomers()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'preview' ? 'Fetching customers…' : 'Test: fetch customers from MYOB (read-only)'}
              </Button>
              <Button
                variant="contained"
                color="secondary"
                onClick={() => void doSyncCustomers()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'sync' ? 'Syncing customers…' : 'Import / sync customers from MYOB'}
              </Button>
              <Button
                variant="outlined"
                color="info"
                onClick={() => void doSaleInvoiceItemsListPreview()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'sale-invoice-items-preview'
                  ? 'Listing item invoices…'
                  : 'Test: list Sale/Invoice/Item (subset)'}
              </Button>
              <Button
                variant="outlined"
                color="info"
                onClick={() => void doSaleOrdersListPreview()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'sale-orders-preview' ? 'Listing orders…' : 'Test: list sale orders (subset)'}
              </Button>
              <Button
                variant="outlined"
                color="info"
                onClick={() => void doSaleOrderFetchJson()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'sale-order-fetch' ? 'Fetching order…' : 'Test: fetch one sale order as JSON'}
              </Button>
              <Button
                variant="contained"
                color="success"
                onClick={() => void doImportOneOrder()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'import-one-order' ? 'Importing order…' : 'Import one order to Production'}
              </Button>
              <Button
                variant="contained"
                color="success"
                onClick={() => void doImportFirstFiftyOrders()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'import-batch-50' ? 'Importing orders…' : 'Import first 50 sale orders'}
              </Button>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField
                  label="Import-all $top"
                  type="number"
                  size="small"
                  value={importAllTop}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isNaN(n)) return
                    setImportAllTop(Math.min(1000, Math.max(1, n)))
                  }}
                  inputProps={{ min: 1, max: 1000 }}
                  sx={{ width: 140 }}
                  helperText="1–1000 per list page"
                />
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => void doImportAllSaleOrders()}
                  disabled={!status?.connected || busy !== null}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                >
                  {busy === 'import-all-orders' ? 'Importing all orders…' : 'Import all sale orders from MYOB'}
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
              <Button
                variant="outlined"
                onClick={() => void doLoadItemUomSummary()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'item-uom-summary' ? 'Loading…' : 'Load item UOM summary'}
              </Button>
              <Button
                variant="contained"
                color="warning"
                onClick={() => void doRebuildItemUomCache()}
                disabled={!status?.connected || busy !== null}
              >
                {busy === 'item-uom-rebuild' ? 'Rebuilding…' : 'Rebuild item UOM cache from MYOB'}
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

            <Typography variant="body2" color="text.secondary">
              <strong>Test: fetch customers</strong> runs GET-only requests to MYOB&apos;s API (no changes to your MYOB
              file). If MYOB returns 401, reconnect OAuth, confirm <code>MYOB_APP_KEY</code> / scopes, and that the
              company file id is correct.
            </Typography>

            <Typography variant="body2" color="text.secondary">
              <strong>Item sale invoices:</strong> MYOB exposes <code>GET …/Sale/Invoice/Item</code> for item-type
              invoices (lines, customer, inventory links). Use <strong>list Sale/Invoice/Item</strong> with{' '}
              <code>$top</code> / <code>$skip</code> below to page through them; response JSON is shown for inspection
              before a full import.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-end">
              <TextField
                label="Invoice items $top"
                type="number"
                size="small"
                value={invoiceItemsTop}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isNaN(n)) return
                  setInvoiceItemsTop(Math.min(1000, Math.max(1, n)))
                }}
                inputProps={{ min: 1, max: 1000 }}
                sx={{ width: 160 }}
                helperText="1–1000"
              />
              <TextField
                label="Invoice items $skip"
                type="number"
                size="small"
                value={invoiceItemsSkip}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isNaN(n)) return
                  setInvoiceItemsSkip(Math.max(0, n))
                }}
                inputProps={{ min: 0 }}
                sx={{ width: 160 }}
                helperText="Paging offset"
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              <strong>Sale orders:</strong> MYOB exposes <code>GET …/Sale/Order</code> with OData <code>$top</code> /{' '}
              <code>$skip</code> so you can page through thousands of orders. Use <strong>list sale orders</strong> to
              fetch a subset; copy a row&apos;s <code>URI</code> (or <code>UID</code>) into the fields below and click{' '}
              <strong>fetch one sale order</strong>. The <code>sme-sales</code> OAuth scope is required for{' '}
              <code>/Sale/</code> endpoints. If you still see 403, reconnect MYOB after deploys that change OAuth scopes
              in <code>app/config.py</code>.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-end">
              <TextField
                label="Orders $top"
                type="number"
                size="small"
                value={saleOrdersTop}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isNaN(n)) return
                  setSaleOrdersTop(Math.min(1000, Math.max(1, n)))
                }}
                inputProps={{ min: 1, max: 1000 }}
                sx={{ width: 140 }}
                helperText="1–1000"
              />
              <TextField
                label="Orders $skip"
                type="number"
                size="small"
                value={saleOrdersSkip}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isNaN(n)) return
                  setSaleOrdersSkip(Math.max(0, n))
                }}
                inputProps={{ min: 0 }}
                sx={{ width: 140 }}
                helperText="Paging offset"
              />
            </Stack>
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

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
              <TextField
                label="Order URI (from list Items[].URI)"
                value={saleOrderUri}
                onChange={(e) => setSaleOrderUri(e.target.value)}
                size="small"
                fullWidth
                placeholder="https://api.myob.com/accountright/…/Sale/Order/…"
              />
              <TextField
                label="Or order UID (GUID)"
                value={saleOrderUid}
                onChange={(e) => setSaleOrderUid(e.target.value)}
                size="small"
                fullWidth
                sx={{ maxWidth: 400 }}
                placeholder="32–40 chars; server tries Service/Item/… paths"
              />
            </Stack>

            {syncResult ? (
              <>
                <Alert severity={syncResult.ok && syncResult.errors.length === 0 ? 'success' : 'warning'} sx={{ mt: 1 }}>
                  Sync finished: {syncResult.created} created, {syncResult.updated} updated (MYOB rows:{' '}
                  {syncResult.source_count}
                  {syncResult.truncated ? ', truncated fetch' : ''}).
                  {syncResult.errors.length > 0 ? (
                    <Typography component="span" variant="body2" display="block" sx={{ mt: 1, fontFamily: 'monospace' }}>
                      {syncResult.errors.slice(0, 8).join(' · ')}
                      {syncResult.errors.length > 8 ? ` … (+${syncResult.errors.length - 8} more)` : ''}
                    </Typography>
                  ) : null}
                </Alert>
                {syncResult.myob_json != null ? (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      MYOB JSON used for this import (debug)
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
                      {JSON.stringify(syncResult.myob_json, null, 2)}
                    </Paper>
                  </Box>
                ) : null}
              </>
            ) : null}

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

            {invoiceItemsPreview ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  MYOB Sale/Invoice/Item list (subset){' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {invoiceItemsPreview.item_count} rows · skip={invoiceItemsPreview.skip} · top=
                    {invoiceItemsPreview.top}
                    {typeof invoiceItemsPreview.next_page_link === 'string' && invoiceItemsPreview.next_page_link
                      ? ' · has NextPageLink'
                      : ''}
                  </Typography>
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
                  {JSON.stringify(invoiceItemsPreview, null, 2)}
                </Paper>
              </Box>
            ) : null}

            {saleOrdersPreview ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  MYOB sale orders list (subset){' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {saleOrdersPreview.item_count} rows · skip={saleOrdersPreview.skip} · top={saleOrdersPreview.top}
                    {typeof saleOrdersPreview.next_page_link === 'string' && saleOrdersPreview.next_page_link
                      ? ' · has NextPageLink'
                      : ''}
                  </Typography>
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
                  {JSON.stringify(saleOrdersPreview, null, 2)}
                </Paper>
              </Box>
            ) : null}

            {saleOrderFetch ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  One sale order (read-only){' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    resolved by {saleOrderFetch.resolved_by}
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  {saleOrderFetch.request_url}
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
                  {JSON.stringify(saleOrderFetch.myob, null, 2)}
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

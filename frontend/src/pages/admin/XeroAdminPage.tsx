import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
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

function AddressCell(props: { value?: string | null }) {
  const text = String(props.value || '').trim()
  if (!text) return <>—</>
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8125rem' }}>
      {text}
    </Typography>
  )
}

type SyncAddressSummary = {
  address_type: string
  display: string
}

type SyncPhoneSummary = {
  phone_type: string
  display: string
}

function AddressesCell(props: { addresses?: SyncAddressSummary[] | null }) {
  const rows = props.addresses || []
  if (rows.length === 0) return <>—</>
  return (
    <Stack spacing={1}>
      {rows.map((row, index) => (
        <Box key={`${row.address_type}-${index}`}>
          <Typography variant="caption" color="text.secondary" display="block">
            {row.address_type}
          </Typography>
          <AddressCell value={row.display} />
        </Box>
      ))}
    </Stack>
  )
}

function ContactPersonsCell(props: { names?: string[] | null }) {
  const names = (props.names || []).map((n) => String(n || '').trim()).filter(Boolean)
  if (names.length === 0) return <>—</>
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8125rem' }}>
      {names.join('\n')}
    </Typography>
  )
}

type CustomerMatchDetail = {
  id?: string
  contact_id?: string | null
  name?: string | null
  account_code?: string | null
  myob_display_id?: string | null
  abn?: string | null
  tax_number?: string | null
  brand_name?: string | null
  brand_code?: string | null
  branding_theme_id?: string | null
  contact_first_name?: string | null
  contact_last_name?: string | null
  email_address?: string | null
  contact_phone?: string | null
  phones?: SyncPhoneSummary[]
  status?: string | null
  notes?: string | null
  contact_persons?: string[]
  addresses?: SyncAddressSummary[]
  primary_address?: string | null
  xero_contact_id?: string | null
  xero_last_modified?: string | null
  xero_synced_at?: string | null
  orders_count?: number
}

function primaryContactLabel(row: CustomerMatchDetail | null | undefined): string {
  if (!row) return '—'
  const first = String(row.contact_first_name || '').trim()
  const last = String(row.contact_last_name || '').trim()
  const name = [first, last].filter(Boolean).join(' ')
  return name || '—'
}

function brandLabel(row: CustomerMatchDetail | null | undefined): string {
  if (!row) return '—'
  const name = String(row.brand_name || '').trim()
  const code = String(row.brand_code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code || '—'
}

function PhonesCell(props: { phones?: SyncPhoneSummary[] | null; fallback?: string | null }) {
  const rows = props.phones || []
  if (rows.length > 0) {
    return (
      <Stack spacing={1}>
        {rows.map((row, index) => (
          <Box key={`${row.phone_type}-${index}`}>
            <Typography variant="caption" color="text.secondary" display="block">
              {row.phone_type}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
              {row.display}
            </Typography>
          </Box>
        ))}
      </Stack>
    )
  }
  const text = String(props.fallback || '').trim()
  if (!text) return <>—</>
  return (
    <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
      {text}
    </Typography>
  )
}

function MatchDetailCard(props: { title: string; row: CustomerMatchDetail | null | undefined }) {
  const row = props.row
  if (!row) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper', height: '100%' }}>
        <Typography variant="caption" color="text.secondary">
          {props.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          —
        </Typography>
      </Paper>
    )
  }
  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper', height: '100%' }}>
      <Typography variant="caption" color="text.secondary">
        {props.title}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
        {row.name || '—'}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Typography variant="body2">
          <strong>Brand:</strong> {brandLabel(row)}
        </Typography>
        <Typography variant="body2">
          <strong>Primary contact:</strong> {primaryContactLabel(row)}
        </Typography>
        <Typography variant="body2">
          <strong>Email:</strong> {row.email_address?.trim() || '—'}
        </Typography>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Phone numbers
          </Typography>
          <PhonesCell phones={row.phones} fallback={row.contact_phone} />
        </Box>
        <Typography variant="body2">
          <strong>ABN:</strong> {(row.abn || row.tax_number || '').trim() || '—'}
        </Typography>
        {row.account_code ? (
          <Typography variant="body2">
            <strong>Account code:</strong> {row.account_code}
          </Typography>
        ) : null}
        {row.myob_display_id ? (
          <Typography variant="body2">
            <strong>MYOB display:</strong> {row.myob_display_id}
          </Typography>
        ) : null}
        {row.status ? (
          <Typography variant="body2">
            <strong>Status:</strong> {row.status}
          </Typography>
        ) : null}
        {typeof row.orders_count === 'number' ? (
          <Typography variant="body2">
            <strong>Orders:</strong> {row.orders_count}
          </Typography>
        ) : null}
        {row.xero_last_modified ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Xero modified: {row.xero_last_modified}
          </Typography>
        ) : null}
        {row.xero_synced_at ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Last synced from Xero: {row.xero_synced_at}
          </Typography>
        ) : null}
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Additional contacts
          </Typography>
          <ContactPersonsCell names={row.contact_persons} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Addresses
          </Typography>
          {row.addresses && row.addresses.length > 0 ? (
            <AddressesCell addresses={row.addresses} />
          ) : (
            <AddressCell value={row.primary_address} />
          )}
        </Box>
        {row.notes ? (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              Notes (app only)
            </Typography>
            <AddressCell value={row.notes} />
          </Box>
        ) : null}
      </Stack>
    </Paper>
  )
}

function MatchComparePanel(props: {
  loading: boolean
  app: CustomerMatchDetail | null
  xero: CustomerMatchDetail | null
}) {
  if (props.loading) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Loading comparison…
      </Typography>
    )
  }
  if (!props.app && !props.xero) return null
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2,
        mb: 2,
      }}
    >
      <MatchDetailCard title="App customer" row={props.app} />
      <MatchDetailCard title="Xero contact" row={props.xero} />
    </Box>
  )
}

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

type XeroUnmatchedContact = CustomerMatchDetail & {
  tax_number?: string | null
  primary_address?: string | null
  reason?: string | null
}

type XeroAppCustomerLinkCandidate = CustomerMatchDetail & {
  id: string
  orders_count: number
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
  unmatched_xero: XeroUnmatchedContact[]
  conflicts: Array<Record<string, unknown>>
}

type XeroUnlinkedCustomerRow = CustomerMatchDetail & {
  id: string
  name: string
  myob_display_id?: string | null
  myob_customer_uid?: string | null
  orders_count: number
  quotes_count: number
  products_count: number
  job_sheets_count?: number
  plates_count?: number
}

type XeroCreateContactResult = {
  ok: boolean
  created: boolean
  customer_id: string
  contact_id: string
  customer_name?: string
  xero_name?: string
  xero_account_code?: string | null
  contacts_count?: number
  addresses_count?: number
}

type XeroUnlinkedCustomerReview = {
  total: number
  with_orders_count: number
  without_orders_count: number
  items: XeroUnlinkedCustomerRow[]
}

type XeroDeletableCustomerRow = XeroUnlinkedCustomerRow & {
  blocked_reason?: string
}

type XeroDeletableCustomersPreview = {
  total_unlinked: number
  deletable_count: number
  blocked_count: number
  deletable: XeroDeletableCustomerRow[]
  blocked: XeroDeletableCustomerRow[]
}

type XeroManualLinkResult = {
  ok: boolean
  already_linked?: boolean
  customer_id: string
  contact_id: string
  customer_name?: string
  xero_name?: string
  xero_account_code?: string | null
}

type XeroLinkedCustomerSyncCandidate = CustomerMatchDetail & {
  id: string
  xero_contact_id: string
  orders_count: number
}

type XeroSyncFromXeroResult = {
  ok: boolean
  customer_id: string
  contact_id: string
  customer_name?: string
  xero_name?: string
  xero_account_code?: string | null
  brand_code?: string | null
  contacts_count: number
  addresses_count: number
  updated_fields: string[]
}

type XeroSyncToXeroResult = {
  ok: boolean
  direction?: string
  customer_id: string
  contact_id: string
  customer_name?: string
  xero_name?: string
  xero_account_code?: string | null
  contacts_count: number
  addresses_count: number
  sent_fields: string[]
  xero_last_modified?: string | null
}

type XeroMergeCustomerResult = {
  ok: boolean
  direction?: string
  customer_id: string
  contact_id: string
  customer_name?: string
  xero_name?: string
  xero_account_code?: string | null
  brand_code?: string | null
  contacts_count: number
  addresses_count: number
  phones_count: number
  merged_fields: string[]
  field_sources: Record<string, string>
  xero_last_modified?: string | null
}

type XeroMergeAllPreview = {
  total: number
  items: Array<{
    customer_id: string
    customer_name: string
    contact_id: string
  }>
}

type XeroMergeAllResult = {
  merged_count: number
  error_count: number
  errors: Array<{
    customer_id: string
    customer_name: string
    message: string
  }>
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
  const [apiEndpoint, setApiEndpoint] = useState('/Contacts?page=1')
  const [apiResult, setApiResult] = useState<unknown>(null)
  const [linkPreview, setLinkPreview] = useState<XeroCustomerLinkPreview | null>(null)
  const [unlinkedReview, setUnlinkedReview] = useState<XeroUnlinkedCustomerReview | null>(null)
  const [unlinkedWithOrdersOnly, setUnlinkedWithOrdersOnly] = useState(true)
  const [selectedUnlinkedCustomerId, setSelectedUnlinkedCustomerId] = useState<string | null>(null)
  const [createContactResult, setCreateContactResult] = useState<XeroCreateContactResult | null>(null)
  const [selectedUnmatchedContactId, setSelectedUnmatchedContactId] = useState<string | null>(null)
  const [appCustomerSearch, setAppCustomerSearch] = useState('')
  const [appCustomerResults, setAppCustomerResults] = useState<XeroAppCustomerLinkCandidate[]>([])
  const [appCustomerSearchLoading, setAppCustomerSearchLoading] = useState(false)
  const [selectedAppCustomerId, setSelectedAppCustomerId] = useState<string | null>(null)
  const [manualLinkResult, setManualLinkResult] = useState<XeroManualLinkResult | null>(null)
  const [deletablePreview, setDeletablePreview] = useState<XeroDeletableCustomersPreview | null>(null)
  const [syncCustomerSearch, setSyncCustomerSearch] = useState('')
  const [syncCustomerResults, setSyncCustomerResults] = useState<XeroLinkedCustomerSyncCandidate[]>([])
  const [syncCustomerSearchLoading, setSyncCustomerSearchLoading] = useState(false)
  const [selectedSyncCustomerId, setSelectedSyncCustomerId] = useState<string | null>(null)
  const [syncFromXeroResult, setSyncFromXeroResult] = useState<XeroSyncFromXeroResult | null>(null)
  const [syncToXeroResult, setSyncToXeroResult] = useState<XeroSyncToXeroResult | null>(null)
  const [syncMergeResult, setSyncMergeResult] = useState<XeroMergeCustomerResult | null>(null)
  const [mergeAllProgress, setMergeAllProgress] = useState<{
    total: number
    completed: number
    currentName: string | null
  } | null>(null)
  const [mergeAllResult, setMergeAllResult] = useState<XeroMergeAllResult | null>(null)
  const [syncMatchCompareLoading, setSyncMatchCompareLoading] = useState(false)
  const [syncMatchCompare, setSyncMatchCompare] = useState<{
    app: CustomerMatchDetail | null
    xero: CustomerMatchDetail | null
  } | null>(null)
  const [matchCompareLoading, setMatchCompareLoading] = useState(false)
  const [matchCompare, setMatchCompare] = useState<{
    app: CustomerMatchDetail | null
    xero: CustomerMatchDetail | null
  } | null>(null)
  const [linkedForSyncId, setLinkedForSyncId] = useState<string | null>(null)
  const [linkSyncFromResult, setLinkSyncFromResult] = useState<XeroSyncFromXeroResult | null>(null)
  const [linkSyncToResult, setLinkSyncToResult] = useState<XeroSyncToXeroResult | null>(null)

  const selectedUnmatchedContact = useMemo(() => {
    if (!selectedUnmatchedContactId || !linkPreview) return null
    return (
      linkPreview.unmatched_xero.find(
        (row) => String(row.contact_id || '').trim() === selectedUnmatchedContactId,
      ) || null
    )
  }, [linkPreview, selectedUnmatchedContactId])

  const selectedAppCustomer = useMemo(
    () => appCustomerResults.find((row) => row.id === selectedAppCustomerId) || null,
    [appCustomerResults, selectedAppCustomerId],
  )

  const selectedSyncCustomer = useMemo(
    () => syncCustomerResults.find((row) => row.id === selectedSyncCustomerId) || null,
    [syncCustomerResults, selectedSyncCustomerId],
  )

  const sortedSyncCustomerResults = useMemo(
    () =>
      [...syncCustomerResults].sort(
        (a, b) =>
          b.orders_count - a.orders_count ||
          String(a.name ?? '').localeCompare(String(b.name ?? '')),
      ),
    [syncCustomerResults],
  )

  const sortedAppCustomerResults = useMemo(
    () =>
      [...appCustomerResults].sort(
        (a, b) =>
          b.orders_count - a.orders_count ||
          String(a.name ?? '').localeCompare(String(b.name ?? '')),
      ),
    [appCustomerResults],
  )

  const sortedUnlinkedAppCustomers = useMemo(() => {
    const rows = unlinkedReview?.items || []
    const filtered = unlinkedWithOrdersOnly
      ? rows.filter((row) => row.orders_count > 0)
      : rows
    return [...filtered].sort(
      (a, b) =>
        b.orders_count - a.orders_count ||
        b.quotes_count - a.quotes_count ||
        a.name.localeCompare(b.name),
    )
  }, [unlinkedReview?.items, unlinkedWithOrdersOnly])

  const selectedUnlinkedCustomer = useMemo(
    () => sortedUnlinkedAppCustomers.find((row) => row.id === selectedUnlinkedCustomerId) || null,
    [sortedUnlinkedAppCustomers, selectedUnlinkedCustomerId],
  )

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

  useEffect(() => {
    if (!selectedUnmatchedContactId) {
      setAppCustomerResults([])
      setSelectedAppCustomerId(null)
      return
    }
    const delayMs = appCustomerSearch.trim() ? 300 : 0
    const t = window.setTimeout(() => {
      setAppCustomerSearchLoading(true)
      const qs = new URLSearchParams()
      if (appCustomerSearch.trim()) qs.set('q', appCustomerSearch.trim())
      qs.set('limit', '50')
      void apiFetch<{ items: XeroAppCustomerLinkCandidate[] }>(
        `/api/xero/customers/search-for-link?${qs.toString()}`,
      )
        .then((res) => setAppCustomerResults(res.items || []))
        .catch(() => setAppCustomerResults([]))
        .finally(() => setAppCustomerSearchLoading(false))
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [selectedUnmatchedContactId, appCustomerSearch])

  useEffect(() => {
    const delayMs = syncCustomerSearch.trim() ? 300 : 0
    const t = window.setTimeout(() => {
      setSyncCustomerSearchLoading(true)
      const qs = new URLSearchParams()
      if (syncCustomerSearch.trim()) qs.set('q', syncCustomerSearch.trim())
      qs.set('limit', '50')
      void apiFetch<{ items: XeroLinkedCustomerSyncCandidate[] }>(
        `/api/xero/customers/search-for-sync?${qs.toString()}`,
      )
        .then((res) => setSyncCustomerResults(res.items || []))
        .catch(() => setSyncCustomerResults([]))
        .finally(() => setSyncCustomerSearchLoading(false))
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [syncCustomerSearch])

  async function loadSyncMatchCompare(customerId: string) {
    const compare = await apiFetch<{ app: CustomerMatchDetail; xero: CustomerMatchDetail | null }>(
      `/api/xero/customers/match-compare?customer_id=${encodeURIComponent(customerId)}`,
    )
    setSyncMatchCompare({ app: compare.app, xero: compare.xero })
    return compare
  }

  useEffect(() => {
    const customerId = selectedSyncCustomerId?.trim() || ''
    if (!customerId) {
      setSyncMatchCompare(null)
      return
    }
    setSyncMatchCompareLoading(true)
    void loadSyncMatchCompare(customerId)
      .catch(() => setSyncMatchCompare(null))
      .finally(() => setSyncMatchCompareLoading(false))
  }, [selectedSyncCustomerId])

  const compareCustomerId = linkedForSyncId || selectedAppCustomerId
  const compareContactId = selectedUnmatchedContactId

  useEffect(() => {
    const customerId = compareCustomerId?.trim() || ''
    const contactId = compareContactId?.trim() || ''
    if (!customerId) {
      setMatchCompare(null)
      return
    }
    const qs = new URLSearchParams({ customer_id: customerId })
    if (contactId) qs.set('contact_id', contactId)
    setMatchCompareLoading(true)
    void apiFetch<{ app: CustomerMatchDetail; xero: CustomerMatchDetail | null }>(
      `/api/xero/customers/match-compare?${qs.toString()}`,
    )
      .then((res) => setMatchCompare({ app: res.app, xero: res.xero }))
      .catch(() => setMatchCompare(null))
      .finally(() => setMatchCompareLoading(false))
  }, [compareCustomerId, compareContactId, linkedForSyncId])

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
    setSelectedUnmatchedContactId(null)
    setSelectedAppCustomerId(null)
    setAppCustomerSearch('')
    setAppCustomerResults([])
    setManualLinkResult(null)
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

  async function doSyncCustomerToXero() {
    const customerId = selectedSyncCustomerId?.trim() || ''
    if (!customerId) {
      setErr('Select a linked app customer to sync to Xero.')
      return
    }
    setBusy('xero-sync-to')
    setErr(null)
    setSyncFromXeroResult(null)
    setSyncToXeroResult(null)
    setSyncMergeResult(null)
    try {
      const out = await apiFetch<XeroSyncToXeroResult>('/api/xero/customers/sync-to-xero', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setSyncToXeroResult(out)
      await loadSyncMatchCompare(customerId)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Sync to Xero failed')
    } finally {
      setBusy(null)
    }
  }

  async function doSyncCustomerFromXero() {
    const customerId = selectedSyncCustomerId?.trim() || ''
    if (!customerId) {
      setErr('Select a linked app customer to sync from Xero.')
      return
    }
    setBusy('xero-sync-from')
    setErr(null)
    setSyncFromXeroResult(null)
    setSyncToXeroResult(null)
    setSyncMergeResult(null)
    try {
      const out = await apiFetch<XeroSyncFromXeroResult>('/api/xero/customers/sync-from-xero', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setSyncFromXeroResult(out)
      setSyncCustomerResults((prev) =>
        prev.map((row) =>
          row.id === customerId
            ? {
                ...row,
                name: out.customer_name || row.name,
              }
            : row,
        ),
      )
      await loadSyncMatchCompare(customerId)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Sync from Xero failed')
    } finally {
      setBusy(null)
    }
  }

  async function doLinkSyncFromXero() {
    const customerId = linkedForSyncId?.trim() || ''
    if (!customerId) return
    setBusy('xero-link-sync-from')
    setErr(null)
    setLinkSyncFromResult(null)
    try {
      const out = await apiFetch<XeroSyncFromXeroResult>('/api/xero/customers/sync-from-xero', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setLinkSyncFromResult(out)
      const compare = await apiFetch<{ app: CustomerMatchDetail; xero: CustomerMatchDetail | null }>(
        `/api/xero/customers/match-compare?customer_id=${encodeURIComponent(customerId)}`,
      )
      setMatchCompare({ app: compare.app, xero: compare.xero })
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Sync from Xero failed')
    } finally {
      setBusy(null)
    }
  }

  async function doLinkSyncToXero() {
    const customerId = linkedForSyncId?.trim() || ''
    if (!customerId) return
    setBusy('xero-link-sync-to')
    setErr(null)
    setLinkSyncToResult(null)
    try {
      const out = await apiFetch<XeroSyncToXeroResult>('/api/xero/customers/sync-to-xero', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setLinkSyncToResult(out)
      const compare = await apiFetch<{ app: CustomerMatchDetail; xero: CustomerMatchDetail | null }>(
        `/api/xero/customers/match-compare?customer_id=${encodeURIComponent(customerId)}`,
      )
      setMatchCompare({ app: compare.app, xero: compare.xero })
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Sync to Xero failed')
    } finally {
      setBusy(null)
    }
  }

  async function doMergeCustomerWithXero() {
    const customerId = selectedSyncCustomerId?.trim() || ''
    if (!customerId) {
      setErr('Select a linked app customer to merge with Xero.')
      return
    }
    setBusy('xero-merge')
    setErr(null)
    setSyncFromXeroResult(null)
    setSyncToXeroResult(null)
    setSyncMergeResult(null)
    try {
      const out = await apiFetch<XeroMergeCustomerResult>('/api/xero/customers/merge', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setSyncMergeResult(out)
      setSyncCustomerResults((prev) =>
        prev.map((row) =>
          row.id === customerId
            ? {
                ...row,
                name: out.customer_name || row.name,
              }
            : row,
        ),
      )
      await loadSyncMatchCompare(customerId)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Merge with Xero failed')
    } finally {
      setBusy(null)
    }
  }

  async function doMergeAllLinkedCustomers() {
    setErr(null)
    setMergeAllResult(null)
    setMergeAllProgress(null)
    setBusy('xero-merge-all-preview')
    try {
      const preview = await apiFetch<XeroMergeAllPreview>('/api/xero/customers/merge-all/preview')
      if (preview.total <= 0) {
        setErr('No linked customers to merge.')
        return
      }
      const msg =
        `Merge app + Xero for all ${preview.total} linked customer${preview.total === 1 ? '' : 's'}? ` +
        'Each customer is updated in the app and pushed to Xero. This may take several minutes.'
      if (!window.confirm(msg)) return

      setBusy('xero-merge-all')
      const errors: XeroMergeAllResult['errors'] = []
      let mergedCount = 0

      for (let index = 0; index < preview.items.length; index += 1) {
        const row = preview.items[index]
        setMergeAllProgress({
          total: preview.total,
          completed: index + 1,
          currentName: row.customer_name,
        })
        try {
          await apiFetch<XeroMergeCustomerResult>('/api/xero/customers/merge', {
            method: 'POST',
            body: JSON.stringify({ customer_id: row.customer_id }),
          })
          mergedCount += 1
        } catch (e) {
          errors.push({
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            message:
              e instanceof ApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : 'Merge failed',
          })
        }
      }

      setMergeAllResult({
        merged_count: mergedCount,
        error_count: errors.length,
        errors,
      })
      if (selectedSyncCustomerId) {
        await loadSyncMatchCompare(selectedSyncCustomerId)
      }
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Bulk merge failed')
    } finally {
      setBusy(null)
      setMergeAllProgress(null)
    }
  }

  async function doLoadUnlinkedCustomers() {
    setBusy('xero-unlinked')
    setErr(null)
    setSelectedUnlinkedCustomerId(null)
    setCreateContactResult(null)
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

  async function doCreateXeroContact() {
    const customerId = selectedUnlinkedCustomerId?.trim() || ''
    if (!customerId) return
    setBusy('xero-create-contact')
    setErr(null)
    setCreateContactResult(null)
    try {
      const out = await apiFetch<XeroCreateContactResult>('/api/xero/customers/create-contact', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      })
      setCreateContactResult(out)
      setSelectedUnlinkedCustomerId(null)
      const refreshed = await apiFetch<XeroUnlinkedCustomerReview>('/api/xero/customers/unlinked')
      setUnlinkedReview(refreshed)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Failed to create Xero contact')
    } finally {
      setBusy(null)
    }
  }

  async function doManualLinkCustomer() {
    const customerId = selectedAppCustomerId?.trim() || ''
    const contactId = selectedUnmatchedContactId?.trim() || ''
    if (!customerId || !contactId) {
      setErr('Select an unmatched Xero contact and an app customer to link.')
      return
    }
    setBusy('xero-manual-link')
    setErr(null)
    setManualLinkResult(null)
    try {
      const out = await apiFetch<XeroManualLinkResult>('/api/xero/customers/manual-link', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId, contact_id: contactId }),
      })
      setManualLinkResult(out)
      setLinkedForSyncId(customerId)
      setLinkSyncFromResult(null)
      setLinkSyncToResult(null)
      setLinkPreview((prev) => {
        if (!prev) return prev
        const unmatched_xero = prev.unmatched_xero.filter(
          (row) => String(row.contact_id || '').trim() !== contactId,
        )
        return {
          ...prev,
          unmatched_xero,
          unmatched_xero_count: unmatched_xero.length,
          matched_count: prev.matched_count + (out.already_linked ? 0 : 1),
          already_linked_count: prev.already_linked_count + (out.already_linked ? 1 : 0),
        }
      })
      await doLoadUnlinkedCustomers()
      if (deletablePreview) {
        const preview = await apiFetch<XeroDeletableCustomersPreview>(
          '/api/xero/customers/unlinked/deletable-preview',
        )
        setDeletablePreview(preview)
      }
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Manual customer link failed')
    } finally {
      setBusy(null)
    }
  }

  async function doPreviewDeletableCustomers() {
    setBusy('xero-deletable-preview')
    setErr(null)
    try {
      const out = await apiFetch<XeroDeletableCustomersPreview>(
        '/api/xero/customers/unlinked/deletable-preview',
      )
      setDeletablePreview(out)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Failed to preview deletable customers')
    } finally {
      setBusy(null)
    }
  }

  async function doDeleteDeletableCustomers() {
    const count = deletablePreview?.deletable_count ?? 0
    if (count <= 0) return
    const msg =
      `Delete ${count} unlinked customer${count === 1 ? '' : 's'} with no orders, quotes, products, job sheets, or plates? ` +
      'This cannot be undone.'
    if (!window.confirm(msg)) return
    setBusy('xero-deletable-delete')
    setErr(null)
    try {
      const out = await apiFetch<{
        deleted_count: number
        errors?: string[]
      }>('/api/xero/customers/unlinked/delete', { method: 'POST' })
      const preview = await apiFetch<XeroDeletableCustomersPreview>(
        '/api/xero/customers/unlinked/deletable-preview',
      )
      setDeletablePreview(preview)
      await doLoadUnlinkedCustomers()
      if (out.errors && out.errors.length > 0) {
        setErr(out.errors.join('; '))
      }
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr(e instanceof Error ? e.message : 'Failed to delete customers')
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
                  Matches all Xero contacts to existing app customers and only writes{' '}
                  <code>xero_contact_id</code>. Use sync from Xero below to pull contact details into the app.
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

                <Paper variant="outlined" sx={{ mt: 2, p: 2, bgcolor: 'background.paper' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Delete unused unlinked customers
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Remove app customers that have no Xero link and no orders, quotes, products, or job sheets.
                    Customers with any of those records are kept and listed as blocked.
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      variant="outlined"
                      onClick={() => void doPreviewDeletableCustomers()}
                      disabled={busy !== null}
                    >
                      Preview deletable customers
                    </Button>
                    <Button
                      color="error"
                      variant="contained"
                      onClick={() => void doDeleteDeletableCustomers()}
                      disabled={busy !== null || !deletablePreview || deletablePreview.deletable_count === 0}
                    >
                      Delete deletable customers
                    </Button>
                  </Stack>
                  {deletablePreview ? (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Unlinked: <strong>{deletablePreview.total_unlinked}</strong> · Deletable:{' '}
                        <strong>{deletablePreview.deletable_count}</strong> · Blocked:{' '}
                        <strong>{deletablePreview.blocked_count}</strong>
                      </Typography>
                      {deletablePreview.deletable.length > 0 ? (
                        <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto', mb: 2 }}>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell>Will delete</TableCell>
                                <TableCell>MYOB display</TableCell>
                                <TableCell>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {deletablePreview.deletable.map((row) => (
                                <TableRow key={row.id}>
                                  <TableCell>{row.name}</TableCell>
                                  <TableCell>{row.myob_display_id || '—'}</TableCell>
                                  <TableCell>{row.status || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Paper>
                      ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          No deletable unlinked customers found.
                        </Typography>
                      )}
                      {deletablePreview.blocked.length > 0 ? (
                        <>
                          <Typography variant="subtitle2" gutterBottom>
                            Blocked (kept)
                          </Typography>
                          <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto' }}>
                            <Table size="small" stickyHeader>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Customer</TableCell>
                                  <TableCell align="right">Orders</TableCell>
                                  <TableCell align="right">Quotes</TableCell>
                                  <TableCell align="right">Products</TableCell>
                                  <TableCell>Reason</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {deletablePreview.blocked.slice(0, 100).map((row) => (
                                  <TableRow key={row.id}>
                                    <TableCell>{row.name}</TableCell>
                                    <TableCell align="right">{row.orders_count}</TableCell>
                                    <TableCell align="right">{row.quotes_count}</TableCell>
                                    <TableCell align="right">{row.products_count}</TableCell>
                                    <TableCell>{row.blocked_reason || '—'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Paper>
                        </>
                      ) : null}
                    </Box>
                  ) : null}
                </Paper>

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
                            <TableCell>Xero contact</TableCell>
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
                    {linkPreview.unmatched_xero.length > 0 ? (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          Link unmatched Xero contacts
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Select an unmatched Xero contact, search for the matching app customer, then link them
                          together. Primary delivery addresses are shown to help confirm the match.
                        </Typography>
                        {manualLinkResult ? (
                          <Alert severity="success" sx={{ mb: 1.5 }}>
                            {manualLinkResult.already_linked ? 'Already linked: ' : 'Linked '}
                            <strong>{manualLinkResult.customer_name}</strong>
                            {manualLinkResult.xero_name ? (
                              <>
                                {' '}
                                → <strong>{manualLinkResult.xero_name}</strong>
                              </>
                            ) : null}
                          </Alert>
                        ) : null}
                        <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto', mb: 2 }}>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell>Xero contact</TableCell>
                                <TableCell>Brand</TableCell>
                                <TableCell>Primary contact</TableCell>
                                <TableCell>Email</TableCell>
                                <TableCell>Phone</TableCell>
                                <TableCell>ABN</TableCell>
                                <TableCell>Addresses</TableCell>
                                <TableCell>Reason</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {linkPreview.unmatched_xero.slice(0, 100).map((row, idx) => {
                                const contactId = String(row.contact_id || '').trim()
                                const name = String(row.name || '').trim()
                                const selected = contactId !== '' && selectedUnmatchedContactId === contactId
                                return (
                                  <TableRow
                                    key={contactId || `${name}-${idx}`}
                                    hover
                                    selected={selected}
                                    onClick={() => {
                                      if (!contactId) return
                                      setSelectedUnmatchedContactId(contactId)
                                      setSelectedAppCustomerId(null)
                                      setAppCustomerSearch('')
                                      setManualLinkResult(null)
                                      setLinkedForSyncId(null)
                                      setLinkSyncFromResult(null)
                                      setLinkSyncToResult(null)
                                    }}
                                    sx={{ cursor: contactId ? 'pointer' : 'default' }}
                                  >
                                    <TableCell>
                                      <Typography variant="body2">{name || '—'}</Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {contactId || 'No contact ID'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 120 }}>{brandLabel(row)}</TableCell>
                                    <TableCell sx={{ maxWidth: 120 }}>{primaryContactLabel(row)}</TableCell>
                                    <TableCell sx={{ maxWidth: 140 }}>{row.email_address?.trim() || '—'}</TableCell>
                                    <TableCell sx={{ maxWidth: 110 }}>{row.contact_phone?.trim() || '—'}</TableCell>
                                    <TableCell>{row.abn || row.tax_number || '—'}</TableCell>
                                    <TableCell sx={{ maxWidth: 200 }}>
                                      <AddressesCell addresses={row.addresses} />
                                      {!row.addresses?.length ? (
                                        <AddressCell value={row.primary_address} />
                                      ) : null}
                                    </TableCell>
                                    <TableCell>{row.reason || '—'}</TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </Paper>
                        {linkPreview.unmatched_xero.length > 100 ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                            Showing first 100 unmatched Xero contacts.
                          </Typography>
                        ) : null}

                        {selectedUnmatchedContact ? (
                          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                            <Typography variant="subtitle2" gutterBottom>
                              Match selected Xero contact
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                              Compare brand, contacts, and addresses on both sides before linking. After linking,
                              sync immediately in the direction that looks correct.
                            </Typography>

                            <MatchComparePanel
                              loading={matchCompareLoading && !linkedForSyncId}
                              app={matchCompare?.app ?? (selectedAppCustomer as CustomerMatchDetail | null)}
                              xero={matchCompare?.xero ?? (selectedUnmatchedContact as CustomerMatchDetail | null)}
                            />

                            <TextField
                              size="small"
                              label="Search app customers"
                              value={appCustomerSearch}
                              onChange={(e) => {
                                setAppCustomerSearch(e.target.value)
                                setSelectedAppCustomerId(null)
                                setManualLinkResult(null)
                              }}
                              placeholder="Search by customer name…"
                              fullWidth
                              sx={{ mb: 1.5 }}
                              helperText={
                                appCustomerSearchLoading
                                  ? 'Searching…'
                                  : 'Only unlinked app customers are shown.'
                              }
                            />

                            <Paper variant="outlined" sx={{ maxHeight: 260, overflow: 'auto', mb: 1.5 }}>
                              <Table size="small" stickyHeader>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>App customer</TableCell>
                                    <TableCell>Brand</TableCell>
                                    <TableCell>Primary contact</TableCell>
                                    <TableCell>Email</TableCell>
                                    <TableCell>ABN</TableCell>
                                    <TableCell align="right">Orders</TableCell>
                                    <TableCell>Addresses</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {sortedAppCustomerResults.length > 0 ? (
                                    sortedAppCustomerResults.map((row) => {
                                      const selected = selectedAppCustomerId === row.id
                                      return (
                                        <TableRow
                                          key={row.id}
                                          hover
                                          selected={selected}
                                          onClick={() => {
                                            setSelectedAppCustomerId(row.id)
                                            setManualLinkResult(null)
                                            setLinkedForSyncId(null)
                                            setLinkSyncFromResult(null)
                                            setLinkSyncToResult(null)
                                          }}
                                          sx={{ cursor: 'pointer' }}
                                        >
                                          <TableCell>
                                            <Typography variant="body2">{row.name}</Typography>
                                            {row.myob_display_id ? (
                                              <Typography variant="caption" color="text.secondary" display="block">
                                                MYOB {row.myob_display_id}
                                              </Typography>
                                            ) : null}
                                          </TableCell>
                                          <TableCell sx={{ maxWidth: 120 }}>{brandLabel(row)}</TableCell>
                                          <TableCell sx={{ maxWidth: 120 }}>{primaryContactLabel(row)}</TableCell>
                                          <TableCell sx={{ maxWidth: 140 }}>{row.email_address?.trim() || '—'}</TableCell>
                                          <TableCell>{row.abn || '—'}</TableCell>
                                          <TableCell align="right">{row.orders_count}</TableCell>
                                          <TableCell sx={{ maxWidth: 220 }}>
                                            <AddressesCell addresses={row.addresses} />
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })
                                  ) : (
                                    <TableRow>
                                      <TableCell colSpan={7}>
                                        <Typography variant="body2" color="text.secondary">
                                          {appCustomerSearchLoading
                                            ? 'Searching…'
                                            : appCustomerSearch.trim()
                                              ? 'No unlinked app customers match.'
                                              : 'Type to search unlinked app customers.'}
                                        </Typography>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </Paper>

                            {linkedForSyncId ? (
                              <Box sx={{ mt: 2 }}>
                                <Alert severity="success" sx={{ mb: 1.5 }}>
                                  {manualLinkResult?.already_linked ? 'Already linked: ' : 'Linked '}
                                  <strong>{manualLinkResult?.customer_name}</strong>
                                  {manualLinkResult?.xero_name ? (
                                    <>
                                      {' '}
                                      → <strong>{manualLinkResult.xero_name}</strong>
                                    </>
                                  ) : null}
                                  . Choose sync direction below.
                                </Alert>
                                {linkSyncFromResult ? (
                                  <Alert severity="success" sx={{ mb: 1.5 }}>
                                    Pulled from Xero into app — {linkSyncFromResult.contacts_count} additional
                                    contact
                                    {linkSyncFromResult.contacts_count === 1 ? '' : 's'},{' '}
                                    {linkSyncFromResult.addresses_count} address
                                    {linkSyncFromResult.addresses_count === 1 ? '' : 'es'} updated
                                    {linkSyncFromResult.brand_code ? (
                                      <>
                                        {' '}
                                        (brand: <strong>{linkSyncFromResult.brand_code}</strong>)
                                      </>
                                    ) : null}
                                    .
                                  </Alert>
                                ) : null}
                                {linkSyncToResult ? (
                                  <Alert severity="success" sx={{ mb: 1.5 }}>
                                    Pushed app → Xero — {linkSyncToResult.contacts_count} contact person
                                    {linkSyncToResult.contacts_count === 1 ? '' : 's'},{' '}
                                    {linkSyncToResult.addresses_count} address
                                    {linkSyncToResult.addresses_count === 1 ? '' : 'es'} sent.
                                  </Alert>
                                ) : null}
                                <MatchComparePanel
                                  loading={matchCompareLoading}
                                  app={matchCompare?.app ?? null}
                                  xero={matchCompare?.xero ?? null}
                                />
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                  <Button
                                    variant="contained"
                                    onClick={() => void doLinkSyncFromXero()}
                                    disabled={busy !== null}
                                  >
                                    Pull from Xero → app
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    onClick={() => void doLinkSyncToXero()}
                                    disabled={busy !== null}
                                  >
                                    Push app → Xero
                                  </Button>
                                  <Button
                                    variant="text"
                                    onClick={() => {
                                      setLinkedForSyncId(null)
                                      setSelectedUnmatchedContactId(null)
                                      setSelectedAppCustomerId(null)
                                      setAppCustomerSearch('')
                                      setAppCustomerResults([])
                                      setManualLinkResult(null)
                                      setLinkSyncFromResult(null)
                                      setLinkSyncToResult(null)
                                      setMatchCompare(null)
                                    }}
                                    disabled={busy !== null}
                                  >
                                    Done
                                  </Button>
                                </Stack>
                              </Box>
                            ) : (
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <Button
                                  variant="contained"
                                  onClick={() => void doManualLinkCustomer()}
                                  disabled={
                                    busy !== null || !selectedAppCustomerId || !selectedUnmatchedContactId
                                  }
                                >
                                  Link selected customer to Xero contact
                                </Button>
                                <Button
                                  variant="text"
                                  onClick={() => {
                                    setSelectedUnmatchedContactId(null)
                                    setSelectedAppCustomerId(null)
                                    setAppCustomerSearch('')
                                    setAppCustomerResults([])
                                    setMatchCompare(null)
                                  }}
                                  disabled={busy !== null}
                                >
                                  Clear selection
                                </Button>
                              </Stack>
                            )}
                          </Paper>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Select an unmatched Xero contact above to start manual linking.
                          </Typography>
                        )}
                      </Box>
                    ) : null}
                  </Box>
                ) : null}

                {unlinkedReview ? (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Unlinked app customers with orders
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      Unlinked app customers: <strong>{unlinkedReview.total}</strong> · With orders:{' '}
                      <strong>{unlinkedReview.with_orders_count}</strong> · Without orders:{' '}
                      <strong>{unlinkedReview.without_orders_count}</strong>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Select a customer to review contact details, then create a new Xero contact and link it in the
                      app. Use this for app customers who have orders but no matching Xero contact yet.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={unlinkedWithOrdersOnly}
                          onChange={(e) => {
                            setUnlinkedWithOrdersOnly(e.target.checked)
                            setSelectedUnlinkedCustomerId(null)
                            setCreateContactResult(null)
                          }}
                        />
                      }
                      label="Show only customers with orders"
                      sx={{ mb: 1.5, display: 'block' }}
                    />
                    {createContactResult ? (
                      <Alert severity="success" sx={{ mb: 1.5 }}>
                        Created Xero contact <strong>{createContactResult.xero_name}</strong>
                        {createContactResult.xero_account_code ? (
                          <> ({createContactResult.xero_account_code})</>
                        ) : null}{' '}
                        and linked to app customer <strong>{createContactResult.customer_name}</strong>.
                        {typeof createContactResult.contacts_count === 'number' ? (
                          <>
                            {' '}
                            {createContactResult.contacts_count} contact
                            {createContactResult.contacts_count === 1 ? '' : 's'},{' '}
                            {createContactResult.addresses_count ?? 0} address
                            {(createContactResult.addresses_count ?? 0) === 1 ? '' : 'es'} sent.
                          </>
                        ) : null}
                      </Alert>
                    ) : null}
                    <Paper variant="outlined" sx={{ maxHeight: 360, overflow: 'auto', mb: 1.5 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Customer</TableCell>
                            <TableCell>Brand</TableCell>
                            <TableCell>Primary contact</TableCell>
                            <TableCell>Phone</TableCell>
                            <TableCell align="right">Orders</TableCell>
                            <TableCell align="right">Quotes</TableCell>
                            <TableCell>Addresses</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {sortedUnlinkedAppCustomers.length > 0 ? (
                            sortedUnlinkedAppCustomers.map((row) => {
                              const selected = selectedUnlinkedCustomerId === row.id
                              return (
                                <TableRow
                                  key={row.id}
                                  hover
                                  selected={selected}
                                  onClick={() => {
                                    setSelectedUnlinkedCustomerId(row.id)
                                    setCreateContactResult(null)
                                  }}
                                  sx={{ cursor: 'pointer' }}
                                >
                                  <TableCell>
                                    <Typography variant="body2">{row.name}</Typography>
                                    {row.myob_display_id ? (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        MYOB {row.myob_display_id}
                                      </Typography>
                                    ) : null}
                                  </TableCell>
                                  <TableCell sx={{ maxWidth: 120 }}>{brandLabel(row)}</TableCell>
                                  <TableCell sx={{ maxWidth: 120 }}>{primaryContactLabel(row)}</TableCell>
                                  <TableCell sx={{ maxWidth: 120 }}>{row.contact_phone?.trim() || '—'}</TableCell>
                                  <TableCell align="right">{row.orders_count}</TableCell>
                                  <TableCell align="right">{row.quotes_count}</TableCell>
                                  <TableCell sx={{ maxWidth: 220 }}>
                                    <AddressesCell addresses={row.addresses} />
                                  </TableCell>
                                </TableRow>
                              )
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={7}>
                                <Typography variant="body2" color="text.secondary">
                                  {unlinkedWithOrdersOnly
                                    ? 'No unlinked app customers with orders.'
                                    : 'No unlinked app customers.'}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </Paper>
                    {selectedUnlinkedCustomer ? (
                      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper' }}>
                        <Stack
                          direction={{ xs: 'column', md: 'row' }}
                          spacing={2}
                          alignItems={{ xs: 'stretch', md: 'flex-start' }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <MatchDetailCard title="App customer" row={selectedUnlinkedCustomer} />
                          </Box>
                          <Stack spacing={1} sx={{ minWidth: { md: 220 } }}>
                            <Button
                              variant="contained"
                              onClick={() => void doCreateXeroContact()}
                              disabled={busy !== null}
                            >
                              Create Xero contact &amp; link
                            </Button>
                            <Button
                              variant="outlined"
                              onClick={() => {
                                setSelectedUnlinkedCustomerId(null)
                                setCreateContactResult(null)
                              }}
                              disabled={busy !== null}
                            >
                              Clear selection
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Select an unlinked app customer above to review details and create a Xero contact.
                      </Typography>
                    )}
                  </Box>
                ) : null}
              </Paper>
            ) : null}

            {status?.connected ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1" gutterBottom>
                  Sync linked customer with Xero
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  For app customers already linked to Xero, pull from Xero into the app, push app changes to the Xero
                  contact, or merge field-by-field. Pull overwrites app fields. Push overwrites Xero fields. Merge
                  prefers the app value when both sides have a field; otherwise it fills gaps from whichever side has
                  data. Lists (phones, contact persons, addresses) use the longer side; when lengths match, the app
                  list is used — never combining rows from both sides. Merge saves to the app and replaces all Xero
                  address slots. App notes are not synced.
                </Typography>
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: 'background.paper' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Bulk merge all linked customers
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Run the same merge for every app customer already linked to Xero. Customers are
                    processed one at a time; keep this page open until finished.
                  </Typography>
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={() => void doMergeAllLinkedCustomers()}
                    disabled={busy !== null}
                    sx={{ mb: mergeAllProgress || mergeAllResult ? 1.5 : 0 }}
                  >
                    Merge all linked customers
                  </Button>
                  {mergeAllProgress ? (
                    <Box sx={{ mb: mergeAllResult ? 1.5 : 0 }}>
                      <LinearProgress
                        variant="determinate"
                        value={
                          mergeAllProgress.total > 0
                            ? (mergeAllProgress.completed / mergeAllProgress.total) * 100
                            : 0
                        }
                        sx={{ mb: 0.75 }}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {mergeAllProgress.completed} / {mergeAllProgress.total} merged
                        {mergeAllProgress.currentName ? (
                          <>
                            {' '}
                            — <strong>{mergeAllProgress.currentName}</strong>
                          </>
                        ) : null}
                      </Typography>
                    </Box>
                  ) : null}
                  {mergeAllResult ? (
                    <Alert severity={mergeAllResult.error_count > 0 ? 'warning' : 'success'}>
                      Bulk merge finished: <strong>{mergeAllResult.merged_count}</strong> merged
                      {mergeAllResult.error_count > 0 ? (
                        <>
                          , <strong>{mergeAllResult.error_count}</strong> failed
                        </>
                      ) : null}
                      .
                      {mergeAllResult.errors.length > 0 ? (
                        <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                          {mergeAllResult.errors.slice(0, 10).map((row) => (
                            <li key={row.customer_id}>
                              <strong>{row.customer_name}</strong>: {row.message}
                            </li>
                          ))}
                          {mergeAllResult.errors.length > 10 ? (
                            <li>…and {mergeAllResult.errors.length - 10} more</li>
                          ) : null}
                        </Box>
                      ) : null}
                    </Alert>
                  ) : null}
                </Paper>
                {syncFromXeroResult ? (
                  <Alert severity="success" sx={{ mb: 1.5 }}>
                    Pulled into app: <strong>{syncFromXeroResult.customer_name || syncFromXeroResult.customer_id}</strong>
                    {syncFromXeroResult.xero_name ? (
                      <>
                        {' '}
                        from Xero contact <strong>{syncFromXeroResult.xero_name}</strong>
                      </>
                    ) : null}
                    {' — '}
                    {syncFromXeroResult.contacts_count} contact
                    {syncFromXeroResult.contacts_count === 1 ? '' : 's'},{' '}
                    {syncFromXeroResult.addresses_count} address
                    {syncFromXeroResult.addresses_count === 1 ? '' : 'es'} updated
                    {syncFromXeroResult.brand_code ? (
                      <>
                        {' '}
                        (brand: <strong>{syncFromXeroResult.brand_code}</strong>)
                      </>
                    ) : null}
                    .
                  </Alert>
                ) : null}
                {syncToXeroResult ? (
                  <Alert severity="success" sx={{ mb: 1.5 }}>
                    Pushed to Xero: <strong>{syncToXeroResult.customer_name || syncToXeroResult.customer_id}</strong>
                    {syncToXeroResult.xero_name ? (
                      <>
                        {' '}
                        → Xero contact <strong>{syncToXeroResult.xero_name}</strong>
                      </>
                    ) : null}
                    {' — '}
                    {syncToXeroResult.contacts_count} contact person
                    {syncToXeroResult.contacts_count === 1 ? '' : 's'},{' '}
                    {syncToXeroResult.addresses_count} address
                    {syncToXeroResult.addresses_count === 1 ? '' : 'es'} sent.
                  </Alert>
                ) : null}
                {syncMergeResult ? (
                  <Alert severity="success" sx={{ mb: 1.5 }}>
                    Merged app + Xero:{' '}
                    <strong>{syncMergeResult.customer_name || syncMergeResult.customer_id}</strong>
                    {syncMergeResult.xero_name ? (
                      <>
                        {' '}
                        ↔ Xero contact <strong>{syncMergeResult.xero_name}</strong>
                      </>
                    ) : null}
                    {' — '}
                    {syncMergeResult.contacts_count} contact person
                    {syncMergeResult.contacts_count === 1 ? '' : 's'},{' '}
                    {syncMergeResult.addresses_count} address
                    {syncMergeResult.addresses_count === 1 ? '' : 'es'},{' '}
                    {syncMergeResult.phones_count} phone
                    {syncMergeResult.phones_count === 1 ? '' : 's'} saved to app and pushed to Xero.
                    {Object.entries(syncMergeResult.field_sources || {}).some(([, source]) => source === 'xero') ? (
                      <>
                        {' '}
                        Fields filled from Xero:{' '}
                        {Object.entries(syncMergeResult.field_sources)
                          .filter(([, source]) => source === 'xero')
                          .map(([field]) => field)
                          .join(', ')}
                        .
                      </>
                    ) : null}
                  </Alert>
                ) : null}
                <TextField
                  size="small"
                  label="Search linked app customers"
                  value={syncCustomerSearch}
                  onChange={(e) => {
                    setSyncCustomerSearch(e.target.value)
                    setSelectedSyncCustomerId(null)
                    setSyncFromXeroResult(null)
                    setSyncToXeroResult(null)
                    setSyncMergeResult(null)
                  }}
                  placeholder="Search by customer name…"
                  fullWidth
                  sx={{ mb: 1.5 }}
                  helperText={
                    syncCustomerSearchLoading
                      ? 'Searching…'
                      : 'Only app customers with a Xero contact link are shown.'
                  }
                />
                <Paper variant="outlined" sx={{ maxHeight: 420, overflow: 'auto', mb: 1.5 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>App customer</TableCell>
                        <TableCell>Brand</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Phone</TableCell>
                        <TableCell>Notes (app only)</TableCell>
                        <TableCell>Contact persons</TableCell>
                        <TableCell>Addresses</TableCell>
                        <TableCell align="right">Orders</TableCell>
                        <TableCell>Xero contact id</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedSyncCustomerResults.length > 0 ? (
                        sortedSyncCustomerResults.map((row) => {
                          const selected = selectedSyncCustomerId === row.id
                          return (
                            <TableRow
                              key={row.id}
                              hover
                              selected={selected}
                              onClick={() => {
                                setSelectedSyncCustomerId(row.id)
                                setSyncFromXeroResult(null)
                                setSyncToXeroResult(null)
                                setSyncMergeResult(null)
                              }}
                              sx={{ cursor: 'pointer', verticalAlign: 'top' }}
                            >
                              <TableCell>
                                <Typography variant="body2">{row.name}</Typography>
                                {row.abn ? (
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    ABN {row.abn}
                                  </Typography>
                                ) : null}
                                {row.myob_display_id ? (
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    MYOB {row.myob_display_id}
                                  </Typography>
                                ) : null}
                              </TableCell>
                              <TableCell sx={{ maxWidth: 140 }}>
                                {row.brand_name?.trim() ? (
                                  <>
                                    <Typography variant="body2">{row.brand_name}</Typography>
                                    {row.brand_code?.trim() ? (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        {row.brand_code}
                                      </Typography>
                                    ) : null}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell sx={{ maxWidth: 180 }}>
                                {row.email_address?.trim() ? row.email_address : '—'}
                              </TableCell>
                              <TableCell sx={{ maxWidth: 140, whiteSpace: 'nowrap' }}>
                                {row.contact_phone?.trim() ? row.contact_phone : '—'}
                              </TableCell>
                              <TableCell sx={{ maxWidth: 220 }}>
                                <AddressCell value={row.notes} />
                              </TableCell>
                              <TableCell sx={{ maxWidth: 160 }}>
                                <ContactPersonsCell names={row.contact_persons} />
                              </TableCell>
                              <TableCell sx={{ maxWidth: 280 }}>
                                <AddressesCell addresses={row.addresses} />
                              </TableCell>
                              <TableCell align="right">{row.orders_count}</TableCell>
                              <TableCell sx={{ maxWidth: 120 }}>
                                <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                                  {row.xero_contact_id}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={9}>
                            <Typography variant="body2" color="text.secondary">
                              {syncCustomerSearchLoading
                                ? 'Searching…'
                                : syncCustomerSearch.trim()
                                  ? 'No linked app customers match.'
                                  : 'Type to search linked app customers, or pick from the list.'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Paper>
                {selectedSyncCustomer ? (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Compare app customer and linked Xero contact before choosing pull, push, or merge.
                    </Typography>
                    <MatchComparePanel
                      loading={syncMatchCompareLoading}
                      app={syncMatchCompare?.app ?? (selectedSyncCustomer as CustomerMatchDetail)}
                      xero={syncMatchCompare?.xero ?? null}
                    />
                    {!syncMatchCompareLoading && selectedSyncCustomer && !syncMatchCompare?.xero ? (
                      <Alert severity="warning" sx={{ mb: 1.5 }}>
                        Could not load the linked Xero contact. Check the connection and Xero contact id{' '}
                        <Typography component="span" variant="body2" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                          {selectedSyncCustomer.xero_contact_id}
                        </Typography>
                        .
                      </Alert>
                    ) : null}
                  </Box>
                ) : null}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() => void doSyncCustomerFromXero()}
                    disabled={busy !== null || !selectedSyncCustomerId}
                  >
                    Pull from Xero → app
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => void doSyncCustomerToXero()}
                    disabled={busy !== null || !selectedSyncCustomerId}
                  >
                    Push app → Xero
                  </Button>
                  <Button
                    variant="outlined"
                    color="secondary"
                    onClick={() => void doMergeCustomerWithXero()}
                    disabled={busy !== null || !selectedSyncCustomerId}
                  >
                    Merge app + Xero
                  </Button>
                  <Button
                    variant="text"
                    onClick={() => {
                      setSelectedSyncCustomerId(null)
                      setSyncCustomerSearch('')
                      setSyncCustomerResults([])
                      setSyncFromXeroResult(null)
                      setSyncToXeroResult(null)
                      setSyncMergeResult(null)
                      setSyncMatchCompare(null)
                    }}
                    disabled={busy !== null}
                  >
                    Clear selection
                  </Button>
                </Stack>
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
                    helperText="Examples: /Contacts?page=1, /Contacts/{ContactID}, /Accounts"
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

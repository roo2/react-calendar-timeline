import { useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchOrder } from '../../store/slices/ordersSlice'
import { OrderFormFooter } from './components/OrderFormFooter'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { formatDateDMYShort } from '../../utils/dateFormat'

export function OrderShowPage() {
  const { orderId } = useParams()
  const loc = useLocation()
  const debugEnabled = (new URLSearchParams(loc.search).get('debug') || '').toLowerCase() === 'true'
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const detailEntry = useAppSelector((s) => (orderId ? s.orders.detail.byId[orderId] : undefined))
  const order = detailEntry?.order
  const loadErr = detailEntry?.error
  const loading = detailEntry?.status === 'loading' || detailEntry?.status === 'idle'

  useEffect(() => {
    if (!orderId) return
    void dispatch(fetchOrder(orderId))
  }, [orderId, dispatch])

  const err = loadErr

  if (err && !order && detailEntry?.status === 'failed') {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Order
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to="/orders" variant="text" color="primary">
          Back to Orders
        </Button>
      </Box>
    )
  }
  if (!order || loading) return <p>Loading…</p>

  const items: any[] = Array.isArray(order.items) ? order.items : []
  const rowRank = (it: any): number => {
    const kind = String(it?.line_kind || 'product')
    if (kind === 'product') {
      return String(it?.import_line_description || '').trim() ? 1 : 3
    }
    if (kind === 'myob_import') return 2
    if (kind === 'resell') return it?.resell_catalog_kind === 'outsourced_manufacturing' ? 4 : 5
    return 6
  }
  const rows = items.slice().sort((a, b) => {
    const ra = rowRank(a)
    const rb = rowRank(b)
    if (ra !== rb) return ra - rb
    return (Number(a.line_index ?? 0) || 0) - (Number(b.line_index ?? 0) || 0)
  })
  const totalPriceSum = rows.reduce((sum: number, it: any) => {
    const p = it.total_price != null ? Number(it.total_price) : it.line_total != null ? Number(it.line_total) : 0
    return sum + (Number.isFinite(p) ? p : 0)
  }, 0)

  function fmtCurrency(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—'
    return `$${Number(v).toFixed(2)}`
  }

  function IncomeAccountCell(props: { displayId?: string | null; name?: string | null }) {
    const { displayId, name } = props
    const showId = displayId != null && String(displayId).trim() !== ''
    const showName = name != null && String(name).trim() !== ''
    return (
      <TableCell>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: 140 }}>
          <Typography component="span" variant="body2" noWrap title={showId ? String(displayId) : undefined}>
            {showId ? String(displayId) : '—'}
          </Typography>
          {showName ? (
            <Tooltip title={String(name)} arrow placement="top">
              <InfoOutlinedIcon
                fontSize="small"
                color="action"
                sx={{ flexShrink: 0, cursor: 'help', verticalAlign: 'middle' }}
                aria-label="Income account name"
              />
            </Tooltip>
          ) : null}
        </Box>
      </TableCell>
    )
  }

  function formatOrderUnit(u: string | undefined): string {
    const x = String(u || '').toLowerCase()
    if (x === 'kg') return 'KG'
    if (x === 'rolls') return 'Roll'
    if (x === 'cartons') return 'Carton'
    if (x === '1000') return '1000'
    if (x === 'ea' || x === 'each' || x === 'unit' || x === 'units') return 'Each'
    if (x === 'bags') return 'Bags (legacy)'
    if (x === 'meters') return 'Meters (legacy)'
    return u || '—'
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Order {order.code}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Status: <strong>{order.status}</strong> • Customer: {order.customer_name || '-'} • Order Date:{' '}
        {formatDateDMYShort(order.order_date || order.created_at, '-')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Customer PO: {order.customer_purchase_order_number || '—'}
      </Typography>

      {order.import_source === 'MYOB' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Imported from MYOB</strong>
          {order.myob_order_uid ? (
            <>
              {' '}
              — order UID <code>{order.myob_order_uid}</code>
            </>
          ) : null}
          {order.myob_synced_at ? (
            <>
              {' '}
              · last sync {String(order.myob_synced_at).replace('T', ' ').slice(0, 19)} UTC
            </>
          ) : null}
          <br />
          Job sheet data from MYOB:{' '}
          {order.myob_all_job_sheets_entered
            ? 'all required production lines have a completed job sheet (not an import draft), or only non-production lines.'
            : 'pending — open each import line’s job sheet and complete product details, or link an existing job sheet from the order editor.'}
        </Alert>
      ) : null}

      {order.import_source === 'MYOB' && debugEnabled ? (
        <Paper variant="outlined" sx={{ mb: 2, p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            MYOB source JSON
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Original sale order payload and associated invoice payloads captured during import.
          </Typography>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            Sale Order JSON
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              mb: 2,
              p: 1.5,
              backgroundColor: 'grey.100',
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 360,
              fontSize: 12,
            }}
          >
            {order.myob_source_sales_order_json
              ? JSON.stringify(order.myob_source_sales_order_json, null, 2)
              : 'No sale order JSON stored for this record.'}
          </Box>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle2">Associated Invoices JSON</Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              mb: 0,
              p: 1.5,
              backgroundColor: 'grey.100',
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 360,
              fontSize: 12,
            }}
          >
            {Array.isArray(order.myob_source_invoices_json) && order.myob_source_invoices_json.length > 0
              ? JSON.stringify(order.myob_source_invoices_json, null, 2)
              : 'No associated invoices were stored for this order import.'}
          </Box>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ px: 2, pt: 2, pb: 1 }}>
          Order lines
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Income account</TableCell>
              <TableCell>Job / Item</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Unit / type</TableCell>
              <TableCell align="right">Unit price</TableCell>
              <TableCell align="right">Line total</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((it: any) => {
              const kind = it.line_kind || 'product'
              if (kind === 'resell') {
                return (
                  <TableRow key={it.id} hover>
                    <IncomeAccountCell displayId={it.income_account_display_id} name={it.income_account_name} />
                    <TableCell>{it.product_code || 'Resell'}</TableCell>
                    <TableCell>
                      {it.product_name ? <strong>{it.product_name}</strong> : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {it.quantity_value != null ? Number(it.quantity_value).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>{formatOrderUnit(it.quantity_unit)}</TableCell>
                    <TableCell align="right">{fmtCurrency(it.rate)}</TableCell>
                    <TableCell align="right">{fmtCurrency(it.total_price)}</TableCell>
                    <TableCell align="right">—</TableCell>
                  </TableRow>
                )
              }
              if (kind === 'myob_import') {
                return (
                  <TableRow key={it.id} hover>
                    <IncomeAccountCell displayId={it.income_account_display_id} name={it.income_account_name} />
                    <TableCell>
                      {it.myob_item_number || it.myob_item_name || 'MYOB'}
                      {it.myob_item_sales_unit_raw ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          MYOB UOM: {it.myob_item_sales_unit_raw}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{it.description || '—'}</TableCell>
                    <TableCell align="right">
                      {it.ship_quantity != null ? Number(it.ship_quantity).toLocaleString() : it.quantity_value != null ? Number(it.quantity_value).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {formatOrderUnit(it.quantity_unit)} / {it.qty_type || '—'}
                    </TableCell>
                    <TableCell align="right">{fmtCurrency(it.unit_price ?? it.rate)}</TableCell>
                    <TableCell align="right">{fmtCurrency(it.line_total ?? it.total_price)}</TableCell>
                    <TableCell align="right">
                      {it.requires_job_sheet
                        ? it.job_sheet_id
                          ? it.is_import_draft
                            ? 'Draft import'
                            : 'Linked'
                          : 'Not linked'
                        : 'N/A (non-production)'}
                      {it.job_sheet_id ? (
                        <Button
                          size="small"
                          sx={{ display: 'block', mt: 0.5 }}
                          component={Link}
                          to={`/job-sheets/${it.job_sheet_id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                        >
                          {it.is_import_draft ? 'Complete job sheet' : 'Edit job sheet'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              }
              return (
                <TableRow key={it.id} hover>
                  <IncomeAccountCell displayId={it.income_account_display_id} name={it.income_account_name} />
                  <TableCell>{it.product_code || it.product_id || '—'}</TableCell>
                  <TableCell>
                    {it.product_name || '—'}
                  </TableCell>
                  <TableCell align="right">
                    {it.quantity_value != null ? Number(it.quantity_value).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{formatOrderUnit(it.quantity_unit)}</TableCell>
                  <TableCell align="right">{fmtCurrency(it.rate)}</TableCell>
                  <TableCell align="right">{fmtCurrency(it.total_price)}</TableCell>
                  <TableCell align="right">
                    {it.job_sheet_id ? (
                      <Button
                        size="small"
                        component={Link}
                        to={`/job-sheets/${it.job_sheet_id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                      >
                        {it.is_import_draft ? 'Complete job sheet' : 'Edit job sheet'}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary">No lines on this order yet.</Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.length > 0 && (
              <TableRow sx={{ fontWeight: 600, bgcolor: 'action.hover' }}>
                <TableCell colSpan={6} align="right">
                  Total
                </TableCell>
                <TableCell align="right">{fmtCurrency(totalPriceSum)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {orderId ? (
        <OrderFormFooter
          variant="view"
          orderId={orderId}
          orderStatus={String(order.status || '')}
          importSource={order.import_source}
          importReviewStatus={
            order.import_review_status === 'complete' || order.import_review_status === 'incomplete'
              ? order.import_review_status
              : null
          }
          orderLocked={!['draft', 'confirmed'].includes(String(order.status || '').trim().toLowerCase())}
          onCancel={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              nav(-1)
              return
            }
            nav('/orders')
          }}
          onAfterPatch={async () => {
            if (orderId) await dispatch(fetchOrder(orderId)).unwrap()
          }}
        />
      ) : null}
    </Box>
  )
}

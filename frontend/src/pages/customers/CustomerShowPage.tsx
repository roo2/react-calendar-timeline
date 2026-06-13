import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { can } from '../../auth/permissions'
import { deleteCustomer, fetchCustomer } from '../../store/slices/customersSlice'
import { fetchOrders } from '../../store/slices/ordersSlice'
import { fetchProducts } from '../../store/slices/productsSlice'
import { deleteSavedQuote, fetchSavedQuotesList } from '../../store/slices/quotesSlice'
import { isRejectedWithValue } from '@reduxjs/toolkit'
import { ApiError } from '../../api/client'
import { Alert, Box, Button, Chip, Paper, Typography, Link as MuiLink, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { describePaymentTerms } from '../../utils/paymentTermsDisplay'
import { formatDateDMYShort, formatDateTimeDMYShort } from '../../utils/dateFormat'
import { formatDeliveryAddressDisplay } from '../../utils/customerDeliveryAddress'
import { xeroContactViewUrl } from '../../utils/xeroLinks'

function contactPersonName(c: any): string {
  const first = String(c?.first_name || '').trim()
  const last = String(c?.last_name || '').trim()
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return String(c?.name || '').trim() || '—'
}

function contactPersonEmail(c: any): string {
  return String(c?.email_address || c?.email || '').trim()
}

const CUSTOMER_SECTION_HASHES = new Set(['quotes', 'orders'])

export function CustomerShowPage() {
  const { customerId } = useParams()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const canEditOrders = canEdit

  const [deleteCustomerErr, setDeleteCustomerErr] = useState<string | null>(null)
  const [deletingCustomer, setDeletingCustomer] = useState(false)
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null)
  const [deleteQuoteErr, setDeleteQuoteErr] = useState<string | null>(null)

  const entry = useAppSelector((s) => (customerId ? s.customers.detail.byId[customerId] : undefined))
  const customer = entry?.customer || null
  const err = entry?.error || null

  const productsState = useAppSelector((s) => s.products.list)
  const ordersState = useAppSelector((s) => s.orders.list)
  const quotesState = useAppSelector((s) => s.quotes.savedList)

  const products = useMemo(() => {
    if (!customerId || productsState.lastCustomerId !== customerId) return []
    return productsState.items
  }, [customerId, productsState.items, productsState.lastCustomerId])

  const orders = useMemo(() => {
    if (!customerId || ordersState.lastCustomerId !== customerId) return []
    return ordersState.items
  }, [customerId, ordersState.items, ordersState.lastCustomerId])

  const quotes = useMemo(() => {
    if (!customerId || quotesState.lastCustomerId !== customerId) return []
    return quotesState.items
  }, [customerId, quotesState.items, quotesState.lastCustomerId])

  const relErr = useMemo(() => {
    if (!customerId) return null
    const msgs: string[] = []
    if (productsState.lastCustomerId === customerId && productsState.status === 'failed' && productsState.error) {
      msgs.push(`Products: ${productsState.error}`)
    }
    if (ordersState.lastCustomerId === customerId && ordersState.status === 'failed' && ordersState.error) {
      msgs.push(`Orders: ${ordersState.error}`)
    }
    if (quotesState.lastCustomerId === customerId && quotesState.status === 'failed' && quotesState.error) {
      msgs.push(`Quotes: ${quotesState.error}`)
    }
    return msgs.length ? msgs.join(' ') : null
  }, [customerId, productsState, ordersState, quotesState])

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchProducts({ customer_id: customerId }))
    void dispatch(fetchOrders({ customer_id: customerId }))
    void dispatch(fetchSavedQuotesList({ customer_id: customerId }))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!customer) return
    const raw = (location.hash || '').replace(/^#/, '')
    if (!CUSTOMER_SECTION_HASHES.has(raw)) return
    const t = window.setTimeout(() => {
      document.getElementById(raw)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(t)
  }, [customer, location.hash])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Customer
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to="/customers" variant="text" color="primary">
          Back to Customers
        </Button>
      </Box>
    )
  }

  if (!customer) return <p>Loading…</p>

  const canDeleteCustomer = Boolean(
    canEdit &&
      customerId &&
      (customer.can_delete ??
        ((Number(customer.orders_count ?? 0) === 0 && Number(customer.quotes_count ?? 0) === 0))),
  )

  async function onDeleteCustomer() {
    if (!customerId || !canDeleteCustomer || deletingCustomer) return
    const ok = window.confirm(
      `Delete customer "${customer.name}" permanently? This cannot be undone.`,
    )
    if (!ok) return
    setDeleteCustomerErr(null)
    setDeletingCustomer(true)
    try {
      await dispatch(deleteCustomer(customerId)).unwrap()
      nav('/customers')
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as { message?: string }
        setDeleteCustomerErr(p.message || 'Failed to delete customer')
      } else if (e instanceof ApiError) {
        setDeleteCustomerErr(e.message || 'Failed to delete customer')
      } else {
        setDeleteCustomerErr(e instanceof Error ? e.message : 'Failed to delete customer')
      }
    } finally {
      setDeletingCustomer(false)
    }
  }

  async function onDeleteQuote(quoteId: string) {
    if (!canEdit || deletingQuoteId) return
    const ok = window.confirm('Delete this quote permanently? This cannot be undone.')
    if (!ok) return
    setDeleteQuoteErr(null)
    setDeletingQuoteId(quoteId)
    try {
      await dispatch(deleteSavedQuote(quoteId)).unwrap()
      if (customerId) {
        await dispatch(fetchCustomer(customerId))
        await dispatch(fetchSavedQuotesList({ customer_id: customerId }))
      }
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as { message?: string }
        setDeleteQuoteErr(p.message || 'Failed to delete quote')
      } else if (e instanceof ApiError) {
        setDeleteQuoteErr(e.message || 'Failed to delete quote')
      } else {
        setDeleteQuoteErr(e instanceof Error ? e.message : 'Failed to delete quote')
      }
    } finally {
      setDeletingQuoteId(null)
    }
  }

  const contacts = customer.contacts || []
  const addresses = customer.delivery_addresses || []
  const prefs = customer.delivery_preferences || {}

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box>
          <Typography variant="h5">
            {customer.name}
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Chip
              color="primary"
              variant="filled"
              size="medium"
              label={`Brand: ${customer.brand_name || customer.brand_code || 'Unassigned'}`}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Status: {customer.status}
          </Typography>
        </Box>
        {canEdit && (
          <Button variant="outlined" component={Link} to={`/customers/${customer.id}/edit`}>
            Edit Customer
          </Button>
        )}
      </Box>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', color: '#6b7280', textTransform: 'uppercase' }}>
            Brand
          </h3>
          <span>{customer.brand_name || customer.brand_code || 'Unassigned'}</span>
          {customer.xero_contact_id ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Synced from Xero —{' '}
              <MuiLink
                href={xeroContactViewUrl(customer.xero_contact_id)}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
              >
                Edit in Xero
              </MuiLink>
            </Typography>
          ) : null}
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', color: '#6b7280', textTransform: 'uppercase' }}>
            Related Records
          </h3>
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <strong>{customer.products_count ?? '-'}</strong> Products
            </div>
            <div>
              <strong>{customer.orders_count ?? '-'}</strong> Orders
            </div>
            <div>
              <strong>{customer.quotes_count ?? quotes.length}</strong> Quotes
            </div>
          </div>
        </Paper>
      </div>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Basic Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Company Name</strong>
            <p style={{ margin: '4px 0 0' }}>{customer.name}</p>
          </div>
          {customer.abn && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>ABN</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.abn}</p>
            </div>
          )}
          {customer.contact_phone && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Contact Phone</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.contact_phone}</p>
            </div>
          )}
          {customer.xero_contact_id && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Xero contact</strong>
              <p style={{ margin: '4px 0 0' }}>
                <MuiLink
                  href={xeroContactViewUrl(customer.xero_contact_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                >
                  View in Xero
                </MuiLink>
              </p>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                {customer.xero_contact_id}
              </Typography>
            </div>
          )}
          {(() => {
            const summary =
              (customer.payment_terms_summary && String(customer.payment_terms_summary).trim()) ||
              describePaymentTerms(customer.payment_terms as Record<string, unknown> | string | null | undefined)
            if (!summary) return null
            return (
              <div>
                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Payment Terms</strong>
                <p style={{ margin: '4px 0 0' }}>{summary}</p>
              </div>
            )
          })()}
          {customer.myob_last_modified && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Last modified in MYOB</strong>
              <p style={{ margin: '4px 0 0' }}>
                {formatDateTimeDMYShort(customer.myob_last_modified)}
              </p>
            </div>
          )}
          {customer.myob_synced_at && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Last synced from MYOB</strong>
              <p style={{ margin: '4px 0 0' }}>
                {formatDateTimeDMYShort(customer.myob_synced_at)}
              </p>
            </div>
          )}
          {(customer as any).xero_last_modified && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Last modified in Xero</strong>
              <p style={{ margin: '4px 0 0' }}>
                {formatDateTimeDMYShort((customer as any).xero_last_modified)}
              </p>
            </div>
          )}
          {(customer as any).xero_synced_at && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Last synced from Xero</strong>
              <p style={{ margin: '4px 0 0' }}>
                {formatDateTimeDMYShort((customer as any).xero_synced_at)}
              </p>
            </div>
          )}
        </div>
        {customer.myob_notes && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Notes (MYOB)</strong>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{customer.myob_notes}</p>
          </div>
        )}
        {customer.notes && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Notes</strong>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              (not synced to Xero)
            </Typography>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{customer.notes}</p>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Primary contact</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {(customer.contact_first_name || customer.contact_last_name) && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Name</strong>
              <p style={{ margin: '4px 0 0' }}>
                {[customer.contact_first_name, customer.contact_last_name].filter(Boolean).join(' ') || '—'}
              </p>
            </div>
          )}
          {customer.email_address && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Email</strong>
              <p style={{ margin: '4px 0 0' }}>
                <MuiLink href={`mailto:${customer.email_address}`} underline="hover">
                  {customer.email_address}
                </MuiLink>
              </p>
            </div>
          )}
        </div>
        {!customer.contact_first_name &&
        !customer.contact_last_name &&
        !customer.email_address ? (
          <p style={{ color: '#9ca3af', margin: 0 }}>No primary contact details.</p>
        ) : null}
      </section>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Additional contacts</h2>
        {contacts.length > 0 ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {contacts.map((c: any, idx: number) => (
              <div key={idx} style={{ padding: 16, background: '#f9fafb', borderRadius: 6 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 600 }}>{contactPersonName(c)}</h3>
                {contactPersonEmail(c) ? (
                  <p style={{ margin: '4px 0' }}>
                    <strong>Email:</strong>{' '}
                    <MuiLink href={`mailto:${contactPersonEmail(c)}`} underline="hover">
                      {contactPersonEmail(c)}
                    </MuiLink>
                  </p>
                ) : null}
                {c.include_in_emails === false ? (
                  <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '0.875rem' }}>Not included in emails</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#9ca3af' }}>No additional contacts.</p>
        )}
      </section>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Products</h2>
          {canEdit && (
            <Button size="small" variant="contained" component={Link} to={`/products/new?customerId=${encodeURIComponent(customer.id)}`}>
              Create product
            </Button>
          )}
        </Box>
        {relErr && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {relErr}
          </Alert>
        )}
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Packing</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <MuiLink
                      component={Link}
                      to={p.active_version_id ? `/products/${p.id}/versions/${p.active_version_id}` : `/products/${p.id}`}
                      underline="hover"
                    >
                      {p.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{p.description || '-'}</TableCell>
                  <TableCell>{p.product_type || '-'}</TableCell>
                  <TableCell>{p.pack_mode || '-'}</TableCell>
                </TableRow>
              ))}
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No products.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </section>

      <section
        id="orders"
        style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, scrollMarginTop: 88 }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Orders</h2>
          {canEditOrders && (
            <Button size="small" variant="contained" component={Link} to={`/orders/new?customerId=${encodeURIComponent(customer.id)}`}>
              Create order
            </Button>
          )}
        </Box>
        {relErr && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {relErr}
          </Alert>
        )}
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Order date</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/orders/${encodeURIComponent(o.id)}/edit`} underline="hover">
                      {o.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{o.status}</TableCell>
                  <TableCell>
                    {o.product_code
                      ? `${o.product_code}${o.version_number != null ? ` v${o.version_number}` : ''}${o.item_count && o.item_count > 1 ? ` (+${o.item_count - 1})` : ''}`
                      : '-'}
                  </TableCell>
                  <TableCell>{formatDateDMYShort(o.order_date, '—')}</TableCell>
                  <TableCell align="right">
                    {canEditOrders && o.status === 'draft' ? (
                      <Button size="small" variant="outlined" component={Link} to={`/orders/${encodeURIComponent(o.id)}/edit`}>
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography color="text.secondary">No orders.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </section>

      <section
        id="quotes"
        style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, scrollMarginTop: 88 }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Quotes</h2>
          {canEdit && (
            <Button size="small" variant="contained" component={Link} to={`/quotes/new?customerId=${encodeURIComponent(customer.id)}`}>
              Create quote
            </Button>
          )}
        </Box>
        {relErr && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {relErr}
          </Alert>
        )}
        {deleteQuoteErr ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteQuoteErr(null)}>
            {deleteQuoteErr}
          </Alert>
        ) : null}
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Created</TableCell>
                <TableCell>Product type</TableCell>
                <TableCell>Price/kg</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id} hover>
                  <TableCell>{q.created_at ? new Date(q.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}</TableCell>
                  <TableCell>{(q.payload?.product_type as string) || '-'}</TableCell>
                  <TableCell>
                    {q.price_per_kg != null && Number.isFinite(Number(q.price_per_kg))
                      ? `$${Number(q.price_per_kg).toFixed(2)}`
                      : '-'}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit ? (
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Button size="small" variant="outlined" component={Link} to={`/quotes/${encodeURIComponent(q.id)}/edit`}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={deletingQuoteId === q.id}
                          onClick={() => void onDeleteQuote(q.id)}
                        >
                          {deletingQuoteId === q.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </Box>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {quotes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No quotes.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </section>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Addresses</h2>
        {addresses.length > 0 ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {addresses.map((a: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: 16,
                  background: '#f9fafb',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{formatDeliveryAddressDisplay(a)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <span style={{ padding: '4px 8px', background: '#e5e7eb', borderRadius: 4, fontSize: '0.75rem' }}>
                      {String(a.address_type || a.type || 'STREET').toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#9ca3af' }}>No addresses registered.</p>
        )}
      </section>

      {prefs && Object.keys(prefs).length > 0 && (
        <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Delivery Preferences</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {prefs.preferred_pallet_type && (
              <div>
                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Preferred Pallet Type</strong>
                <p style={{ margin: '4px 0 0' }}>{prefs.preferred_pallet_type}</p>
              </div>
            )}
            {prefs.preferred_transport_company && (
              <div>
                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Preferred Transport Company</strong>
                <p style={{ margin: '4px 0 0' }}>{prefs.preferred_transport_company}</p>
              </div>
            )}
            {prefs.special_instructions && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Special Instructions</strong>
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{prefs.special_instructions}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          mt: 3,
          pt: 3,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button component={Link} to="/customers" variant="text" color="primary">
          Back to Customers
        </Button>
        {canEdit && deleteCustomerErr ? (
          <Typography variant="caption" color="error" sx={{ textAlign: 'right', maxWidth: 480 }}>
            {deleteCustomerErr}
          </Typography>
        ) : canEdit && !canDeleteCustomer ? (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', maxWidth: 480 }}>
            This customer cannot be deleted because they have
            {Number(customer.orders_count || 0) > 0
              ? ` ${customer.orders_count} order${Number(customer.orders_count) !== 1 ? 's' : ''}`
              : ''}
            {Number(customer.orders_count || 0) > 0 && Number(customer.quotes_count || 0) > 0 ? ' and' : ''}
            {Number(customer.quotes_count || 0) > 0
              ? ` ${customer.quotes_count} quote${Number(customer.quotes_count) !== 1 ? 's' : ''}`
              : ''}
            .
          </Typography>
        ) : canEdit && canDeleteCustomer ? (
          <Button
            variant="outlined"
            color="error"
            disabled={deletingCustomer}
            onClick={() => void onDeleteCustomer()}
          >
            {deletingCustomer ? 'Deleting…' : 'Delete customer'}
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}


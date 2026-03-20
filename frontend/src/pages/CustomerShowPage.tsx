import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import { fetchCustomer } from '../store/slices/customersSlice'
import { apiFetch } from '../api/client'
import { Alert, Box, Button, Paper, Typography, Link as MuiLink, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'

type ProductRow = {
  id: string
  code: string
  description?: string | null
  active_version_id?: string | null
  product_type?: string | null
  pack_mode?: string | null
}

type OrderRow = {
  id: string
  code: string
  status: string
  product_code?: string | null
  version_number?: number | null
  item_count?: number | null
  created_at?: string | null
}

type QuoteRow = {
  id: string
  customer_id: string
  payload: Record<string, unknown>
  cost_per_kg?: number | null
  price_per_kg?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export function CustomerShowPage() {
  const { customerId } = useParams()
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const canEditOrders = canEdit

  const entry = useAppSelector((s) => (customerId ? s.customers.detail.byId[customerId] : undefined))
  const customer = entry?.customer || null
  const err = entry?.error || null

  const [products, setProducts] = useState<ProductRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [relErr, setRelErr] = useState<string | null>(null)

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!customerId) return
    void (async () => {
      try {
        setRelErr(null)
        const [pRes, oRes, qRes] = await Promise.all([
          apiFetch<{ items: ProductRow[] }>(`/api/products?customer_id=${encodeURIComponent(customerId)}`),
          apiFetch<OrderRow[]>(`/api/orders?customer_id=${encodeURIComponent(customerId)}`),
          apiFetch<QuoteRow[]>(`/api/quotes/saved?customer_id=${encodeURIComponent(customerId)}`),
        ])
        setProducts(pRes.items || [])
        setOrders(oRes || [])
        setQuotes(Array.isArray(qRes) ? qRes : [])
      } catch (e) {
        setRelErr(e instanceof Error ? e.message : 'Failed to load related records')
      }
    })()
  }, [customerId])

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
          <Typography variant="body2" color="text.secondary">
            Code: {customer.code} • Status: {customer.status}
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
            Status
          </h3>
          <span>{customer.status}</span>
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
              <strong>{quotes.length}</strong> Quotes
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
          {customer.payment_terms && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Payment Terms</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.payment_terms}</p>
            </div>
          )}
          {customer.deposit_required && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Deposit Required</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.deposit_pct != null ? `${customer.deposit_pct}%` : 'Yes'}</p>
            </div>
          )}
        </div>
        {customer.notes && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Notes</strong>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{customer.notes}</p>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Contacts</h2>
        {contacts.length > 0 ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {contacts.map((c: any, idx: number) => (
              <div key={idx} style={{ padding: 16, background: '#f9fafb', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{c.name}</h3>
                  <span style={{ padding: '4px 8px', background: '#e5e7eb', borderRadius: 4, fontSize: '0.75rem' }}>
                    {c.type}
                  </span>
                </div>
                {c.title && <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '0.875rem' }}>{c.title}</p>}
                <div style={{ marginTop: 8 }}>
                  <p style={{ margin: '4px 0' }}>
                    <strong>Email:</strong>{' '}
                    <MuiLink href={`mailto:${c.email}`} underline="hover">
                      {c.email}
                    </MuiLink>
                  </p>
                  {c.phone && (
                    <p style={{ margin: '4px 0' }}>
                      <strong>Phone:</strong> {c.phone}
                    </p>
                  )}
                  {c.phone_alt && (
                    <p style={{ margin: '4px 0' }}>
                      <strong>Alt Phone:</strong> {c.phone_alt}
                    </p>
                  )}
                  {c.notes && <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '0.875rem' }}>{c.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#9ca3af' }}>No contacts registered.</p>
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

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
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
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <MuiLink component={Link} to={`/orders/${o.id}`} underline="hover">
                      {o.code}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{o.status}</TableCell>
                  <TableCell>
                    {o.product_code
                      ? `${o.product_code}${o.version_number != null ? ` v${o.version_number}` : ''}${o.item_count && o.item_count > 1 ? ` (+${o.item_count - 1})` : ''}`
                      : '-'}
                  </TableCell>
                  <TableCell>{o.created_at || ''}</TableCell>
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

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
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
                      <Button size="small" variant="outlined" component={Link} to={`/quotes/${encodeURIComponent(q.id)}/edit`}>
                        Edit
                      </Button>
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
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Delivery Addresses</h2>
        {addresses.length > 0 ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {addresses.map((a: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: 16,
                  background: '#f9fafb',
                  borderRadius: 6,
                  border: a.is_default ? '2px solid #2563eb' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{a.label}</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {a.is_default && (
                      <span style={{ padding: '4px 8px', background: '#2563eb', color: 'white', borderRadius: 4, fontSize: '0.75rem' }}>
                        Default
                      </span>
                    )}
                    <span style={{ padding: '4px 8px', background: '#e5e7eb', borderRadius: 4, fontSize: '0.75rem' }}>
                      {a.type}
                    </span>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <p style={{ margin: '4px 0' }}>
                    {a.street1}
                    {a.street2 ? `, ${a.street2}` : ''}
                    <br />
                    {a.suburb}, {a.state} {a.postcode}
                    <br />
                    {a.country}
                  </p>
                  {(a.contact_name || a.contact_phone) && (
                    <p style={{ margin: '8px 0 4px', color: '#6b7280', fontSize: '0.875rem' }}>
                      <strong>Contact:</strong> {a.contact_name || ''}
                      {a.contact_phone ? ` - ${a.contact_phone}` : ''}
                    </p>
                  )}
                  {a.delivery_instructions && (
                    <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
                      <strong>Instructions:</strong> {a.delivery_instructions}
                    </p>
                  )}
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

      <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button component={Link} to="/customers" variant="text" color="primary">
          Back to Customers
        </Button>
      </Box>
    </Box>
  )
}


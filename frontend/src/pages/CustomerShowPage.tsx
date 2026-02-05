import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import { fetchCustomer } from '../store/slices/customersSlice'
import { Alert, Box, Button, Paper, Typography, Link as MuiLink } from '@mui/material'

export function CustomerShowPage() {
  const { customerId } = useParams()
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')

  const entry = useAppSelector((s) => (customerId ? s.customers.detail.byId[customerId] : undefined))
  const customer = entry?.customer || null
  const err = entry?.error || null

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, dispatch])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Customer
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to="/customers" variant="outlined">
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
            Status: {customer.status} • Currency: {customer.currency_preference}
          </Typography>
        </Box>
        {canEdit && (
          <Button variant="contained" component={Link} to={`/customers/${customer.id}/edit`}>
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
          </div>
        </Paper>
      </div>

      <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Basic Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Customer Name</strong>
            <p style={{ margin: '4px 0 0' }}>{customer.name}</p>
          </div>
          {customer.abn && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>ABN</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.abn}</p>
            </div>
          )}
          {customer.tax_id && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Tax ID</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.tax_id}</p>
            </div>
          )}
          {customer.payment_terms && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Payment Terms</strong>
              <p style={{ margin: '4px 0 0' }}>{customer.payment_terms}</p>
            </div>
          )}
          {customer.credit_limit != null && (
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Credit Limit</strong>
              <p style={{ margin: '4px 0 0' }}>${customer.credit_limit.toFixed(2)}</p>
            </div>
          )}
          <div>
            <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Currency Preference</strong>
            <p style={{ margin: '4px 0 0' }}>{customer.currency_preference}</p>
          </div>
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
                  <p style={{ margin: '4px 0' }}>
                    <strong>Phone:</strong> {c.phone}
                    {c.phone_alt ? ` / ${c.phone_alt}` : ''}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>Preferred Method:</strong> {c.preferred_method}
                  </p>
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
            <div>
              <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Preferred Wrapping</strong>
              <p style={{ margin: '4px 0 0' }}>{prefs.preferred_wrapping ? 'Required' : 'Not Required'}</p>
            </div>
            {prefs.special_instructions && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Special Instructions</strong>
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{prefs.special_instructions}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {customer.internal_notes && canEdit && (
        <section style={{ marginBottom: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fef3c7' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 600 }}>Internal Notes</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#92400e' }}>{customer.internal_notes}</p>
        </section>
      )}

      <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button component={Link} to="/customers" variant="outlined">
          Back to Customers
        </Button>
      </Box>
    </Box>
  )
}


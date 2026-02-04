import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

type CustomerDetail = {
  id: string
  code: string
  name: string
  status: string
  abn?: string | null
  tax_id?: string | null
  payment_terms?: string | null
  credit_limit?: number | null
  currency_preference: string
  notes?: string | null
  internal_notes?: string | null
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
}

export function CustomerEditPage() {
  const { customerId } = useParams()
  const nav = useNavigate()
  const csrf = useAppSelector((s) => s.auth.csrfToken)

  const [loaded, setLoaded] = useState<CustomerDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state (must be declared unconditionally for hooks rules)
  const [name, setName] = useState('')
  const [abn, setAbn] = useState('')
  const [taxId, setTaxId] = useState('')
  const [statusValue, setStatusValue] = useState('Active')
  const [contacts, setContacts] = useState<any[]>([])
  const [addresses, setAddresses] = useState<any[]>([])
  const [prefs, setPrefs] = useState<any>({})
  const [paymentTerms, setPaymentTerms] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [currencyPreference, setCurrencyPreference] = useState('AUD')
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  useEffect(() => {
    if (!customerId) return
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<{ customer: CustomerDetail }>(`/api/customers/${customerId}`)
        setLoaded(res.customer)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load customer')
      }
    })()
  }, [customerId])

  useEffect(() => {
    if (!loaded) return
    setName(loaded.name)
    setAbn(loaded.abn || '')
    setTaxId(loaded.tax_id || '')
    setStatusValue(loaded.status || 'Active')
    setContacts(loaded.contacts || [])
    setAddresses(loaded.delivery_addresses || [])
    setPrefs(loaded.delivery_preferences || {})
    setPaymentTerms(loaded.payment_terms || '')
    setCreditLimit(loaded.credit_limit != null ? String(loaded.credit_limit) : '')
    setCurrencyPreference(loaded.currency_preference || 'AUD')
    setNotes(loaded.notes || '')
    setInternalNotes(loaded.internal_notes || '')
  }, [loaded])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Edit Customer
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

  if (!loaded) return <p>Loading…</p>

  function setDefaultAddress(i: number) {
    setAddresses((prev) => prev.map((a, idx) => ({ ...a, is_default: idx === i })))
  }

  async function submit() {
    if (!customerId) return
    setErr(null)
    setSaving(true)
    try {
      const payload = {
        name,
        abn: abn || null,
        tax_id: taxId || null,
        status: statusValue,
        contacts,
        delivery_addresses: addresses,
        delivery_preferences: prefs,
        payment_terms: paymentTerms || null,
        credit_limit: creditLimit ? Number(creditLimit) : null,
        currency_preference: currencyPreference,
        notes: notes || null,
        internal_notes: internalNotes || null,
      }
      await apiFetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        csrfToken: csrf || undefined,
        body: JSON.stringify(payload),
      })
      nav(`/customers/${customerId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Edit Customer
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Basic Information
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField label="Customer Name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
            <TextField label="ABN" value={abn} onChange={(e) => setAbn(e.currentTarget.value)} />
            <TextField label="Tax ID" value={taxId} onChange={(e) => setTaxId(e.currentTarget.value)} />
            <TextField select label="Status" value={statusValue} onChange={(e) => setStatusValue(e.currentTarget.value)}>
              <MenuItem value="Active">Active</MenuItem>
              <MenuItem value="Inactive">Inactive</MenuItem>
              <MenuItem value="Archived">Archived</MenuItem>
            </TextField>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Contacts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            At least one contact is required.
          </Typography>
          <Box component="pre" sx={{ m: 0, mt: 2, overflowX: 'auto', fontSize: 12 }}>
            {JSON.stringify(contacts, null, 2)}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This editor will be upgraded next to the same interactive form as “New Customer”.
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Delivery Addresses
          </Typography>
          <Typography variant="body2" color="text.secondary">
            At least one address is required. Mark one as default.
          </Typography>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {addresses.map((a, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {a.label}
                  </Typography>
                  <FormControlLabel
                    control={<Checkbox checked={!!a.is_default} onChange={() => setDefaultAddress(idx)} />}
                    label="Default"
                  />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {a.street1}, {a.suburb} {a.state} {a.postcode}
                </Typography>
              </Paper>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Delivery Preferences
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField
              select
              label="Preferred Pallet Type"
              value={prefs.preferred_pallet_type || 'Plain'}
              onChange={(e) => setPrefs((p: any) => ({ ...p, preferred_pallet_type: e.currentTarget.value }))}
            >
              {['Plain', 'Chep', 'Resin', 'None'].map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Preferred Transport Company"
              value={prefs.preferred_transport_company || ''}
              onChange={(e) => setPrefs((p: any) => ({ ...p, preferred_transport_company: e.currentTarget.value }))}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={prefs.preferred_wrapping ?? true}
                  onChange={(e) => setPrefs((p: any) => ({ ...p, preferred_wrapping: e.currentTarget.checked }))}
                />
              }
              label="Preferred Wrapping Required"
            />
            <TextField
              label="Special Delivery Instructions"
              value={prefs.special_instructions || ''}
              onChange={(e) => setPrefs((p: any) => ({ ...p, special_instructions: e.currentTarget.value }))}
              multiline
              minRows={3}
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Additional Information
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField label="Payment Terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.currentTarget.value)} />
            <TextField
              label="Credit Limit"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.currentTarget.value)}
            />
            <TextField select label="Currency Preference" value={currencyPreference} onChange={(e) => setCurrencyPreference(e.currentTarget.value)}>
              <MenuItem value="AUD">AUD</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
            </TextField>
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} multiline minRows={3} />
            <TextField label="Internal Notes" value={internalNotes} onChange={(e) => setInternalNotes(e.currentTarget.value)} multiline minRows={3} />
          </Box>
        </Paper>

        <Divider />

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Update Customer'}
          </Button>
          <Button variant="outlined" component={Link} to={`/customers/${loaded.id}`}>
            Cancel
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}


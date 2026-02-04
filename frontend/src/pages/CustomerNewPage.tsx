import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

type Contact = {
  type: string
  name: string
  title?: string | null
  email: string
  phone: string
  phone_alt?: string | null
  preferred_method: string
  notes?: string | null
}

type Address = {
  label: string
  type: string
  street1: string
  street2?: string | null
  suburb: string
  state: string
  postcode: string
  country: string
  contact_name?: string | null
  contact_phone?: string | null
  delivery_instructions?: string | null
  is_default: boolean
}

type DeliveryPrefs = {
  preferred_pallet_type: string
  preferred_transport_company?: string | null
  preferred_wrapping: boolean
  special_instructions?: string | null
}

export function CustomerNewPage() {
  const nav = useNavigate()
  const csrf = useAppSelector((s) => s.auth.csrfToken)

  const [name, setName] = useState('')
  const [abn, setAbn] = useState('')
  const [taxId, setTaxId] = useState('')
  const [status, setStatus] = useState<'Active' | 'Inactive' | 'Archived'>('Active')

  const [contacts, setContacts] = useState<Contact[]>([
    {
      type: 'Primary Contact',
      name: '',
      title: '',
      email: '',
      phone: '',
      phone_alt: '',
      preferred_method: 'Email',
      notes: '',
    },
  ])
  const [addresses, setAddresses] = useState<Address[]>([
    {
      label: 'Head Office',
      type: 'Delivery',
      street1: '',
      street2: '',
      suburb: '',
      state: 'NSW',
      postcode: '',
      country: 'Australia',
      contact_name: '',
      contact_phone: '',
      delivery_instructions: '',
      is_default: true,
    },
  ])

  const [preferredPalletType, setPreferredPalletType] = useState('Plain')
  const [preferredTransportCompany, setPreferredTransportCompany] = useState('')
  const [preferredWrapping, setPreferredWrapping] = useState(true)
  const [specialInstructions, setSpecialInstructions] = useState('')

  const [paymentTerms, setPaymentTerms] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [currencyPreference, setCurrencyPreference] = useState('AUD')
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setDefaultAddress(i: number) {
    setAddresses((prev) => prev.map((a, idx) => ({ ...a, is_default: idx === i })))
  }

  async function submit() {
    setErr(null)
    setSaving(true)
    try {
      const payload = {
        name,
        abn: abn || null,
        tax_id: taxId || null,
        status,
        contacts: contacts.map((c) => ({
          ...c,
          title: c.title || null,
          phone_alt: c.phone_alt || null,
          notes: c.notes || null,
        })),
        delivery_addresses: addresses.map((a) => ({
          ...a,
          street2: a.street2 || null,
          contact_name: a.contact_name || null,
          contact_phone: a.contact_phone || null,
          delivery_instructions: a.delivery_instructions || null,
        })),
        delivery_preferences: {
          preferred_pallet_type: preferredPalletType,
          preferred_transport_company: preferredTransportCompany || null,
          preferred_wrapping: preferredWrapping,
          special_instructions: specialInstructions || null,
        } satisfies DeliveryPrefs,
        payment_terms: paymentTerms || null,
        credit_limit: creditLimit ? Number(creditLimit) : null,
        currency_preference: currencyPreference,
        notes: notes || null,
        internal_notes: internalNotes || null,
      }
      const res = await apiFetch<{ ok: boolean; customer: { id: string } }>('/api/customers', {
        method: 'POST',
        csrfToken: csrf || undefined,
        body: JSON.stringify(payload),
      })
      nav(`/customers/${res.customer.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Customer
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
            <TextField select label="Status" value={status} onChange={(e) => setStatus(e.currentTarget.value as any)}>
              <MenuItem value="Active">Active</MenuItem>
              <MenuItem value="Inactive">Inactive</MenuItem>
              <MenuItem value="Archived">Archived</MenuItem>
            </TextField>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6">Contacts</Typography>
              <Typography variant="body2" color="text.secondary">
                At least one contact is required.
              </Typography>
            </Box>
            <Button
              variant="contained"
              type="button"
              onClick={() =>
                setContacts((prev) => [
                  ...prev,
                  { type: 'Other', name: '', email: '', phone: '', preferred_method: 'Email', title: '', phone_alt: '', notes: '' },
                ])
              }
            >
              Add Contact
            </Button>
          </Box>

          <Stack spacing={2} sx={{ mt: 2 }}>
            {contacts.map((c, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Contact {idx + 1}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    type="button"
                    onClick={() => {
                      if (contacts.length <= 1) return setErr('At least one contact is required')
                      setContacts((prev) => prev.filter((_, i) => i !== idx))
                    }}
                  >
                    Remove
                  </Button>
                </Box>

                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
                  <TextField
                    select
                    label="Contact Type"
                    value={c.type}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)))}
                  >
                    {['Primary Contact', 'Accounts', 'Purchasing', 'Operations', 'Other'].map((t) => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Full Name"
                    value={c.name}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                  />
                  <TextField
                    label="Job Title"
                    value={c.title || ''}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                  />
                  <TextField
                    label="Email"
                    value={c.email}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, email: e.target.value } : x)))}
                  />
                  <TextField
                    label="Phone"
                    value={c.phone}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, phone: e.target.value } : x)))}
                  />
                  <TextField
                    label="Phone Alternate"
                    value={c.phone_alt || ''}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, phone_alt: e.target.value } : x)))}
                  />
                  <TextField
                    select
                    label="Preferred Method"
                    value={c.preferred_method}
                    onChange={(e) =>
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, preferred_method: e.target.value } : x)))
                    }
                  >
                    <MenuItem value="Email">Email</MenuItem>
                    <MenuItem value="Phone">Phone</MenuItem>
                  </TextField>
                  <TextField
                    label="Notes"
                    value={c.notes || ''}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, notes: e.target.value } : x)))}
                    multiline
                    minRows={2}
                  />
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6">Delivery Addresses</Typography>
              <Typography variant="body2" color="text.secondary">
                At least one address is required. Mark one as default.
              </Typography>
            </Box>
            <Button
              variant="contained"
              type="button"
              onClick={() =>
                setAddresses((prev) => [
                  ...prev.map((x) => ({ ...x, is_default: false })),
                  {
                    label: `Address ${prev.length + 1}`,
                    type: 'Delivery',
                    street1: '',
                    street2: '',
                    suburb: '',
                    state: 'NSW',
                    postcode: '',
                    country: 'Australia',
                    contact_name: '',
                    contact_phone: '',
                    delivery_instructions: '',
                    is_default: true,
                  },
                ])
              }
            >
              Add Address
            </Button>
          </Box>

          <Stack spacing={2} sx={{ mt: 2 }}>
            {addresses.map((a, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {a.label || `Address ${idx + 1}`}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <FormControlLabel
                      control={<Checkbox checked={a.is_default} onChange={() => setDefaultAddress(idx)} />}
                      label="Default"
                    />
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      type="button"
                      onClick={() => {
                        if (addresses.length <= 1) return setErr('At least one address is required')
                        setAddresses((prev) => prev.filter((_, i) => i !== idx))
                        setTimeout(() => setDefaultAddress(0), 0)
                      }}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>

                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
                  <TextField
                    label="Address Label/Name"
                    value={a.label}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <TextField
                    select
                    label="Address Type"
                    value={a.type}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)))
                    }
                  >
                    {['Billing', 'Delivery', 'Both'].map((t) => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Street Address"
                    value={a.street1}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, street1: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Street Address Line 2"
                    value={a.street2 || ''}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, street2: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Suburb"
                    value={a.suburb}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, suburb: e.target.value } : x)))
                    }
                  />
                  <TextField
                    select
                    label="State"
                    value={a.state}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, state: e.target.value } : x)))
                    }
                  >
                    {['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].map((s) => (
                      <MenuItem key={s} value={s}>
                        {s}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Postcode"
                    value={a.postcode}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, postcode: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Country"
                    value={a.country}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, country: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Contact Name"
                    value={a.contact_name || ''}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, contact_name: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Contact Phone"
                    value={a.contact_phone || ''}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, contact_phone: e.target.value } : x)))
                    }
                  />
                  <TextField
                    label="Delivery Instructions"
                    value={a.delivery_instructions || ''}
                    onChange={(e) =>
                      setAddresses((p) =>
                        p.map((x, i) => (i === idx ? { ...x, delivery_instructions: e.target.value } : x)),
                      )
                    }
                    multiline
                    minRows={2}
                  />
                </Box>
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
              value={preferredPalletType}
              onChange={(e) => setPreferredPalletType(e.currentTarget.value)}
            >
              {['Plain', 'Chep', 'Resin', 'None'].map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Preferred Transport Company"
              value={preferredTransportCompany}
              onChange={(e) => setPreferredTransportCompany(e.currentTarget.value)}
            />
            <FormControlLabel
              control={<Checkbox checked={preferredWrapping} onChange={(e) => setPreferredWrapping(e.currentTarget.checked)} />}
              label="Preferred Wrapping Required"
            />
            <TextField
              label="Special Delivery Instructions"
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.currentTarget.value)}
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
            <TextField
              label="Payment Terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.currentTarget.value)}
              placeholder="e.g., Net 30"
            />
            <TextField
              label="Credit Limit"
              type="number"
              inputProps={{ min: 0, step: 0.01 }}
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.currentTarget.value)}
            />
            <TextField
              select
              label="Currency Preference"
              value={currencyPreference}
              onChange={(e) => setCurrencyPreference(e.currentTarget.value)}
            >
              <MenuItem value="AUD">AUD</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
            </TextField>
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} multiline minRows={3} />
            <TextField
              label="Internal Notes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.currentTarget.value)}
              multiline
              minRows={3}
            />
          </Box>
        </Paper>

        <Divider />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Create Customer'}
        </Button>
        <Button variant="outlined" component={Link} to="/customers">
          Cancel
        </Button>
        </Box>
      </Stack>
    </Box>
  )
}


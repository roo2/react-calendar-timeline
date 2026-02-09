import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { clearUpsertErrors, clearUpsertFieldError, createCustomer, fetchCustomer, updateCustomer } from '../store/slices/customersSlice'
import { FormErrorAlert } from '../components/FormErrorAlert'
import {
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

type CustomerDetail = {
  id: string
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

function coerceContact(x: any): Contact {
  return {
    type: String(x?.type ?? 'Other'),
    name: String(x?.name ?? ''),
    title: x?.title ?? '',
    email: String(x?.email ?? ''),
    phone: String(x?.phone ?? ''),
    phone_alt: x?.phone_alt ?? '',
    preferred_method: String(x?.preferred_method ?? 'Email'),
    notes: x?.notes ?? '',
  }
}

function coerceAddress(x: any, fallbackLabel: string): Address {
  return {
    label: String(x?.label ?? fallbackLabel),
    type: String(x?.type ?? 'Delivery'),
    street1: String(x?.street1 ?? ''),
    street2: x?.street2 ?? '',
    suburb: String(x?.suburb ?? ''),
    state: String(x?.state ?? 'NSW'),
    postcode: String(x?.postcode ?? ''),
    country: String(x?.country ?? 'Australia'),
    contact_name: x?.contact_name ?? '',
    contact_phone: x?.contact_phone ?? '',
    delivery_instructions: x?.delivery_instructions ?? '',
    is_default: Boolean(x?.is_default ?? false),
  }
}

export function CustomerUpsertPage() {
  const { customerId } = useParams()
  const isEdit = !!customerId
  const nav = useNavigate()
  const dispatch = useAppDispatch()

  const detailEntry = useAppSelector((s) => (customerId ? s.customers.detail.byId[customerId] : undefined))
  const upsert = useAppSelector((s) => s.customers.upsert)
  const loading = isEdit ? detailEntry?.status === 'loading' : false

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

  const [localErr, setLocalErr] = useState<string | null>(null)

  const fieldErrors = upsert.fieldErrors
  const errorSummary = upsert.messages
  const err = upsert.error
  const saving = upsert.status === 'loading'

  function clearFieldError(key: string) {
    dispatch(clearUpsertFieldError(key))
  }

  function setDefaultAddress(i: number) {
    setAddresses((prev) => prev.map((a, idx) => ({ ...a, is_default: idx === i })))
  }

  // Load initial values in edit mode.
  const [hydratedId, setHydratedId] = useState<string | null>(null)

  useEffect(() => {
    // Reset upsert errors when switching between create/edit.
    dispatch(clearUpsertErrors())
    setLocalErr(null)
    setHydratedId(null)
  }, [dispatch, customerId])

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!customerId) return
    const c = detailEntry?.customer as CustomerDetail | undefined
    if (!c) return
    if (hydratedId === customerId) return

    setName(c.name ?? '')
    setAbn(c.abn || '')
    setTaxId(c.tax_id || '')
    setStatus((c.status as any) || 'Active')

    const loadedContacts = Array.isArray(c.contacts) ? c.contacts.map(coerceContact) : []
    setContacts(loadedContacts.length > 0 ? loadedContacts : contacts)

    const loadedAddresses = Array.isArray(c.delivery_addresses)
      ? c.delivery_addresses.map((a, idx) => coerceAddress(a, `Address ${idx + 1}`))
      : []
    const normalizedAddresses = loadedAddresses.length > 0 ? loadedAddresses : addresses
    if (normalizedAddresses.length > 0 && !normalizedAddresses.some((a) => a.is_default)) {
      normalizedAddresses[0] = { ...normalizedAddresses[0], is_default: true }
    }
    setAddresses(normalizedAddresses)

    const p = c.delivery_preferences || {}
    setPreferredPalletType(String(p.preferred_pallet_type ?? 'Plain'))
    setPreferredTransportCompany(String(p.preferred_transport_company ?? ''))
    setPreferredWrapping(Boolean(p.preferred_wrapping ?? true))
    setSpecialInstructions(String(p.special_instructions ?? ''))

    setPaymentTerms(c.payment_terms || '')
    setCreditLimit(c.credit_limit != null ? String(c.credit_limit) : '')
    setCurrencyPreference(c.currency_preference || 'AUD')
    setNotes(c.notes || '')
    setInternalNotes(c.internal_notes || '')

    setHydratedId(customerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailEntry?.customer, customerId, hydratedId])

  async function submit() {
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

      if (isEdit) {
        await dispatch(updateCustomer({ customerId: customerId!, data: payload })).unwrap()
        nav(`/customers/${customerId}`)
      } else {
        const res = await dispatch(createCustomer({ data: payload })).unwrap()
        nav(`/customers/${res.id}`)
      }
    } catch {
      // Errors are stored in the slice (including field-level validation).
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {isEdit ? 'Edit Customer' : 'New Customer'}
      </Typography>

      <FormErrorAlert error={err} messages={errorSummary} scrollOnShow={false} />

      {localErr && !err && (
        <FormErrorAlert error={localErr} scrollOnShow={false} />
      )}

      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Basic Information
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField
              label="Customer Name"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value)
                clearFieldError('name')
              }}
              required
              error={!!fieldErrors['name']}
              helperText={fieldErrors['name'] || ''}
            />
            <TextField label="ABN" value={abn} onChange={(e) => setAbn(e.currentTarget.value)} />
            <TextField label="Tax ID" value={taxId} onChange={(e) => setTaxId(e.currentTarget.value)} />
            <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}>
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
                      if (contacts.length <= 1) return setLocalErr('At least one contact is required')
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
                    onChange={(e) => {
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                      clearFieldError(`contacts[${idx}].name`)
                    }}
                    error={!!fieldErrors[`contacts[${idx}].name`]}
                    helperText={fieldErrors[`contacts[${idx}].name`] || ''}
                  />
                  <TextField
                    label="Job Title"
                    value={c.title || ''}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                  />
                  <TextField
                    label="Email"
                    value={c.email}
                    onChange={(e) => {
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, email: e.target.value } : x)))
                      clearFieldError(`contacts[${idx}].email`)
                    }}
                    error={!!fieldErrors[`contacts[${idx}].email`]}
                    helperText={fieldErrors[`contacts[${idx}].email`] || ''}
                  />
                  <TextField
                    label="Phone"
                    value={c.phone}
                    onChange={(e) => {
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, phone: e.target.value } : x)))
                      clearFieldError(`contacts[${idx}].phone`)
                    }}
                    error={!!fieldErrors[`contacts[${idx}].phone`]}
                    helperText={fieldErrors[`contacts[${idx}].phone`] || ''}
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
                        if (addresses.length <= 1) return setLocalErr('At least one address is required')
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
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                  />
                  <TextField
                    select
                    label="Address Type"
                    value={a.type}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)))}
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
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, street1: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].street1`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].street1`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].street1`] || ''}
                  />
                  <TextField
                    label="Street Address Line 2"
                    value={a.street2 || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, street2: e.target.value } : x)))}
                  />
                  <TextField
                    label="Suburb"
                    value={a.suburb}
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, suburb: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].suburb`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].suburb`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].suburb`] || ''}
                  />
                  <TextField
                    select
                    label="State"
                    value={a.state}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, state: e.target.value } : x)))}
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
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, postcode: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].postcode`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].postcode`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].postcode`] || ''}
                  />
                  <TextField
                    label="Country"
                    value={a.country}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, country: e.target.value } : x)))}
                  />
                  <TextField
                    label="Contact Name"
                    value={a.contact_name || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, contact_name: e.target.value } : x)))}
                  />
                  <TextField
                    label="Contact Phone"
                    value={a.contact_phone || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, contact_phone: e.target.value } : x)))}
                  />
                  <TextField
                    label="Delivery Instructions"
                    value={a.delivery_instructions || ''}
                    onChange={(e) =>
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, delivery_instructions: e.target.value } : x)))
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
              onChange={(e) => setCurrencyPreference(e.target.value as string)}
            >
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
            {saving ? 'Saving…' : isEdit ? 'Update Customer' : 'Create Customer'}
          </Button>
          <Button
            variant="outlined"
            component={Link}
            to={isEdit && customerId ? `/customers/${customerId}` : '/customers'}
          >
            Cancel
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}


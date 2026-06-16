import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { clearUpsertErrors, clearUpsertFieldError, createCustomer, fetchCustomer, updateCustomer } from '../../store/slices/customersSlice'
import { FormErrorAlert } from '../../components/FormErrorAlert'
import { SaveFormButton } from '../../components/SaveActionButtons'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { apiFetch } from '../../api/client'
import { xeroContactViewUrl } from '../../utils/xeroLinks'
import {
  PAYMENT_IS_DUE_OPTIONS,
  PAYMENT_IS_DUE_LABELS,
  describePaymentTerms,
  paymentTermNumericLabels,
} from '../../utils/paymentTermsDisplay'

type PaymentTermsForm = {
  payment_is_due: string
  balance_due_date: string
}

function emptyPaymentTermsForm(): PaymentTermsForm {
  return { payment_is_due: '', balance_due_date: '' }
}

function paymentTermsFromApi(raw: unknown): PaymentTermsForm {
  if (raw == null) return emptyPaymentTermsForm()
  if (typeof raw === 'string') return emptyPaymentTermsForm()
  if (typeof raw !== 'object' || Array.isArray(raw)) return emptyPaymentTermsForm()
  const o = raw as Record<string, unknown>
  return {
    payment_is_due: typeof o.payment_is_due === 'string' ? o.payment_is_due : '',
    balance_due_date: o.balance_due_date != null && o.balance_due_date !== '' ? String(o.balance_due_date) : '',
  }
}

function paymentTermsToPayload(form: PaymentTermsForm): Record<string, unknown> | null {
  const due = (form.payment_is_due || '').trim()
  if (!due) return null
  const out: Record<string, unknown> = { payment_is_due: due }
  if (form.balance_due_date.trim() !== '') {
    const n = Number(form.balance_due_date)
    if (Number.isFinite(n)) out.balance_due_date = n
  }
  return out
}

type Contact = {
  first_name: string
  last_name: string
  email_address: string
  include_in_emails: boolean
}

type Phone = {
  phone_type: string
  phone_country_code: string
  phone_area_code: string
  phone_number: string
}

const PHONE_TYPES = [
  { value: 'DEFAULT', label: 'Default' },
  { value: 'MOBILE', label: 'Mobile' },
  { value: 'DDI', label: 'Direct (DDI)' },
  { value: 'FAX', label: 'Fax' },
] as const

type Address = {
  address_type: string
  address_line1: string
  address_line2?: string | null
  address_line3?: string | null
  address_line4?: string | null
  city: string
  region: string
  postal_code: string
  country: string
  attention_to?: string | null
}

type DeliveryPrefs = {
  preferred_pallet_type: string
  preferred_transport_company?: string | null
  special_instructions?: string | null
}

type CustomerDetail = {
  id: string
  name: string
  brand_id?: string | null
  brand_code?: string | null
  brand_name?: string | null
  priority_rank?: number | null
  status: string
  abn?: string | null
  contact_phone?: string | null
  phones?: any[]
  contact_first_name?: string | null
  contact_last_name?: string | null
  email_address?: string | null
  payment_terms?: Record<string, unknown> | string | null
  credit_limit?: number | null
  notes?: string | null
  internal_notes?: string | null
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
  xero_contact_id?: string | null
}

type BrandOption = {
  id: string
  code: string
  name: string
}

type PricingTierOption = {
  id: string
  name: string
  discount_percent: number
}

function mapPhone(x: any): Phone {
  return {
    phone_type: String(x?.phone_type ?? 'DEFAULT').toUpperCase(),
    phone_country_code: String(x?.phone_country_code ?? ''),
    phone_area_code: String(x?.phone_area_code ?? ''),
    phone_number: String(x?.phone_number ?? ''),
  }
}

function emptyPhone(phoneType = 'DEFAULT'): Phone {
  return {
    phone_type: phoneType,
    phone_country_code: '',
    phone_area_code: '',
    phone_number: '',
  }
}

function mapContact(x: any): Contact {
  return {
    first_name: String(x?.first_name ?? ''),
    last_name: String(x?.last_name ?? ''),
    email_address: String(x?.email_address ?? ''),
    include_in_emails: x?.include_in_emails !== false,
  }
}

function mapAddress(x: any): Address {
  return {
    address_type: String(x?.address_type ?? 'STREET').toUpperCase() as Address['address_type'],
    address_line1: String(x?.address_line1 ?? ''),
    address_line2: x?.address_line2 ?? '',
    address_line3: x?.address_line3 ?? '',
    address_line4: x?.address_line4 ?? '',
    city: String(x?.city ?? ''),
    region: String(x?.region ?? 'NSW'),
    postal_code: String(x?.postal_code ?? ''),
    country: String(x?.country ?? 'Australia'),
    attention_to: x?.attention_to ?? '',
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
  const [brandId, setBrandId] = useState('')
  const [priorityRank, setPriorityRank] = useState('')
  const [contactPhones, setContactPhones] = useState<Phone[]>([])
  const [contactFirstName, setContactFirstName] = useState('')
  const [contactLastName, setContactLastName] = useState('')
  const [emailAddress, setEmailAddress] = useState('')
  const [status, setStatus] = useState<'Active' | 'Inactive' | 'Archived'>('Active')
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([])
  const [pricingTierOptions, setPricingTierOptions] = useState<PricingTierOption[]>([])
  const [pricingTierId, setPricingTierId] = useState('')

  const [contacts, setContacts] = useState<Contact[]>([])
  const [addresses, setAddresses] = useState<Address[]>([
    {
      address_type: 'STREET',
      address_line1: '',
      address_line2: '',
      address_line3: '',
      address_line4: '',
      city: '',
      region: 'NSW',
      postal_code: '',
      country: 'Australia',
      attention_to: '',
    },
  ])

  const [preferredPalletType, setPreferredPalletType] = useState('Plain')
  const [preferredTransportCompany, setPreferredTransportCompany] = useState('')
  const [specialInstructions, setSpecialInstructions] = useState('')

  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsForm>(() => emptyPaymentTermsForm())
  const [notes, setNotes] = useState('')
  const [xeroContactId, setXeroContactId] = useState('')

  const [localErr, setLocalErr] = useState<string | null>(null)

  const fieldErrors = upsert.fieldErrors
  const errorSummary = upsert.messages
  const err = upsert.error
  const saving = upsert.status === 'loading'
  const { setDirty } = useUnsavedChanges()

  const ptNumericLabels = useMemo(
    () => paymentTermNumericLabels(paymentTerms.payment_is_due),
    [paymentTerms.payment_is_due],
  )

  const brandLockedToXero = Boolean(xeroContactId.trim())

  const paymentTermsPreview = useMemo(() => {
    const payload = paymentTermsToPayload(paymentTerms)
    return describePaymentTerms(payload as Record<string, unknown> | null)
  }, [paymentTerms])

  function clearFieldError(key: string) {
    dispatch(clearUpsertFieldError(key))
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
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch<{ items: BrandOption[] }>('/api/customers/brands')
        if (!cancelled) setBrandOptions(res.items || [])
      } catch {
        if (!cancelled) setBrandOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch<PricingTierOption[]>('/api/customer-pricing-tiers')
        if (!cancelled) setPricingTierOptions(Array.isArray(res) ? res : [])
      } catch {
        if (!cancelled) setPricingTierOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!customerId) return
    const c = detailEntry?.customer as CustomerDetail | undefined
    if (!c) return
    if (hydratedId === customerId) return

    setName(c.name ?? '')
    setBrandId(c.brand_id ?? '')
    setPriorityRank(c.priority_rank != null ? String(c.priority_rank) : '')
    setAbn(c.abn || '')
    const loadedPhones = Array.isArray((c as CustomerDetail).phones)
      ? (c as CustomerDetail).phones!.map(mapPhone).filter((p) => p.phone_number.trim() || p.phone_area_code.trim())
      : []
    if (loadedPhones.length > 0) {
      setContactPhones(loadedPhones)
    } else if (c.contact_phone?.trim()) {
      setContactPhones([mapPhone({ phone_type: 'DEFAULT', phone_number: c.contact_phone.trim() })])
    } else {
      setContactPhones([])
    }
    setContactFirstName(String(c.contact_first_name ?? ''))
    setContactLastName(String(c.contact_last_name ?? ''))
    setEmailAddress(c.email_address || '')
    setStatus((c.status as any) || 'Active')

    const loadedContacts = Array.isArray(c.contacts) ? c.contacts.map(mapContact) : []
    setContacts(loadedContacts)

    const loadedAddresses = Array.isArray(c.delivery_addresses)
      ? c.delivery_addresses.map((a) => mapAddress(a))
      : []
    setAddresses(loadedAddresses.length > 0 ? loadedAddresses : addresses)

    const p = c.delivery_preferences || {}
    setPreferredPalletType(String(p.preferred_pallet_type ?? 'Plain'))
    setPreferredTransportCompany(String(p.preferred_transport_company ?? ''))
    setSpecialInstructions(String(p.special_instructions ?? ''))

    setPaymentTerms(paymentTermsFromApi(c.payment_terms))
    setNotes(c.notes || '')
    setXeroContactId((c as { xero_contact_id?: string | null }).xero_contact_id || '')
    setPricingTierId((c as { pricing_tier_id?: string | null }).pricing_tier_id || '')

    setHydratedId(customerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailEntry?.customer, customerId, hydratedId])

  async function submit() {
    try {
      const payload = {
        name,
        pricing_tier_id: pricingTierId.trim() || null,
        brand_id: brandId || null,
        priority_rank: priorityRank ? Number(priorityRank) : null,
        abn: abn || null,
        contact_first_name: contactFirstName.trim(),
        contact_last_name: contactLastName.trim(),
        email_address: emailAddress.trim() || null,
        phones: contactPhones
          .filter((p) => p.phone_number.trim() || p.phone_area_code.trim() || p.phone_country_code.trim())
          .map((p) => ({
            phone_type: p.phone_type,
            phone_country_code: p.phone_country_code.trim() || null,
            phone_area_code: p.phone_area_code.trim() || null,
            phone_number: p.phone_number.trim(),
          })),
        status,
        contacts: contacts.map((c) => ({
          first_name: c.first_name,
          last_name: c.last_name,
          email_address: c.email_address?.trim() || null,
          include_in_emails: c.include_in_emails,
        })),
        delivery_addresses: addresses.map((a) => ({
          address_type: a.address_type,
          address_line1: a.address_line1,
          address_line2: a.address_line2 || null,
          address_line3: a.address_line3 || null,
          address_line4: a.address_line4 || null,
          city: a.city,
          region: a.region,
          postal_code: a.postal_code,
          country: a.country,
          attention_to: a.attention_to || null,
        })),
        delivery_preferences: {
          preferred_pallet_type: preferredPalletType,
          preferred_transport_company: preferredTransportCompany || null,
          special_instructions: specialInstructions || null,
        } satisfies DeliveryPrefs,
        payment_terms: paymentTermsToPayload(paymentTerms),
        notes: notes || null,
        xero_contact_id: xeroContactId.trim() || null,
      }

      if (isEdit) {
        const res = await dispatch(updateCustomer({ customerId: customerId!, data: payload })).unwrap()
        setDirty(false)
        nav(`/customers/${customerId}`, { state: { xeroSync: res.xero_sync } })
      } else {
        const res = await dispatch(createCustomer({ data: payload })).unwrap()
        setDirty(false)
        nav(`/customers/${res.id}`, { state: { xeroSync: res.xero_sync } })
      }
    } catch {
      // Errors are stored in the slice (including field-level validation).
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <Box onChange={() => setDirty(true)}>
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
              label="Company Name"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value)
                clearFieldError('name')
              }}
              required
              error={!!fieldErrors['name']}
              helperText={fieldErrors['name'] || ''}
            />
            <Box>
              <TextField
                select
                label="Brand"
                value={brandId}
                onChange={(e) => {
                  setBrandId(e.target.value)
                  clearFieldError('brand_id')
                }}
                required
                disabled={brandLockedToXero}
                error={!!fieldErrors['brand_id']}
                helperText={
                  fieldErrors['brand_id'] ||
                  (brandLockedToXero
                    ? 'Synced from Xero (read-only). Use Sync from Xero or edit in Xero.'
                    : 'Required')
                }
                fullWidth
              >
                {brandOptions.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
              {brandLockedToXero ? (
                <MuiLink
                  href={xeroContactViewUrl(xeroContactId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                  sx={{ display: 'inline-block', mt: 0.5, fontSize: '0.875rem' }}
                >
                  Edit in Xero
                </MuiLink>
              ) : null}
            </Box>
            <TextField
              select
              label="Quote pricing tier"
              value={pricingTierId}
              onChange={(e) => {
                setPricingTierId(e.target.value)
                clearFieldError('pricing_tier_id')
              }}
              error={!!fieldErrors['pricing_tier_id']}
              helperText={
                fieldErrors['pricing_tier_id'] ||
                'Discount off retail list job total before optional price/kg overrides. Leave blank for list (retail) pricing.'
              }
            >
              <MenuItem value="">
                <em>Retail / list price (no tier)</em>
              </MenuItem>
              {pricingTierOptions.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                  {typeof t.discount_percent === 'number' && Number.isFinite(t.discount_percent) && t.discount_percent > 0
                    ? ` (${Number.isInteger(t.discount_percent) ? String(t.discount_percent) : t.discount_percent.toFixed(2)}% off)`
                    : t.discount_percent === 0
                      ? ' (list price)'
                      : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Priority Rank"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={priorityRank}
              onChange={(e) => {
                setPriorityRank(e.target.value)
                clearFieldError('priority_rank')
              }}
              helperText={fieldErrors['priority_rank'] || 'Lower number = higher priority (optional)'}
              error={!!fieldErrors['priority_rank']}
            />
            <TextField label="ABN" value={abn} onChange={(e) => setAbn(e.target.value)} />
            <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <MenuItem value="Active">Active</MenuItem>
              <MenuItem value="Inactive">Inactive</MenuItem>
              <MenuItem value="Archived">Archived</MenuItem>
            </TextField>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Primary contact
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Main contact person for this customer (Xero Contact first name, last name, and email).
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
            <TextField
              label="First Name"
              value={contactFirstName}
              onChange={(e) => {
                setContactFirstName(e.target.value)
                clearFieldError('contact_first_name')
              }}
              error={!!fieldErrors['contact_first_name']}
              helperText={fieldErrors['contact_first_name'] || ''}
            />
            <TextField
              label="Last Name"
              value={contactLastName}
              onChange={(e) => {
                setContactLastName(e.target.value)
                clearFieldError('contact_last_name')
              }}
              error={!!fieldErrors['contact_last_name']}
              helperText={fieldErrors['contact_last_name'] || ''}
            />
            <TextField
              label="Email"
              value={emailAddress}
              onChange={(e) => {
                setEmailAddress(e.target.value)
                clearFieldError('email_address')
              }}
              error={!!fieldErrors['email_address']}
              helperText={fieldErrors['email_address'] || ''}
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6">Phone numbers</Typography>
              <Typography variant="body2" color="text.secondary">
                Xero phone types: default, mobile, direct (DDI), and fax.
              </Typography>
            </Box>
            <Button
              variant="contained"
              type="button"
              onClick={() => setContactPhones((prev) => [...prev, emptyPhone()])}
            >
              Add phone
            </Button>
          </Box>

          <Stack spacing={2} sx={{ mt: 2 }}>
            {contactPhones.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No phone numbers.
              </Typography>
            ) : null}
            {contactPhones.map((p, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Phone {idx + 1}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    type="button"
                    onClick={() => setContactPhones((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </Box>
                <Box
                  sx={{
                    mt: 2,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 2,
                  }}
                >
                  <TextField
                    select
                    label="Type"
                    value={p.phone_type}
                    onChange={(e) =>
                      setContactPhones((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, phone_type: e.target.value } : row)),
                      )
                    }
                  >
                    {PHONE_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Country code"
                    value={p.phone_country_code}
                    onChange={(e) =>
                      setContactPhones((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, phone_country_code: e.target.value } : row)),
                      )
                    }
                  />
                  <TextField
                    label="Area code"
                    value={p.phone_area_code}
                    onChange={(e) =>
                      setContactPhones((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, phone_area_code: e.target.value } : row)),
                      )
                    }
                  />
                  <TextField
                    label="Number"
                    value={p.phone_number}
                    onChange={(e) =>
                      setContactPhones((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, phone_number: e.target.value } : row)),
                      )
                    }
                  />
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6">Additional contacts</Typography>
              <Typography variant="body2" color="text.secondary">
                Extra contact people synced to Xero ContactPersons.
              </Typography>
            </Box>
            <Button
              variant="contained"
              type="button"
              onClick={() =>
                setContacts((prev) => [
                  ...prev,
                  { first_name: '', last_name: '', email_address: '', include_in_emails: true },
                ])
              }
            >
              Add Contact
            </Button>
          </Box>

          <Stack spacing={2} sx={{ mt: 2 }}>
            {contacts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No additional contact people.
              </Typography>
            ) : null}
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
                      setContacts((prev) => prev.filter((_, i) => i !== idx))
                    }}
                  >
                    Remove
                  </Button>
                </Box>

                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
                  <TextField
                    label="First Name"
                    value={c.first_name}
                    onChange={(e) => {
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, first_name: e.target.value } : x)))
                      clearFieldError(`contacts[${idx}].first_name`)
                    }}
                    error={!!fieldErrors[`contacts[${idx}].first_name`]}
                    helperText={fieldErrors[`contacts[${idx}].first_name`] || ''}
                  />
                  <TextField
                    label="Last Name"
                    value={c.last_name}
                    onChange={(e) => setContacts((p) => p.map((x, i) => (i === idx ? { ...x, last_name: e.target.value } : x)))}
                  />
                  <TextField
                    label="Email"
                    value={c.email_address}
                    onChange={(e) => {
                      setContacts((p) => p.map((x, i) => (i === idx ? { ...x, email_address: e.target.value } : x)))
                      clearFieldError(`contacts[${idx}].email_address`)
                    }}
                    error={!!fieldErrors[`contacts[${idx}].email_address`]}
                    helperText={fieldErrors[`contacts[${idx}].email_address`] || ''}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={c.include_in_emails}
                        onChange={(e) =>
                          setContacts((p) => p.map((x, i) => (i === idx ? { ...x, include_in_emails: e.target.checked } : x)))
                        }
                      />
                    }
                    label="Include in emails"
                  />
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6">Addresses</Typography>
              <Typography variant="body2" color="text.secondary">
                Xero-compatible addresses (STREET, POBOX, DELIVERY).
              </Typography>
            </Box>
            <Button
              variant="contained"
              type="button"
              onClick={() =>
                setAddresses((prev) => [
                  ...prev,
                  {
                    address_type: 'STREET',
                    address_line1: '',
                    address_line2: '',
                    address_line3: '',
                    address_line4: '',
                    city: '',
                    region: 'NSW',
                    postal_code: '',
                    country: 'Australia',
                    attention_to: '',
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
                    Address {idx + 1}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    type="button"
                    onClick={() => {
                      setAddresses((prev) => prev.filter((_, i) => i !== idx))
                    }}
                  >
                    Remove
                  </Button>
                </Box>

                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
                  <TextField
                    select
                    label="Address Type"
                    value={a.address_type}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, address_type: e.target.value } : x)))}
                  >
                    {['STREET', 'POBOX', 'DELIVERY'].map((t) => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Address Line 1"
                    value={a.address_line1}
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, address_line1: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].address_line1`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].address_line1`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].address_line1`] || ''}
                  />
                  <TextField
                    label="Address Line 2"
                    value={a.address_line2 || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, address_line2: e.target.value } : x)))}
                  />
                  <TextField
                    label="Address Line 3"
                    value={a.address_line3 || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, address_line3: e.target.value } : x)))}
                  />
                  <TextField
                    label="Address Line 4"
                    value={a.address_line4 || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, address_line4: e.target.value } : x)))}
                  />
                  <TextField
                    label="City"
                    value={a.city}
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, city: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].city`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].city`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].city`] || ''}
                  />
                  <TextField
                    select
                    label="Region"
                    value={a.region}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, region: e.target.value } : x)))}
                  >
                    {['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].map((s) => (
                      <MenuItem key={s} value={s}>
                        {s}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Postcode"
                    value={a.postal_code}
                    onChange={(e) => {
                      setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, postal_code: e.target.value } : x)))
                      clearFieldError(`delivery_addresses[${idx}].postal_code`)
                    }}
                    error={!!fieldErrors[`delivery_addresses[${idx}].postal_code`]}
                    helperText={fieldErrors[`delivery_addresses[${idx}].postal_code`] || ''}
                  />
                  <TextField
                    label="Country"
                    value={a.country}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, country: e.target.value } : x)))}
                  />
                  <TextField
                    label="Attention To"
                    value={a.attention_to || ''}
                    onChange={(e) => setAddresses((p) => p.map((x, i) => (i === idx ? { ...x, attention_to: e.target.value } : x)))}
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
              onChange={(e) => setPreferredPalletType(String(e.target.value))}
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
              onChange={(e) => setPreferredTransportCompany(e.target.value)}
            />
            <TextField
              label="Special Delivery Instructions"
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              multiline
              minRows={3}
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Additional Information
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2, alignItems: 'center' }}>
            <TextField
              select
              label="Payment is due"
              value={paymentTerms.payment_is_due}
              onChange={(e) =>
                setPaymentTerms((p) => ({
                  ...p,
                  payment_is_due: e.target.value,
                }))
              }
              helperText="MYOB selling terms (PaymentIsDue). Leave unset to clear payment terms."
            >
              <MenuItem value="">— None —</MenuItem>
              {PAYMENT_IS_DUE_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>
                  {PAYMENT_IS_DUE_LABELS[t] ?? t}
                </MenuItem>
              ))}
            </TextField>
            {ptNumericLabels.showBalanceField ? (
              <TextField
                label={ptNumericLabels.balanceLabel}
                value={paymentTerms.balance_due_date}
                onChange={(e) =>
                  setPaymentTerms((p) => ({
                    ...p,
                    balance_due_date: e.target.value.replace(/[^\d-]/g, ''),
                  }))
                }
                type="number"
                inputProps={{ min: 0, max: 366 }}
                helperText={ptNumericLabels.balanceHelper}
              />
            ) : null}
          </Box>
          {paymentTermsPreview ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              <strong>Summary:</strong> {paymentTermsPreview}
            </Typography>
          ) : null}
          <Box sx={{ mt: 2 }}>
            <TextField
              label="Xero contact id (optional)"
              value={xeroContactId}
              onChange={(e) => {
                setXeroContactId(e.target.value)
                clearFieldError('xero_contact_id')
              }}
              error={!!fieldErrors['xero_contact_id']}
              helperText={
                fieldErrors['xero_contact_id'] ||
                'Xero Contact UUID (ContactID). Used when creating quotes or invoices in Xero for this customer.'
              }
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              helperText="App notes only — not synced to Xero."
            />
          </Box>
        </Paper>

        <Divider />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="text"
            color="primary"
            component={Link}
            to={isEdit && customerId ? `/customers/${customerId}` : '/customers'}
          >
            Cancel
          </Button>
          <SaveFormButton
            onClick={submit}
            disabled={saving}
            saving={saving}
            label={isEdit ? 'Update Customer' : 'Create Customer'}
          />
        </Box>
      </Stack>
    </Box>
  )
}


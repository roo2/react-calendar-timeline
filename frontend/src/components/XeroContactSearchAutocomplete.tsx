import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, TextField, type SxProps, type Theme } from '@mui/material'
import { apiFetch } from '../api/client'

export type XeroContactSummary = {
  contact_id: string
  name: string
  account_code?: string | null
  tax_number?: string | null
}

export type XeroContactSearchAutocompleteProps = {
  value: string
  onChange: (contactId: string, contact: XeroContactSummary | null) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  helperText?: string
  error?: boolean
  size?: 'small' | 'medium'
  fullWidth?: boolean
  sx?: SxProps<Theme>
}

const defaultGetOptionLabel = (c: XeroContactSummary) => {
  const name = (c.name || '').trim()
  const code = (c.account_code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code || c.contact_id
}

/**
 * Server-backed Xero contact search (debounced) for manual customer linking.
 */
export function XeroContactSearchAutocomplete(props: XeroContactSearchAutocompleteProps) {
  const {
    value,
    onChange,
    disabled = false,
    label = 'Xero contact',
    placeholder = 'Search Xero contacts…',
    helperText,
    error,
    size = 'small',
    fullWidth = true,
    sx,
  } = props

  const contactId = String(value || '').trim()
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<XeroContactSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<XeroContactSummary | null>(null)

  useEffect(() => {
    if (disabled) return
    const delayMs = search ? 300 : 0
    const t = window.setTimeout(() => {
      setLoading(true)
      const qs = new URLSearchParams()
      if (search.trim()) qs.set('q', search.trim())
      qs.set('limit', '50')
      void apiFetch<{ items: XeroContactSummary[] }>(`/api/xero/contacts?${qs.toString()}`)
        .then((res) => setItems(res.items || []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [search, disabled])

  useEffect(() => {
    if (!contactId) {
      setSelectedDetail(null)
      return
    }
    const fromList = items.find((c) => c.contact_id === contactId)
    if (fromList) {
      setSelectedDetail(fromList)
      return
    }
    if (selectedDetail?.contact_id === contactId) return
    setLoading(true)
    void apiFetch<{ items: XeroContactSummary[] }>(`/api/xero/contacts?limit=1&q=${encodeURIComponent(contactId)}`)
      .then((res) => {
        const hit = (res.items || []).find((c) => c.contact_id === contactId) || null
        setSelectedDetail(hit)
      })
      .catch(() => setSelectedDetail(null))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId])

  const options = useMemo(() => {
    if (!contactId || !selectedDetail) return items
    if (items.some((c) => c.contact_id === contactId)) return items
    return [selectedDetail, ...items]
  }, [items, contactId, selectedDetail])

  const selected = useMemo(
    () => options.find((c) => c.contact_id === contactId) || selectedDetail,
    [options, contactId, selectedDetail],
  )

  return (
    <Autocomplete<XeroContactSummary, false, boolean, false>
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      disabled={disabled}
      loading={loading}
      options={options}
      value={selected ?? null}
      onChange={(_e, next) => onChange(next?.contact_id || '', next)}
      inputValue={search}
      onInputChange={(_e, next, reason) => {
        if (reason === 'input') setSearch(next)
        if (reason === 'clear') setSearch('')
      }}
      getOptionLabel={defaultGetOptionLabel}
      isOptionEqualToValue={(a, b) => a.contact_id === b.contact_id}
      noOptionsText={search.trim() ? 'No Xero contacts match' : 'Type to search Xero contacts'}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
        />
      )}
      renderOption={(liProps, option) => (
        <li {...liProps} key={option.contact_id}>
          <div>
            <div>{option.name || '—'}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {[option.account_code, option.contact_id].filter(Boolean).join(' · ')}
            </div>
          </div>
        </li>
      )}
    />
  )
}

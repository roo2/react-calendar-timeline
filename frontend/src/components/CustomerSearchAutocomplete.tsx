import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, TextField, type SxProps, type Theme } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { useEffectLoopDetector } from '../dev/useEffectLoopDetector'
import {
  CUSTOMER_PICKER_PAGE_SIZE,
  fetchCustomer,
  fetchCustomers,
  type CustomerSummary,
} from '../store/slices/customersSlice'

export type CustomerSearchAutocompleteProps = {
  /** Selected customer id (empty string = none). */
  value: string
  onChange: (customerId: string, customer: CustomerSummary | null) => void
  disabled?: boolean
  /** When set with `disabled`, shows a read-only text field instead of the search control. */
  readOnlyDisplayName?: string | null
  label?: string
  placeholder?: string
  helperText?: string
  error?: boolean
  required?: boolean
  size?: 'small' | 'medium'
  fullWidth?: boolean
  sx?: SxProps<Theme>
  disableClearable?: boolean
  getOptionLabel?: (customer: CustomerSummary) => string
}

const defaultGetOptionLabel = (c: CustomerSummary) => (c.name || c.id).trim() || c.id

/**
 * Server-backed customer search (debounced). Avoids rendering large customer `<MenuItem>` lists.
 */
export function CustomerSearchAutocomplete(props: CustomerSearchAutocompleteProps) {
  const {
    value,
    onChange,
    disabled = false,
    readOnlyDisplayName,
    label = 'Customer',
    placeholder = 'Search by name…',
    helperText,
    error,
    required,
    size = 'small',
    fullWidth = true,
    sx,
    disableClearable,
    getOptionLabel = defaultGetOptionLabel,
  } = props

  const dispatch = useAppDispatch()
  const customerId = String(value || '').trim()
  const pickerItems = useAppSelector((s) => s.customers.list.items)
  const pickerLoading = useAppSelector((s) => s.customers.list.status === 'loading')
  const selectedDetail = useAppSelector((s) => (customerId ? s.customers.detail.byId[customerId]?.customer : null))

  const [search, setSearch] = useState('')

  useEffectLoopDetector('CustomerSearchAutocomplete.fetchCustomers', [dispatch, search, disabled])

  useEffect(() => {
    if (disabled) return
    const delayMs = search ? 300 : 0
    const t = window.setTimeout(() => {
      void dispatch(
        fetchCustomers({
          q: search,
          page: 1,
          page_size: Math.min(CUSTOMER_PICKER_PAGE_SIZE, 100),
        }),
      )
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [dispatch, search, disabled])

  useEffect(() => {
    if (!customerId) return
    if (pickerItems.some((c) => c.id === customerId)) return
    if (selectedDetail?.id === customerId) return
    void dispatch(fetchCustomer(customerId))
  }, [customerId, pickerItems, selectedDetail?.id, dispatch])

  const resolvedCustomer: CustomerSummary | null = useMemo(() => {
    if (!customerId) return null
    const inList = pickerItems.find((c) => c.id === customerId)
    if (inList) return inList
    if (selectedDetail?.id === customerId) {
      return {
        id: selectedDetail.id,
        name: selectedDetail.name,
        status: selectedDetail.status,
        brand_id: selectedDetail.brand_id,
        brand_code: selectedDetail.brand_code,
        brand_name: selectedDetail.brand_name,
        priority_rank: selectedDetail.priority_rank,
      }
    }
    return null
  }, [customerId, pickerItems, selectedDetail])

  const displayName = useMemo(() => {
    if (readOnlyDisplayName?.trim()) return readOnlyDisplayName.trim()
    if (resolvedCustomer) return getOptionLabel(resolvedCustomer)
    if (customerId) return 'Loading…'
    return ''
  }, [readOnlyDisplayName, resolvedCustomer, customerId, getOptionLabel])

  /** Disabled pickers use a plain field — MUI Autocomplete can loop on `reset` input events when `value` updates. */
  if (disabled) {
    return (
      <TextField
        size={size}
        fullWidth={fullWidth}
        sx={sx}
        label={label}
        value={displayName}
        InputProps={{ readOnly: true }}
        disabled
        helperText={helperText}
        error={error}
        required={required}
      />
    )
  }

  const autocompleteValue: CustomerSummary | null =
    resolvedCustomer ?? (customerId ? { id: customerId, name: 'Loading…', status: 'Active' } : null)

  return (
    <Autocomplete<CustomerSummary, false, boolean, false>
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      disableClearable={disableClearable ?? required}
      options={pickerItems}
      loading={pickerLoading}
      value={autocompleteValue}
      onChange={(_e, v) => onChange(v?.id ? String(v.id) : '', v)}
      onInputChange={(_e, v, reason) => {
        // Do not handle `reset` — MUI fires it when `value`/`options` change and causes fetch ↔ reset loops.
        if (reason === 'input' || reason === 'clear') setSearch(v)
      }}
      onOpen={() => {
        void dispatch(
          fetchCustomers({
            q: search,
            page: 1,
            page_size: Math.min(CUSTOMER_PICKER_PAGE_SIZE, 100),
          }),
        )
      }}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={getOptionLabel}
      filterOptions={(opts) => opts}
      noOptionsText={search.trim() ? 'No customers match' : 'Type to search'}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
          required={required}
        />
      )}
    />
  )
}

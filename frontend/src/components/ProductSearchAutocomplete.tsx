import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, Box, TextField, Typography, type SxProps, type Theme } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { useEffectLoopDetector } from '../dev/useEffectLoopDetector'
import { fetchProducts, type ProductListItem } from '../store/slices/productsSlice'

export const PRODUCT_PICKER_PAGE_SIZE = 100

export type ResellPickerItem = {
  id: string
  description: string
  catalog_kind?: string | null
}

export type ProductPickerOption =
  | { kind: 'product'; product: ProductListItem }
  | { kind: 'new_job_sheet' }
  | { kind: 'resell'; resell: ResellPickerItem }

export type ProductSearchAutocompleteProps = {
  customerId: string
  disabled?: boolean
  resellCatalog?: ResellPickerItem[]
  onSelectProduct: (product: ProductListItem) => void
  onSelectResell?: (resell: ResellPickerItem) => void
  onNewJobSheet?: () => void
  label?: string
  placeholder?: string
  size?: 'small' | 'medium'
  fullWidth?: boolean
  sx?: SxProps<Theme>
}

function optionKey(o: ProductPickerOption): string {
  if (o.kind === 'product') return `p:${o.product.id}`
  if (o.kind === 'resell') return `r:${o.resell.id}`
  return 'new_job_sheet'
}

function getOptionLabel(o: ProductPickerOption): string {
  if (o.kind === 'product') return (o.product.code || o.product.id).trim() || o.product.id
  if (o.kind === 'resell') return (o.resell.description || '').trim() || o.resell.id
  return 'New Job Sheet'
}

function matchesResellSearch(r: ResellPickerItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (r.description || '').toLowerCase().includes(needle)
}

/**
 * Server-backed product search for a customer (debounced). Options show code + description
 * (active version, from GET /api/products).
 */
export function ProductSearchAutocomplete(props: ProductSearchAutocompleteProps) {
  const {
    customerId,
    disabled = false,
    resellCatalog = [],
    onSelectProduct,
    onSelectResell,
    onNewJobSheet,
    label = 'Product',
    placeholder = 'Search by code or description…',
    size = 'small',
    fullWidth = true,
    sx,
  } = props

  const dispatch = useAppDispatch()
  const cid = String(customerId || '').trim()
  const pickerItems = useAppSelector((s) => s.products.list.items)
  const pickerLoading = useAppSelector((s) => s.products.list.status === 'loading')
  const lastCustomerId = useAppSelector((s) => s.products.list.lastCustomerId)

  const [search, setSearch] = useState('')
  const [pickerReset, setPickerReset] = useState(0)

  useEffect(() => {
    setSearch('')
    setPickerReset((n) => n + 1)
  }, [cid])

  useEffectLoopDetector('ProductSearchAutocomplete.fetchProducts', [dispatch, search, cid, disabled])

  useEffect(() => {
    if (disabled || !cid) return
    const delayMs = search ? 300 : 0
    const t = window.setTimeout(() => {
      void dispatch(
        fetchProducts({
          customer_id: cid,
          q: search,
        }),
      )
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [dispatch, search, cid, disabled])

  const manufacturedProducts = useMemo(() => {
    if (!cid || lastCustomerId !== cid) return []
    return pickerItems
  }, [cid, lastCustomerId, pickerItems])

  const options = useMemo((): ProductPickerOption[] => {
    const out: ProductPickerOption[] = []
    if (onNewJobSheet) {
      out.push({ kind: 'new_job_sheet' })
    }
    for (const p of manufacturedProducts) {
      out.push({ kind: 'product', product: p })
    }
    const q = search.trim().toLowerCase()
    const outsourced = resellCatalog.filter((x) => (x.catalog_kind || 'supply') === 'outsourced_manufacturing')
    const supply = resellCatalog.filter((x) => (x.catalog_kind || 'supply') !== 'outsourced_manufacturing')
    for (const r of outsourced) {
      if (matchesResellSearch(r, q)) out.push({ kind: 'resell', resell: r })
    }
    for (const r of supply) {
      if (matchesResellSearch(r, q)) out.push({ kind: 'resell', resell: r })
    }
    return out
  }, [manufacturedProducts, resellCatalog, search, onNewJobSheet])

  const groupBy = (o: ProductPickerOption): string => {
    if (o.kind === 'new_job_sheet') return 'Quick actions'
    if (o.kind === 'product') return 'Manufactured products'
    if ((o.resell.catalog_kind || 'supply') === 'outsourced_manufacturing') return 'Outsourced manufacturing'
    return 'Resell / supplies'
  }

  return (
    <Autocomplete<ProductPickerOption, false, false, false>
      key={`${cid}:${pickerReset}`}
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      disabled={disabled || !cid}
      options={options}
      loading={pickerLoading}
      value={null}
      inputValue={search}
      onInputChange={(_e, v, reason) => {
        if (reason === 'input' || reason === 'clear') setSearch(v)
      }}
      onChange={(_e, v) => {
        if (!v) return
        if (v.kind === 'product') {
          onSelectProduct(v.product)
          setSearch('')
          setPickerReset((n) => n + 1)
          return
        }
        if (v.kind === 'resell') {
          onSelectResell?.(v.resell)
          setSearch('')
          setPickerReset((n) => n + 1)
          return
        }
        if (v.kind === 'new_job_sheet') {
          onNewJobSheet?.()
          setSearch('')
          setPickerReset((n) => n + 1)
        }
      }}
      onOpen={() => {
        if (!cid) return
        void dispatch(fetchProducts({ customer_id: cid, q: search }))
      }}
      isOptionEqualToValue={(a, b) => optionKey(a) === optionKey(b)}
      getOptionLabel={getOptionLabel}
      groupBy={groupBy}
      filterOptions={(opts) => opts}
      noOptionsText={search.trim() ? 'No products match' : cid ? 'Type to search' : 'Select a customer first'}
      renderOption={(liProps, o) => {
        if (o.kind === 'product') {
          const p = o.product
          const desc = (p.description || '').trim()
          return (
            <Box component="li" {...liProps} key={optionKey(o)}>
              <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                {p.code || p.id}
              </Typography>
              {desc ? (
                <Typography component="span" variant="body2" color="text.secondary">
                  {' — '}
                  {desc}
                </Typography>
              ) : null}
            </Box>
          )
        }
        if (o.kind === 'resell') {
          return (
            <Box component="li" {...liProps} key={optionKey(o)}>
              <Typography variant="body2">{o.resell.description || o.resell.id}</Typography>
            </Box>
          )
        }
        return (
          <Box component="li" {...liProps} key={optionKey(o)}>
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              New Job Sheet
            </Typography>
          </Box>
        )
      }}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} />}
    />
  )
}

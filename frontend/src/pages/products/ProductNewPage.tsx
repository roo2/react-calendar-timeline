import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../components/SpecPayloadForm'
import { Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { FormErrorAlert } from '../../components/FormErrorAlert'
import { fetchCustomers, CUSTOMER_PICKER_PAGE_SIZE } from '../../store/slices/customersSlice'
import { checkProductCodeExists, clearCreateErrors, clearCreateFieldError, createProduct } from '../../store/slices/productsSlice'

export function ProductNewPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()

  const qs0 = new URLSearchParams(loc.search)
  const returnTo = qs0.get('returnTo')
  const preCustomerId = qs0.get('customerId') || qs0.get('customer_id')
  const customerLocked = !!(preCustomerId && String(preCustomerId).trim())

  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)
  const customersErr = useAppSelector((s) => s.customers.list.error)

  const upsert = useAppSelector((s) => s.products.create)
  const fieldErrors = upsert.fieldErrors
  const errorSummary = upsert.messages
  const err = upsert.error
  const saving = upsert.status === 'loading'
  const { setDirty } = useUnsavedChanges()

  const [customerId, setCustomerId] = useState('')
  const [code, setCode] = useState('')
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [codeExists, setCodeExists] = useState(false)
  const codeExistsReq = useRef(0)

  const canSubmit = useMemo(() => customerId && code && !saving, [customerId, code, saving])

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers({ page: 1, page_size: CUSTOMER_PICKER_PAGE_SIZE, q: '' }))
  }, [customersStatus, dispatch])

  useEffect(() => {
    // Allow preselecting a customer when navigating from "New Order" via query string.
    if (customerId) return
    if (preCustomerId) setCustomerId(preCustomerId)
  }, [customerId, preCustomerId])

  useEffect(() => {
    const v = (code || '').trim()
    if (!v) {
      setCodeExists(false)
      return
    }
    const t = window.setTimeout(() => {
      const id = ++codeExistsReq.current
      void dispatch(checkProductCodeExists(v))
        .unwrap()
        .then((r) => {
          if (id !== codeExistsReq.current) return
          setCodeExists(!!r.exists)
        })
        .catch(() => {
          if (id !== codeExistsReq.current) return
          setCodeExists(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(t)
    }
  }, [code, dispatch])

  useEffect(() => {
    // Reset product create errors when entering the page.
    dispatch(clearCreateErrors())
  }, [dispatch])

  function clearLocalFieldErrorsByPrefix(prefix: string) {
    // Products slice doesn't support prefix clearing; remove spec errors by clearing the whole create state.
    // This is a tradeoff to keep behavior simple/consistent without over-engineering.
    if (prefix === 'spec') dispatch(clearCreateErrors())
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const res = await dispatch(
        createProduct({
          data: {
            customer_id: customerId,
            code,
            spec,
          },
        }),
      ).unwrap()
      const pid = res?.product?.id as string | undefined
      setDirty(false)
      if (returnTo) {
        // Return to wherever we came from (e.g. New Order) and optionally signal
        // which product was created so the caller can auto-add it.
        try {
          if (pid && typeof window !== 'undefined') {
            const u = new URL(returnTo, window.location.origin)
            u.searchParams.set('addedProductId', pid)
            nav(`${u.pathname}${u.search}${u.hash}`)
          } else {
            nav(returnTo)
          }
        } catch {
          nav(returnTo)
        }
      }
      else if (pid) nav(`/products/${pid}`)
      else nav('/products')
    } catch {
      // Errors are stored in the slice (including field-level validation).
    }
  }

  return (
    <Box onChange={() => setDirty(true)}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Product
      </Typography>

      <FormErrorAlert
        error={err || customersErr}
        messages={err ? errorSummary : undefined}
        scrollOnShow={true}
        scrollMarginTop={80}
      />

      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Basic Information
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
              <TextField
                select
                label="Customer"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value)
                  dispatch(clearCreateFieldError('customer_id'))
                }}
                required
                error={!!fieldErrors['customer_id']}
                helperText={fieldErrors['customer_id'] || ''}
                disabled={customersStatus === 'loading' || customersStatus === 'idle' || customerLocked}
              >
                <MenuItem value="" disabled>
                  Select customer
                </MenuItem>
                {customers.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Product Code"
                value={code}
                onChange={(e) => {
                  setCode(e.currentTarget.value)
                  setCodeExists(false)
                  dispatch(clearCreateFieldError('code'))
                }}
                required
                helperText={
                  fieldErrors['code'] || (codeExists ? 'Product code already exists' : 'Unique code for this product (spec-derived codes do not include customer prefix).')
                }
                error={!!fieldErrors['code'] || codeExists}
              />

            </Box>
          </Paper>

          <SpecPayloadForm
            value={spec}
            onChange={(next) => {
              setSpec(next)
              // Any spec edit clears spec-related validation to reduce stale highlights.
              clearLocalFieldErrorsByPrefix('spec')
            }}
            fieldErrors={fieldErrors}
            customerId={customerId || undefined}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button component={Link} to={returnTo || '/products'} variant="text" color="primary">
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </Box>
        </Stack>
      </form>
    </Box>
  )
}


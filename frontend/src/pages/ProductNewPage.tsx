import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'
import { Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { FormErrorAlert } from '../components/FormErrorAlert'
import { fetchCustomers } from '../store/slices/customersSlice'
import { clearCreateErrors, clearCreateFieldError, createProduct } from '../store/slices/productsSlice'

export function ProductNewPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()

  const qs0 = new URLSearchParams(loc.search)
  const returnTo = qs0.get('returnTo')

  const customers = useAppSelector((s) => s.customers.list.items)
  const customersStatus = useAppSelector((s) => s.customers.list.status)
  const customersErr = useAppSelector((s) => s.customers.list.error)

  const upsert = useAppSelector((s) => s.products.create)
  const fieldErrors = upsert.fieldErrors
  const errorSummary = upsert.messages
  const err = upsert.error
  const saving = upsert.status === 'loading'

  const [customerId, setCustomerId] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())

  const customerCode = useMemo(() => {
    const c = customers.find((x) => x.id === customerId) as any
    return (c?.code ? String(c.code) : '').trim().toUpperCase()
  }, [customerId, customers])

  const codePrefixOk = useMemo(() => {
    if (!customerCode) return true
    const v = (code || '').trim().toUpperCase()
    return v.startsWith(`${customerCode}-`) || v.startsWith(`${customerCode}_`)
  }, [code, customerCode])

  const canSubmit = useMemo(() => customerId && code && codePrefixOk && !saving, [customerId, code, codePrefixOk, saving])

  useEffect(() => {
    if (customersStatus !== 'idle') return
    void dispatch(fetchCustomers(undefined))
  }, [customersStatus, dispatch])

  useEffect(() => {
    // Allow preselecting a customer when navigating from "New Order" via query string.
    if (customerId) return
    const pre = qs0.get('customerId') || qs0.get('customer_id')
    if (pre) setCustomerId(pre)
  }, [customerId, qs0])

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
            description: description.trim() ? description.trim() : null,
            spec,
          },
        }),
      ).unwrap()
      const pid = res?.product?.id as string | undefined
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
    <Box>
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
                disabled={customersStatus === 'loading' || customersStatus === 'idle'}
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
                  dispatch(clearCreateFieldError('code'))
                }}
                required
                helperText={
                  fieldErrors['code'] ||
                  (customerCode
                    ? `Must start with ${customerCode}- (e.g. ${customerCode}-F15-123)`
                    : 'Select a customer first to see the required prefix.')
                }
                error={!!fieldErrors['code'] || (customerId ? !codePrefixOk : false)}
              />

              <TextField
                label="Description"
                value={description}
                onChange={(e) => {
                  setDescription(e.currentTarget.value)
                  dispatch(clearCreateFieldError('description'))
                }}
                helperText={fieldErrors['description'] || 'Short human-readable label (e.g. “Milk powder liner, natural, roll”)'}
                error={!!fieldErrors['description']}
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
            <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button component={Link} to={returnTo || '/products'} variant="outlined">
              Cancel
            </Button>
          </Box>
        </Stack>
      </form>
    </Box>
  )
}


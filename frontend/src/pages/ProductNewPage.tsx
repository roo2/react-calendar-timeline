import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'
import { apiFetch } from '../api/client'
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

  const [customerId, setCustomerId] = useState('')
  const [code, setCode] = useState('')
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [codeExists, setCodeExists] = useState(false)
  const lastAutoPrefixRef = useRef<string>('')

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
    if (preCustomerId) setCustomerId(preCustomerId)
  }, [customerId, preCustomerId])

  useEffect(() => {
    // If a customer was preselected via query string, auto-fill the code prefix once
    // the customer record has loaded (customerCode becomes available).
    if (!customerId) return
    if (!customerCode) return
    const nextPrefix = `${customerCode}-`
    const cur = (code || '').trim()
    const curUp = cur.toUpperCase()
    const lastAuto = (lastAutoPrefixRef.current || '').toUpperCase()
    const isEmpty = !curUp
    const isOnlyAutoPrefix = !!lastAuto && curUp === lastAuto
    if (isEmpty || isOnlyAutoPrefix) {
      setCode(nextPrefix)
      lastAutoPrefixRef.current = nextPrefix
    }
  }, [customerId, customerCode, code])

  useEffect(() => {
    const v = (code || '').trim()
    if (!v) {
      setCodeExists(false)
      return
    }
    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch<{ exists: boolean }>(`/api/products/code-exists?code=${encodeURIComponent(v)}`, {
            signal: controller.signal as any,
          })
          setCodeExists(!!res?.exists)
        } catch {
          // If the check fails (offline/server), don't block the form.
          setCodeExists(false)
        }
      })()
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [code])

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
                  const nextCustomerId = e.target.value
                  const nextCustomer = customers.find((x) => x.id === nextCustomerId) as any
                  const nextCustomerCode = (nextCustomer?.code ? String(nextCustomer.code) : '').trim().toUpperCase()

                  const cur = (code || '').trim()
                  const curUp = cur.toUpperCase()
                  const oldDash = customerCode ? `${customerCode}-` : ''
                  const oldUnderscore = customerCode ? `${customerCode}_` : ''
                  const isJustOldPrefix = !!customerCode && (curUp === oldDash || curUp === oldUnderscore)

                  setCustomerId(nextCustomerId)
                  if (!curUp || isJustOldPrefix) setCode(nextCustomerCode ? `${nextCustomerCode}-` : '')
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
                  fieldErrors['code'] ||
                  (codeExists
                    ? 'Product code already exists'
                    : customerCode
                    ? `Must start with ${customerCode}- (e.g. ${customerCode}-F15-123)`
                    : 'Select a customer first to see the required prefix.')
                }
                error={!!fieldErrors['code'] || codeExists || (customerId ? !codePrefixOk : false)}
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


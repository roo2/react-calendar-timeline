import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../../components/SpecPayloadForm'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { CustomerSearchAutocomplete } from '../../components/CustomerSearchAutocomplete'
import { FormErrorAlert } from '../../components/FormErrorAlert'
import { checkProductCodeExists, clearCreateErrors, clearCreateFieldError, createProduct } from '../../store/slices/productsSlice'

export function ProductNewPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()

  const qs0 = new URLSearchParams(loc.search)
  const returnTo = qs0.get('returnTo')
  const preCustomerId = qs0.get('customerId') || qs0.get('customer_id')
  const customerLocked = !!(preCustomerId && String(preCustomerId).trim())

  const customersErr = useAppSelector((s) => s.customers.list.error)

  const upsert = useAppSelector((s) => s.products.create)
  const fieldErrors = upsert.fieldErrors
  const errorSummary = upsert.messages
  const err = upsert.error
  const saving = upsert.status === 'loading'
  const { setDirty } = useUnsavedChanges()

  const [customerId, setCustomerId] = useState('')
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [codeExists, setCodeExists] = useState(false)
  const codeExistsReq = useRef(0)

  const customerFacingCode = useMemo(
    () => String(spec.identity?.customer_code ?? '').trim(),
    [spec.identity?.customer_code],
  )

  const canSubmit = useMemo(
    () => Boolean(customerId && customerFacingCode && !saving),
    [customerId, customerFacingCode, saving],
  )

  useEffect(() => {
    // Allow preselecting a customer when navigating from "New Order" via query string.
    if (customerId) return
    if (preCustomerId) setCustomerId(preCustomerId)
  }, [customerId, preCustomerId])

  useEffect(() => {
    const v = customerFacingCode
    const cid = (customerId || '').trim()
    if (!v || !cid) {
      setCodeExists(false)
      return
    }
    const t = window.setTimeout(() => {
      const id = ++codeExistsReq.current
      void dispatch(checkProductCodeExists({ code: v, customer_id: cid }))
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
  }, [customerFacingCode, customerId, dispatch])

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
            code: customerFacingCode,
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

            <CustomerSearchAutocomplete
              value={customerId}
              onChange={(id) => {
                setCustomerId(id)
                dispatch(clearCreateFieldError('customer_id'))
              }}
              required
              error={!!fieldErrors['customer_id']}
              helperText={fieldErrors['customer_id'] || ''}
              disabled={customerLocked}
              disableClearable
              sx={{ maxWidth: 480 }}
            />
          </Paper>

          <SpecPayloadForm
            value={spec}
            onChange={(next) => {
              setSpec(next)
              setCodeExists(false)
              dispatch(clearCreateFieldError('code'))
              clearLocalFieldErrorsByPrefix('spec')
            }}
            fieldErrors={{
              ...fieldErrors,
              ...(codeExists ? { 'spec.identity.customer_code': 'Customer-facing product code already exists' } : {}),
            }}
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


import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

type CustomerSummary = { id: string; name: string }

export function ProductNewPage() {
  const nav = useNavigate()
  const csrfToken = useAppSelector((s) => s.auth.csrfToken)

  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customerId, setCustomerId] = useState('')
  const [code, setCode] = useState('')
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [derived, setDerived] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSubmit = useMemo(() => customerId && code && !saving, [customerId, code, saving])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<{ items: CustomerSummary[] }>('/api/customers')
        setCustomers(res.items || [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load customers')
      }
    })()
  }, [])

  async function previewDerived() {
    try {
      setErr(null)
      const res = await apiFetch<{ derived: unknown }>('/api/products/preview/dimensions', {
        method: 'POST',
        body: JSON.stringify(spec),
        csrfToken: csrfToken || undefined,
      })
      setDerived(res.derived)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to preview dimensions')
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      setSaving(true)
      setErr(null)
      const res = await apiFetch<unknown>('/api/products', {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId, code, spec }),
        csrfToken: csrfToken || undefined,
      })
      const pid = (res as any)?.product?.id as string | undefined
      if (pid) nav(`/products/${pid}`)
      else nav('/products')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create product')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h5">New Product</Typography>

      {err && <Alert severity="error">{err}</Alert>}

      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <TextField
                select
                label="Customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.currentTarget.value)}
                required
              >
                <MenuItem value="">
                  <em>Select customer</em>
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
                onChange={(e) => setCode(e.currentTarget.value)}
                required
              />
            </Stack>
          </Paper>

          <SpecPayloadForm value={spec} onChange={setSpec} onPreviewDerived={previewDerived} derived={derived as any} />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button component={Link} to="/products" variant="outlined">
              Cancel
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  )
}


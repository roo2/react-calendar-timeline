import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

type Customer = { id: string; name: string }
type Version = { id: string; product_code: string; version_number: number; customer_name?: string | null }

export function OrderNewPage() {
  const nav = useNavigate()
  const csrf = useAppSelector((s) => s.auth.csrfToken)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [productVersionId, setProductVersionId] = useState('')
  const [currency, setCurrency] = useState('AUD')
  const [status, setStatus] = useState<'confirmed' | 'draft'>('confirmed')
  const [quoteId, setQuoteId] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<{ customers: Customer[]; versions: Version[] }>('/api/orders/bootstrap')
        setCustomers(res.customers)
        setVersions(res.versions)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load form data')
      }
    })()
  }, [])

  async function submit() {
    setErr(null)
    setSaving(true)
    try {
      const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
        method: 'POST',
        csrfToken: csrf || undefined,
        body: JSON.stringify({
          customer_id: customerId,
          product_version_id: productVersionId,
          currency,
          status,
          quote_id: quoteId || null,
        }),
      })
      nav(`/orders/${res.order_id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Order
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }}>
        <Stack spacing={2}>
          <TextField
            select
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
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
            select
            label="Product Version"
            value={productVersionId}
            onChange={(e) => setProductVersionId(e.target.value)}
          >
            <MenuItem value="" disabled>
              Select product version
            </MenuItem>
            {versions.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.product_code} v{v.version_number}
                {v.customer_name ? ` (${v.customer_name})` : ''}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Currency"
            value={currency}
            inputProps={{ maxLength: 3 }}
            onChange={(e) => setCurrency(e.currentTarget.value)}
          />

          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <MenuItem value="confirmed">confirmed</MenuItem>
            <MenuItem value="draft">draft</MenuItem>
          </TextField>

          <TextField label="Quote ID (optional)" value={quoteId} onChange={(e) => setQuoteId(e.currentTarget.value)} />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={saving || !customerId || !productVersionId}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="outlined" component={Link} to="/orders">
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}


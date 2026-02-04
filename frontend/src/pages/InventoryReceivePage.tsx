import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

export function InventoryReceivePage() {
  const nav = useNavigate()
  const csrf = useAppSelector((s) => s.auth.csrfToken)

  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [uom, setUom] = useState('kg')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    setErr(null)
    setMsg(null)
    setSaving(true)
    try {
      await apiFetch('/api/inventory/receive', {
        method: 'POST',
        csrfToken: csrf || undefined,
        body: JSON.stringify({
          category: 'raw_material',
          item_id: itemId || null,
          quantity,
          uom,
        }),
      })
      setMsg('Received inventory successfully.')
      nav('/inventory')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Validation error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Receive Inventory
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}
      {msg && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {msg}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 640 }}>
        <Stack spacing={2}>
          <TextField label="Category" value="raw_material" InputProps={{ readOnly: true }} />
          <TextField
            label="Item ID (optional)"
            value={itemId}
            onChange={(e) => setItemId(e.currentTarget.value)}
            placeholder="UUID"
            helperText="Leave blank if not tracking by item."
          />
          <TextField
            label="Quantity"
            type="number"
            inputProps={{ step: '0.001', min: '0.001' }}
            value={quantity}
            onChange={(e) => setQuantity(e.currentTarget.value)}
          />
          <TextField
            select
            label="UOM"
            value={uom}
            onChange={(e) => setUom(e.currentTarget.value)}
          >
            {['kg', 'units', 'm'].map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={saving}>
              {saving ? 'Receiving…' : 'Receive'}
            </Button>
            <Button variant="outlined" component={Link} to="/inventory">
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}


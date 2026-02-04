import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

export function InventoryAdjustPage() {
  const nav = useNavigate()
  const csrf = useAppSelector((s) => s.auth.csrfToken)

  const [category, setCategory] = useState('raw_material')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [uom, setUom] = useState('kg')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    setErr(null)
    setSaving(true)
    try {
      await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        csrfToken: csrf || undefined,
        body: JSON.stringify({
          category,
          item_id: itemId || null,
          quantity,
          uom,
          note: note || null,
        }),
      })
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
        Adjust Inventory
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 640 }}>
        <Stack spacing={2}>
          <TextField select label="Category" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
            {['raw_material', 'wip_extruded_roll', 'wip_printed_roll', 'finished_goods', 'scrap'].map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Item ID (optional)"
            value={itemId}
            onChange={(e) => setItemId(e.currentTarget.value)}
            placeholder="UUID"
          />
          <TextField
            label="Quantity (signed)"
            type="number"
            inputProps={{ step: '0.001' }}
            value={quantity}
            onChange={(e) => setQuantity(e.currentTarget.value)}
            helperText="Use negative for decrease (e.g., -5)."
          />
          <TextField label="UOM" value={uom} onChange={(e) => setUom(e.currentTarget.value)} />
          <TextField
            label="Reason (optional)"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="Reason for adjustment"
            multiline
            minRows={2}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={saving}>
              {saving ? 'Adjusting…' : 'Adjust'}
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


import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { adjustInventory } from '../../store/slices/inventorySlice'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

export function InventoryAdjustPage() {
  const nav = useNavigate()
  const dispatch = useAppDispatch()
  const adjust = useAppSelector((s) => s.inventory.adjust)

  const [category, setCategory] = useState('raw_material')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [uom, setUom] = useState('kg')
  const [note, setNote] = useState('')

  async function submit() {
    try {
      await dispatch(
        adjustInventory({
          category,
          item_id: itemId || null,
          quantity,
          uom,
          note: note || null,
        }),
      ).unwrap()
      nav('/inventory')
    } catch (e) {
      // error shown from slice
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Adjust Inventory
      </Typography>

      {adjust.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {adjust.error}
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
            <Button variant="contained" onClick={submit} disabled={adjust.status === 'loading'}>
              {adjust.status === 'loading' ? 'Adjusting…' : 'Adjust'}
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


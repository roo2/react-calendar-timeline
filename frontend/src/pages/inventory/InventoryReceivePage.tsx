import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { receiveInventory } from '../../store/slices/inventorySlice'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'

export function InventoryReceivePage() {
  const nav = useNavigate()
  const dispatch = useAppDispatch()
  const receive = useAppSelector((s) => s.inventory.receive)

  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [uom, setUom] = useState('kg')
  const [msg, setMsg] = useState<string | null>(null)

  async function submit() {
    setMsg(null)
    try {
      await dispatch(
        receiveInventory({
          category: 'raw_material',
          item_id: itemId || null,
          quantity,
          uom,
        }),
      ).unwrap()
      setMsg('Received inventory successfully.')
      nav('/inventory')
    } catch (e) {
      // error shown from slice
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Receive Inventory
      </Typography>

      {receive.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {receive.error}
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
            <Button variant="contained" onClick={submit} disabled={receive.status === 'loading'}>
              {receive.status === 'loading' ? 'Receiving…' : 'Receive'}
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


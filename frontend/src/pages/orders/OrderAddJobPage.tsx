import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useAppDispatch } from '../../store/hooks'
import { addOrderJob } from '../../store/slices/ordersSlice'

export function OrderAddJobPage() {
  const { orderId } = useParams()
  const nav = useNavigate()
  const dispatch = useAppDispatch()

  const [plannedQty, setPlannedQty] = useState('')
  const [allocated, setAllocated] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!orderId) return
    setErr(null)
    setSaving(true)
    try {
      await dispatch(
        addOrderJob({
          orderId,
          body: {
            planned_qty: plannedQty,
            allocated_order_units: allocated.trim() ? allocated : null,
          },
        }),
      ).unwrap()
      nav(`/orders/${orderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Add Job
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 560 }}>
        <Stack spacing={2}>
          <TextField
            label="Planned Qty"
            type="number"
            inputProps={{ step: '0.001', min: 0 }}
            value={plannedQty}
            onChange={(e) => setPlannedQty(e.currentTarget.value)}
          />
          <TextField
            label="Allocated Order Units (optional)"
            type="number"
            inputProps={{ step: '0.001', min: 0 }}
            value={allocated}
            onChange={(e) => setAllocated(e.currentTarget.value)}
          />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={submit} disabled={saving || !plannedQty}>
              {saving ? 'Creating…' : 'Create Job'}
            </Button>
            <Button variant="outlined" component={Link} to={`/orders/${orderId}`}>
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}


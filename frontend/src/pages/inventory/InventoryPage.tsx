import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchInventoryDashboard, type InventoryDashboardSnapshot } from '../../store/slices/inventorySlice'

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Paper>
  )
}

export function InventoryPage() {
  const dispatch = useAppDispatch()
  const dash = useAppSelector((s) => s.inventory.dashboard)
  const snapshot: InventoryDashboardSnapshot | null = dash.data
  const err = dash.status === 'failed' ? dash.error : null

  useEffect(() => {
    void dispatch(fetchInventoryDashboard())
    const t = window.setInterval(() => {
      void dispatch(fetchInventoryDashboard())
    }, 45_000)
    return () => window.clearInterval(t)
  }, [dispatch])

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Inventory
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        <Button variant="outlined" component={Link} to="/inventory/receive">
          Receive Inventory
        </Button>
        <Button variant="outlined" component={Link} to="/inventory/adjust">
          Adjust Inventory
        </Button>
        <Button variant="outlined" component={Link} to="/inventory/transactions">
          View Transactions
        </Button>
      </Stack>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
        <StatCard title="Raw Material (kg)" value={snapshot?.raw_kg ?? '…'} />
        <StatCard title="WIP Extrusion (kg)" value={snapshot?.wip_extrusion_kg ?? '…'} />
        <StatCard title="WIP Printing (kg)" value={snapshot?.wip_printing_kg ?? '…'} />
        <StatCard title="Finished Goods (units)" value={snapshot?.fg_units ?? '…'} />
      </Box>
    </Box>
  )
}


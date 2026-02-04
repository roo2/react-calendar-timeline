import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'

type Snapshot = {
  raw_kg: string
  wip_extrusion_kg: string
  wip_printing_kg: string
  fg_units: string
}

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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    try {
      setErr(null)
      const res = await apiFetch<Snapshot>('/api/inventory/dashboard')
      setSnapshot(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load inventory')
    }
  }

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 45_000)
    return () => window.clearInterval(t)
  }, [])

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


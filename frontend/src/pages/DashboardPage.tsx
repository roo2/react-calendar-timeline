import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { Alert, Box, Paper, Typography } from '@mui/material'

export function DashboardPage() {
  const [inventory, setInventory] = useState<any>(null)
  const [throughput, setThroughput] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useMemo(
    () => async () => {
      try {
        setErr(null)
        const [inv, tp] = await Promise.all([
          apiFetch<any>(`/api/dashboard/partial/inventory_snapshot`),
          apiFetch<any>(`/api/dashboard/partial/throughput_weekly`),
        ])
        setInventory(inv)
        setThroughput(tp)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load dashboard')
      }
    },
    [],
  )

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 60_000)
    return () => window.clearInterval(t)
  }, [refresh])

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Operational Dashboard
      </Typography>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Inventory &amp; WIP
          </Typography>
          <Box component="pre" sx={{ m: 0, overflowX: 'auto', fontSize: 12 }}>
            {inventory ? JSON.stringify(inventory, null, 2) : 'Loading…'}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Throughput (Weekly)
          </Typography>
          <Box component="pre" sx={{ m: 0, overflowX: 'auto', fontSize: 12 }}>
            {throughput ? JSON.stringify(throughput, null, 2) : 'Loading…'}
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}


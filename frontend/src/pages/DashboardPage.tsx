import { useEffect, useMemo } from 'react'
import { Alert, Box, Paper, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchDashboardPartials } from '../store/slices/dashboardSlice'

export function DashboardPage() {
  const dispatch = useAppDispatch()
  const inv = useAppSelector((s) => s.dashboard.inventorySnapshot)
  const tp = useAppSelector((s) => s.dashboard.throughputWeekly)

  const refresh = useMemo(
    () => () => {
      void dispatch(fetchDashboardPartials())
    },
    [dispatch],
  )

  useEffect(() => {
    refresh()
    const t = window.setInterval(() => {
      void dispatch(fetchDashboardPartials())
    }, 60_000)
    return () => window.clearInterval(t)
  }, [dispatch, refresh])

  const err = inv.error || tp.error
  const loading = inv.status === 'loading' || tp.status === 'loading'

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
            {loading && !inv.data ? 'Loading…' : JSON.stringify(inv.data, null, 2)}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Throughput (Weekly)
          </Typography>
          <Box component="pre" sx={{ m: 0, overflowX: 'auto', fontSize: 12 }}>
            {loading && !tp.data ? 'Loading…' : JSON.stringify(tp.data, null, 2)}
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}

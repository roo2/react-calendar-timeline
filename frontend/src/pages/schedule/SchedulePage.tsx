import { Paper, Typography } from '@mui/material'

export function SchedulePage() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Schedule
      </Typography>
      <Typography color="text.secondary">UI TBD. This page will consume `/api/schedule/*`.</Typography>
    </Paper>
  )
}


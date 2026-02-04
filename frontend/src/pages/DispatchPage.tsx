import { Paper, Typography } from '@mui/material'

export function DispatchPage() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Dispatch
      </Typography>
      <Typography color="text.secondary">UI TBD. This page will consume `/api/dispatch/*`.</Typography>
    </Paper>
  )
}


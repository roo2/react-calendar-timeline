import { Paper, Typography } from '@mui/material'

export function SuggestionsPage() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Suggestions
      </Typography>
      <Typography color="text.secondary">UI TBD. This page will consume `/api/suggestions`.</Typography>
    </Paper>
  )
}


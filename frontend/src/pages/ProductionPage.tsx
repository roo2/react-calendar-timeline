import { Route, Routes } from 'react-router-dom'
import { Paper, Typography } from '@mui/material'

function ProductionIndex() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Production
      </Typography>
      <Typography color="text.secondary">UI TBD. This section will consume `/api/production/*`.</Typography>
    </Paper>
  )
}

function MyMachinePage() {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        My Machine
      </Typography>
      <Typography color="text.secondary">UI TBD. This page will consume `/api/production/*`.</Typography>
    </Paper>
  )
}

export function ProductionPage() {
  return (
    <Routes>
      <Route path="/" element={<ProductionIndex />} />
      <Route path="/my-machine" element={<MyMachinePage />} />
    </Routes>
  )
}


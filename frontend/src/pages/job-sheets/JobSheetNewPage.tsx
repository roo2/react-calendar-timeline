import { Box, Typography } from '@mui/material'
import { JobSheetEditor } from './components/JobSheetEditor'

export function JobSheetNewPage() {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New Job Sheet
      </Typography>
      <JobSheetEditor mode="new" />
    </Box>
  )
}


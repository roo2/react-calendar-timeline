import { Box, Button, Typography } from '@mui/material'
import { Link, useParams } from 'react-router-dom'
import { JobSheetEditor } from '../components/JobSheetEditor'

export function JobSheetEditPage() {
  const { jobSheetId } = useParams()

  if (!jobSheetId) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Edit Job Sheet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Missing job sheet id.
        </Typography>
        <Button component={Link} to="/job-sheets" variant="outlined">
          Back to Job Sheets
        </Button>
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Edit Job Sheet
      </Typography>
      <JobSheetEditor mode="edit" jobSheetId={jobSheetId} />
    </Box>
  )
}


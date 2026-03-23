import { Box, Button, Typography } from '@mui/material'
import { Link, useLocation, useParams } from 'react-router-dom'
import { JobSheetEditor } from './components/JobSheetEditor'

export function JobSheetEditPage() {
  const { jobSheetId } = useParams()
  const loc = useLocation()
  const qs = new URLSearchParams(loc.search)
  const returnToRaw = qs.get('returnTo') || ''
  let returnTo: string | undefined = undefined
  try {
    if (returnToRaw && returnToRaw.startsWith('/')) returnTo = returnToRaw
    else if (returnToRaw && returnToRaw.startsWith('http') && typeof window !== 'undefined') {
      const u = new URL(returnToRaw)
      if (u.origin === window.location.origin) returnTo = `${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    returnTo = undefined
  }

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
      <JobSheetEditor mode="edit" jobSheetId={jobSheetId} returnTo={returnTo} />
    </Box>
  )
}


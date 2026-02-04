import { useAppSelector } from '../store/hooks'
import { Alert, Paper, Stack, Typography } from '@mui/material'

export function HomePage() {
  const auth = useAppSelector((s) => s.auth)

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Home</Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1}>
          <Typography>This is the new React + Redux frontend.</Typography>
          <Alert severity={auth.identity?.user ? 'success' : 'info'}>
            {auth.identity?.user ? `Signed in as ${auth.identity.user}` : 'Anonymous'}
          </Alert>
        </Stack>
      </Paper>
    </Stack>
  )
}


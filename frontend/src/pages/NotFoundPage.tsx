import { Link } from 'react-router-dom'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'

export function NotFoundPage() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 360 }}>
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 520, width: '100%' }}>
        <Stack spacing={2} alignItems="center">
          <Typography sx={{ fontSize: 56 }}>🔎</Typography>
          <Typography variant="h5">Page Not Found</Typography>
          <Typography color="text.secondary" align="center">
            The page you’re looking for doesn’t exist.
          </Typography>
          <Button variant="contained" component={Link} to="/">
            Go Home
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}


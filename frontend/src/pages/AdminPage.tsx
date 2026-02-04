import { Box, Paper, Stack, Typography, Link as MuiLink } from '@mui/material'

export function AdminPage() {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Admin
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography color="text.secondary">
            Admin tools are not yet implemented in the React UI.
          </Typography>
          <Typography variant="body2">
            You can use the server-admin endpoints directly for now:
          </Typography>
          <MuiLink href="/sys/users" underline="hover">
            User management
          </MuiLink>
        </Stack>
      </Paper>
    </Box>
  )
}


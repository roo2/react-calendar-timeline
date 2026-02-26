import { Box, Typography } from '@mui/material'
import { type ReactNode } from 'react'

export function AdminPageHeader(props: { title: string; subtitle?: ReactNode }) {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {props.title}
      </Typography>
      {props.subtitle ? (
        <Typography variant="body2" color="text.secondary">
          {props.subtitle}
        </Typography>
      ) : null}
    </Box>
  )
}


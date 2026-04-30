import { Box, Paper } from '@mui/material'
import type { ReactNode } from 'react'

/** Right column: same sticky layout as Quotes “Live Quote” desktop panel. */
export function StickySideAside({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        width: 480,
        flex: '0 0 auto',
        position: 'sticky',
        top: { xs: 72, sm: 80 },
        alignSelf: 'flex-start',
      }}
    >
      {children}
    </Box>
  )
}

/** Mobile fixed bottom shell used by Quotes live preview (spacer + scrollable panel). */
export function MobileFixedBottomAside({ children }: { children: ReactNode }) {
  return (
    <>
      <Box sx={{ minHeight: 'calc(50vh + 140px)' }} />
      <Paper
        variant="outlined"
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1200,
          borderLeft: 0,
          borderRight: 0,
          borderBottom: 0,
          borderRadius: 0,
          maxHeight: '40vh',
          overflow: 'auto',
          p: 1.5,
          backgroundColor: 'background.paper',
        }}
      >
        {children}
      </Paper>
    </>
  )
}

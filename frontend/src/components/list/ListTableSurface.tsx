import type { ReactNode } from 'react'
import { Box, CircularProgress, Paper, Typography } from '@mui/material'

export type ListTableSurfaceProps = {
  /** Semi-transparent overlay on the table (e.g. while debouncing search or refetching). */
  loadingOverlay: boolean
  loadingOverlayMessage?: string
  /**
   * When true, show a compact loading row instead of children (first load with no rows).
   * When false, children render and `loadingOverlay` may still dim the body.
   */
  initialLoading?: boolean
  initialLoadingMessage?: string
  children: ReactNode
}

/**
 * Outlined Paper wrapping a table: optional first-load placeholder + overlay during refresh.
 */
export function ListTableSurface({
  loadingOverlay,
  loadingOverlayMessage = 'Loading…',
  initialLoading,
  initialLoadingMessage = 'Loading…',
  children,
}: ListTableSurfaceProps) {
  return (
    <Paper variant="outlined" sx={{ position: 'relative' }}>
      {loadingOverlay && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            bgcolor: 'rgba(255, 255, 255, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            {loadingOverlayMessage}
          </Typography>
        </Box>
      )}
      {initialLoading ? (
        <Typography sx={{ p: 2 }} color="text.secondary">
          {initialLoadingMessage}
        </Typography>
      ) : (
        children
      )}
    </Paper>
  )
}

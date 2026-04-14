import { Box } from '@mui/material'
import { useEffect } from 'react'
import { GanttBoard } from './GanttBoard'

/** AppBar toolbar ~64px + main vertical padding (schedule route uses `py:2` → 16×2). */
const SCHEDULE_VIEWPORT_OFFSET_PX = 64 + 16 * 2

export function SchedulePage() {
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow
    const prevBody = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [])

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        height: `calc(100dvh - ${SCHEDULE_VIEWPORT_OFFSET_PX}px)`,
        maxHeight: `calc(100dvh - ${SCHEDULE_VIEWPORT_OFFSET_PX}px)`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <GanttBoard />
      </Box>
    </Box>
  )
}

import { Box, Typography, useTheme } from '@mui/material'

type Props = {
  calendarStartMs: number
  totalHours: number
  pxPerHour: number
  widthPx: number
}

/**
 * Sticky timeline header: one column per wall-clock hour from `calendarStartMs`, alternating tint,
 * strong ticks at day boundaries, numeric hour label on every column.
 */
export function GanttTimeRuler({ calendarStartMs, totalHours, pxPerHour, widthPx }: Props) {
  const theme = useTheme()
  const hours = Math.ceil(totalHours)
  const stripeEven =
    theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100]
  const stripeOdd =
    theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200]

  return (
    <Box
      sx={{
        position: 'relative',
        height: 44,
        width: widthPx,
        flexShrink: 0,
        borderBottom: 2,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {Array.from({ length: hours }, (_, h) => {
        const t = new Date(calendarStartMs + h * 3600000)
        const prev = h > 0 ? new Date(calendarStartMs + (h - 1) * 3600000) : null
        const isDayStart = h === 0 || (prev != null && t.getDate() !== prev.getDate())
        const x = h * pxPerHour
        const timeLabel = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: false })

        return (
          <Box
            key={h}
            sx={{
              position: 'absolute',
              left: x,
              top: 0,
              width: pxPerHour,
              height: '100%',
              boxSizing: 'border-box',
              borderLeft: isDayStart ? '2px solid' : '1px solid',
              borderColor: isDayStart ? 'text.primary' : 'divider',
              bgcolor: h % 2 === 0 ? stripeEven : stripeOdd,
              pointerEvents: 'none',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                pl: 0.5,
                pt: 0.25,
                fontWeight: isDayStart ? 700 : 600,
                fontSize: '0.7rem',
                lineHeight: 1.1,
                color: isDayStart ? 'text.primary' : 'text.secondary',
                whiteSpace: 'nowrap',
              }}
            >
              {timeLabel}
            </Typography>
            {isDayStart ? (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  pl: 0.5,
                  fontSize: '0.6rem',
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Typography>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

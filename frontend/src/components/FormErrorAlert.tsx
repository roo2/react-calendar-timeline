import { useEffect, useRef } from 'react'
import { Alert, Box, Stack } from '@mui/material'

export function FormErrorAlert(props: {
  error: string | null
  messages?: readonly string[]
  /**
   * If true, scroll the alert into view whenever `error` becomes non-null.
   * Uses `scrollIntoView()` so it works inside long forms.
   */
  scrollOnShow?: boolean
  /**
   * Offset for fixed headers (e.g. app bar). Works with scrollIntoView().
   */
  scrollMarginTop?: number
}) {
  const { error, messages, scrollOnShow, scrollMarginTop } = props
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scrollOnShow) return
    if (!error) return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [error, scrollOnShow])

  if (!error) return null

  return (
    <div ref={ref} style={{ scrollMarginTop: scrollMarginTop ?? 0 }}>
      <Alert severity="error" sx={{ mb: 2 }}>
        <Stack spacing={1}>
          <div>{error}</div>
          {!!messages?.length && (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </Box>
          )}
        </Stack>
      </Alert>
    </div>
  )
}


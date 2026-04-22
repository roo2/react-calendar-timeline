import { useEffect, useState } from 'react'

/**
 * Returns `value` only after it has stayed stable for `delayMs` (default 300).
 * Useful for search boxes that trigger server requests.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

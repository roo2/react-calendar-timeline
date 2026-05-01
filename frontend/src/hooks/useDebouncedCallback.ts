import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounces a callback by `delayMs`. `flush()` runs any pending call immediately; `cancel()` drops it.
 * Uses a ref for the latest `fn` so callers can pass inline logic without stale closures.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): {
  (...args: A): void
  flush: () => void
  cancel: () => void
} {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgsRef = useRef<A | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingArgsRef.current = null
  }, [])

  const flush = useCallback(() => {
    const pending = pendingArgsRef.current
    if (pending == null) return
    cancel()
    fnRef.current(...pending)
  }, [cancel])

  const run = useCallback(
    (...args: A) => {
      pendingArgsRef.current = args
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const p = pendingArgsRef.current
        pendingArgsRef.current = null
        if (p != null) fnRef.current(...p)
      }, delayMs)
    },
    [delayMs],
  ) as {
    (...args: A): void
    flush: () => void
    cancel: () => void
  }

  run.flush = flush
  run.cancel = cancel

  useEffect(() => () => cancel(), [cancel])

  return run as {
    (...args: A): void
    flush: () => void
    cancel: () => void
  }
}

import { useEffect, useRef } from 'react'

const STORAGE_KEY = 'cp:debugEffects'

/** True when `localStorage.setItem('cp:debugEffects', '1')` in the browser console (dev only). */
export function isEffectLoopDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Logs effect re-runs and throws after many rapid runs (likely infinite loop).
 * Enable in dev: `localStorage.setItem('cp:debugEffects', '1')` then reload.
 */
export function useEffectLoopDetector(label: string, deps: React.DependencyList, maxRuns = 50): void {
  if (!isEffectLoopDebugEnabled()) return

  const countRef = useRef(0)
  const depsRef = useRef(deps)

  useEffect(() => {
    countRef.current += 1
    const n = countRef.current
    depsRef.current = deps

    if (n <= 5 || n % 10 === 0) {
      // eslint-disable-next-line no-console
      console.debug(`[effect-loop] ${label} #${n}`, deps)
    }
    if (n === maxRuns) {
      // eslint-disable-next-line no-console
      console.error(
        `[effect-loop] ${label} hit ${maxRuns} runs — likely infinite loop. Last deps:`,
        deps,
        new Error('effect loop stack'),
      )
    }
  }, deps)
}

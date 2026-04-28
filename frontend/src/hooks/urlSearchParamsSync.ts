/**
 * Helpers + hooks to persist list filter state in the URL query string (shareable bookmarks, back/forward).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

function normalizeSearchPart(search: string): string {
  return search.startsWith('?') ? search.slice(1) : search
}

export function parsePageFromUrl(searchParams: URLSearchParams, pageUrlKey = 'page'): number {
  const raw = searchParams.get(pageUrlKey)
  if (raw == null || raw === '') return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0
}

export function parseFiltersFromUrl(
  searchParams: URLSearchParams,
  defaults: Record<string, string>,
  urlKeys: Record<string, string>,
): Record<string, string> {
  const out = { ...defaults }
  for (const [stateKey, paramKey] of Object.entries(urlKeys)) {
    const v = searchParams.get(paramKey)
    if (v !== null) out[stateKey] = v
  }
  return out
}

export function buildParamsFromFilters(
  filters: Record<string, string>,
  urlKeys: Record<string, string>,
  pageIdx: number,
  pageUrlKey = 'page',
): URLSearchParams {
  const p = new URLSearchParams()
  for (const [stateKey, paramKey] of Object.entries(urlKeys)) {
    const v = filters[stateKey]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      p.set(paramKey, String(v))
    }
  }
  if (pageIdx > 0) {
    p.set(pageUrlKey, String(pageIdx + 1))
  }
  return p
}

function shallowEqualStringRecords(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (a[k] !== b[k]) return false
  }
  return true
}

export type UrlSyncedFiltersOptions = {
  defaults: Record<string, string>
  /** Maps React state field name → URL query parameter name */
  urlKeys: Record<string, string>
  pageUrlKey?: string
}

/**
 * Keeps a flat string filter record + zero-based page index in sync with the URL (replaceState).
 * Suitable for orders / job sheets style lists (no debounced search conflict).
 */
export function useUrlSyncedFilters(spec: UrlSyncedFiltersOptions) {
  const { defaults, urlKeys, pageUrlKey = 'page' } = spec
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState<Record<string, string>>(() =>
    parseFiltersFromUrl(searchParams, defaults, urlKeys),
  )
  const [pageIdx, setPageIdx] = useState(() => parsePageFromUrl(searchParams, pageUrlKey))

  const lastPushed = useRef<string | null>(null)

  // Push local state → URL when it changes
  useEffect(() => {
    const next = buildParamsFromFilters(filters, urlKeys, pageIdx, pageUrlKey)
    const nextStr = next.toString()
    const cur = new URLSearchParams(searchParams).toString()
    if (nextStr === cur) {
      lastPushed.current = nextStr
      return
    }
    lastPushed.current = nextStr
    setSearchParams(next, { replace: true })
  }, [filters, pageIdx, searchParams, setSearchParams, urlKeys, pageUrlKey])

  const location = useLocation()

  // Apply URL → state when the location search changes without matching our last push (e.g. back/forward or new link)
  useEffect(() => {
    const cur = normalizeSearchPart(location.search)
    if (lastPushed.current !== null && cur === lastPushed.current) return
    lastPushed.current = cur
    const sp = new URLSearchParams(cur)
    const parsed = parseFiltersFromUrl(sp, defaults, urlKeys)
    const p = parsePageFromUrl(sp, pageUrlKey)
    setFilters((prev) => (shallowEqualStringRecords(prev, parsed) ? prev : parsed))
    setPageIdx((prev) => (prev === p ? prev : p))
  }, [location.search, defaults, urlKeys, pageUrlKey])

  const setFilter = useCallback((key: string, value: string) => {
    setPageIdx(0)
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const patchFilters = useCallback((patch: Partial<Record<string, string>>) => {
    setPageIdx(0)
    setFilters((prev) => {
      const next: Record<string, string> = { ...prev }
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) next[k] = v
      }
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ ...defaults })
    setPageIdx(0)
  }, [defaults])

  return {
    filters,
    setFilters,
    setFilter,
    patchFilters,
    pageIdx,
    setPageIdx,
    clearFilters,
  }
}

/**
 * Customers list: search box updates immediately; URL (and API) follow debounced query + page.
 * Uses a last-written ref so URL updates from debounce do not fight in-progress typing.
 */
export function useCustomersListUrlSync(pageUrlKey = 'page') {
  const [, setSearchParams] = useSearchParams()
  const location = useLocation()

  const initialSearch =
    typeof window !== 'undefined' ? normalizeSearchPart(window.location.search) : ''
  const [searchInput, setSearchInput] = useState(
    () => new URLSearchParams(initialSearch).get('q') ?? '',
  )
  const [pageIdx, setPageIdx] = useState(() =>
    parsePageFromUrl(new URLSearchParams(initialSearch), pageUrlKey),
  )

  const lastWrittenSearch = useRef<string | null>(null)

  const writeUrl = useCallback(
    (debouncedQ: string, page: number) => {
      const p = new URLSearchParams()
      const q = debouncedQ.trim()
      if (q) p.set('q', q)
      if (page > 0) p.set(pageUrlKey, String(page + 1))
      const s = p.toString()
      lastWrittenSearch.current = s
      setSearchParams(p, { replace: true })
    },
    [pageUrlKey, setSearchParams],
  )

  useEffect(() => {
    const cur = normalizeSearchPart(location.search)
    if (lastWrittenSearch.current !== null && cur === lastWrittenSearch.current) return
    lastWrittenSearch.current = cur
    const sp = new URLSearchParams(cur)
    setSearchInput(sp.get('q') ?? '')
    setPageIdx(parsePageFromUrl(sp, pageUrlKey))
  }, [location.search, pageUrlKey])

  return {
    searchInput,
    setSearchInput,
    pageIdx,
    setPageIdx,
    /** Call from an effect when debounced query or page changes */
    writeUrl,
  }
}

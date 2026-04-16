import { parseFastApiValidationDetail } from './validation'

export type ApiErrorBody = {
  // FastAPI may return `detail` as a string OR a list of validation issues.
  detail?: unknown
  error?: string
  message?: string
}

export class ApiError extends Error {
  status: number
  body?: ApiErrorBody
  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message)
    this.status = status
    this.body = body
  }
}

type CsrfTokenGetter = () => string | null | undefined

let _csrfTokenGetter: CsrfTokenGetter = () => null

/**
 * Configure how apiFetch should retrieve the current CSRF token.
 *
 * This avoids importing the Redux store into the API client (which can create
 * circular dependencies), while still allowing automatic CSRF headers.
 */
export function setCsrfTokenGetter(getter: CsrfTokenGetter) {
  _csrfTokenGetter = getter
}

function isMutatingMethod(method: string) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers = new Headers(opts.headers || {})
  headers.set('Accept', 'application/json')

  const method = (opts.method || 'GET').toUpperCase()
  const token = isMutatingMethod(method) ? _csrfTokenGetter() : null
  if (token) headers.set('x-csrf-token', token)
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const resp = await fetch(path, {
    ...opts,
    headers,
    credentials: 'include',
  })

  const contentType = resp.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const hasBody = resp.status !== 204
  const data = (isJson && hasBody ? await resp.json().catch(() => undefined) : undefined) as unknown

  if (!resp.ok) {
    const body = (data as ApiErrorBody | undefined) || undefined
    const detail = body?.detail
    let msg =
      (typeof detail === 'string' ? detail : undefined) ||
      body?.error ||
      body?.message ||
      resp.statusText ||
      `HTTP ${resp.status}`
    if (Array.isArray(detail)) {
      const { messages: vm } = parseFastApiValidationDetail(detail)
      if (vm.length) msg = vm.join(' · ')
    }
    throw new ApiError(resp.status, msg, body)
  }

  return data as T
}

/**
 * Multipart POST (no JSON Content-Type). CSRF header is applied for mutating requests.
 */
export async function apiUploadMultipart<T>(path: string, formData: FormData): Promise<T> {
  const headers = new Headers()
  headers.set('Accept', 'application/json')
  const token = _csrfTokenGetter()
  if (token) headers.set('x-csrf-token', token)

  const resp = await fetch(path, {
    method: 'POST',
    body: formData,
    headers,
    credentials: 'include',
  })

  const contentType = resp.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const hasBody = resp.status !== 204
  const data = (isJson && hasBody ? await resp.json().catch(() => undefined) : undefined) as unknown

  if (!resp.ok) {
    const body = (data as ApiErrorBody | undefined) || undefined
    const detail = body?.detail
    let msg =
      (typeof detail === 'string' ? detail : undefined) ||
      body?.error ||
      body?.message ||
      resp.statusText ||
      `HTTP ${resp.status}`
    if (Array.isArray(detail)) {
      const { messages: vm } = parseFastApiValidationDetail(detail)
      if (vm.length) msg = vm.join(' · ')
    }
    throw new ApiError(resp.status, msg, body)
  }

  return data as T
}

export async function uploadPrintingArtworkPdf(
  path: string,
  file: File,
): Promise<{ ok: boolean; file: { id: string; filename: string; byte_size?: number } }> {
  const fd = new FormData()
  fd.append('file', file)
  return apiUploadMultipart(path, fd)
}

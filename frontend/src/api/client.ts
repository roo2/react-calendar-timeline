export type ApiErrorBody = {
  detail?: string
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

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { csrfToken?: string } = {},
): Promise<T> {
  const headers = new Headers(opts.headers || {})
  headers.set('Accept', 'application/json')

  if (opts.csrfToken) headers.set('x-csrf-token', opts.csrfToken)
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
    const msg = body?.detail || body?.error || body?.message || resp.statusText
    throw new ApiError(resp.status, msg || `HTTP ${resp.status}`, body)
  }

  return data as T
}


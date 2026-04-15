export type FastApiValidationIssue = {
  loc?: Array<string | number>
  msg?: string
  type?: string
  input?: unknown
  ctx?: unknown
}

export function isFastApiValidationIssue(x: unknown): x is FastApiValidationIssue {
  return !!x && typeof x === 'object' && 'loc' in x && 'msg' in x
}

export function locToFieldKey(loc: Array<string | number>): string {
  // Typical FastAPI loc looks like: ["body","contacts",0,"email"]
  const parts = loc[0] === 'body' ? loc.slice(1) : loc.slice()
  let out = ''
  for (const p of parts) {
    if (typeof p === 'number') {
      out += `[${p}]`
    } else if (!out) {
      out += p
    } else {
      out += `.${p}`
    }
  }
  return out
}

export function parseFastApiValidationDetail(detail: unknown): {
  fieldErrors: Record<string, string>
  messages: string[]
} {
  const fieldErrors: Record<string, string> = {}
  const messages: string[] = []

  if (!Array.isArray(detail)) return { fieldErrors, messages }

  for (const item of detail) {
    if (!isFastApiValidationIssue(item)) continue
    const loc = Array.isArray(item.loc) ? item.loc : []
    const key = locToFieldKey(loc)
    const msg = typeof item.msg === 'string' && item.msg.trim() ? item.msg.trim() : 'Invalid value'

    messages.push(key ? `${key}: ${msg}` : msg)

    if (key) {
      // Keep first message per field for helperText (simple + standard).
      if (!fieldErrors[key]) fieldErrors[key] = msg

      // Root validators on nested models often report loc ending at `spec.packaging` while the message names a leaf
      // field — map to the dotted path SpecPayloadForm uses for inputs.
      if (key === 'spec.packaging' || key.endsWith('.packaging')) {
        const lower = msg.toLowerCase()
        if (lower.includes('bags_per_carton') || lower.includes('bags per carton')) {
          if (!fieldErrors['spec.packaging.bags_per_carton']) fieldErrors['spec.packaging.bags_per_carton'] = msg
        }
      }
    }
  }

  return { fieldErrors, messages }
}


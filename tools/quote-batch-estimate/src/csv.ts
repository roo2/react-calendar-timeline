/** Minimal RFC4180-style CSV parser (one record per line; supports quoted fields). */

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = splitLinesKeepEmpty(text)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]
      if (!key) continue
      row[key] = cells[c] != null ? String(cells[c]) : ''
    }
    rows.push(row)
  }
  return { headers, rows }
}

function splitLinesKeepEmpty(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\r') continue
    if (ch === '\n') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1]
        if (next === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

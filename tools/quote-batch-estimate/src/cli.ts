/**
 * Batch quote estimates: same engine as the Quotes page (`computeQuickQuotePreview`).
 *
 * Usage:
 *   npm install
 *   npm run estimate -- --ratebook ./ratebook.json --input ./rows.csv [--output ./out.csv]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { buildQuickQuoteInputsFromSpec } from '../../../frontend/src/utils/specToQuoteInputs'
import { computeQuickQuotePreview, type QuoteRatebook } from '../../../frontend/src/utils/quoteCalculator'

import { parseCsv } from './csv'
import { buildSpecAndQuantityFromRow } from './buildSpecFromRow'
import { parseResinBlendsJson, type ResinBlendPreset } from './resinBlends'

function usage(): string {
  return `quote-batch-estimate

  npm run estimate -- --ratebook <ratebook.json> --input <rows.csv> [--output <out.csv>] [--resin-blends <resin-blends.json>]

  Export a real ratebook JSON from GET /api/rate-cards/ratebook (logged-in session) and pass it with --ratebook.
  If ./resin-blends.json exists in the working directory (or pass --resin-blends), blend rows match the Quotes UI (default preset LD unless CSV resin_blend says otherwise).
  See README.md for CSV column definitions.
`
}

function parseArgs(argv: string[]): {
  ratebook: string
  input: string
  output: string | null
  resinBlendsPath: string | null
} {
  let ratebook: string | null = null
  let input: string | null = null
  let output: string | null = null
  let resinBlendsPath: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ratebook' || a === '-r') ratebook = argv[++i] ?? null
    else if (a === '--input' || a === '-i' || a === '--csv') input = argv[++i] ?? null
    else if (a === '--output' || a === '-o') output = argv[++i] ?? null
    else if (a === '--resin-blends' || a === '--resin-blends-json') resinBlendsPath = argv[++i] ?? null
    else if (a === '--help' || a === '-h') {
      console.log(usage())
      process.exit(0)
    }
  }
  if (!ratebook || !input) {
    console.error(usage())
    process.exit(1)
  }
  return { ratebook: ratebook as string, input: input as string, output, resinBlendsPath }
}

function loadResinBlendsForRun(
  cwd: string,
  inputPath: string,
  explicitPath: string | null,
): ResinBlendPreset[] | null {
  if (explicitPath != null && String(explicitPath).trim() !== '') {
    const p = resolve(cwd, explicitPath)
    if (!existsSync(p)) {
      console.error(`resin-blends file not found: ${p}`)
      process.exit(1)
    }
    const raw = readFileSync(p, 'utf8')
    return parseResinBlendsJson(raw)
  }
  const auto = resolve(cwd, 'resin-blends.json')
  if (existsSync(auto)) {
    const raw = readFileSync(auto, 'utf8')
    return parseResinBlendsJson(raw)
  }
  const besideInput = resolve(dirname(resolve(cwd, inputPath)), 'resin-blends.json')
  if (existsSync(besideInput)) {
    const raw = readFileSync(besideInput, 'utf8')
    return parseResinBlendsJson(raw)
  }
  return null
}

function pickDefaultExtruder(rb: QuoteRatebook): string | null {
  const rows = Array.isArray(rb.extruders) ? rb.extruders : []
  const code = rows[0]?.extruder_code
  return code != null && String(code).trim() ? String(code).trim() : null
}

/** Use CSV extruder only if it exists on the ratebook; otherwise first extruder; otherwise null (throughput fallback in calculator). */
function resolveExtruderCode(rb: QuoteRatebook, rowCell: string | undefined): string | null {
  const list = Array.isArray(rb.extruders) ? rb.extruders : []
  const want = String(rowCell ?? '').trim()
  if (want && list.some((e) => String(e?.extruder_code || '') === want)) return want
  return pickDefaultExtruder(rb)
}

function parseMoney(s: string | undefined): number | null {
  if (s == null) return null
  const t = String(s).replace(/[$,\s]/g, '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function customerFromRow(row: Record<string, string>): string {
  return String(row.customer ?? '').trim()
}

function quoterFromRow(row: Record<string, string>): string {
  return String(row.quoter ?? '').trim()
}

/** `existing_quote_price` or legacy `existing_price`. */
function existingQuotePriceFromRow(row: Record<string, string>): string | undefined {
  const a = row.existing_quote_price
  if (a != null && String(a).trim() !== '') return String(a)
  const b = row.existing_price
  if (b != null && String(b).trim() !== '') return String(b)
  return undefined
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Two-decimal string for CSV / terminal summary (empty only when non-finite). */
function fmtMoney2(n: unknown): string {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return ''
  return (Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2)
}

/** % change vs existing: `(final − existing) / existing × 100`. Empty if existing is missing or zero. */
function fmtDeltaPct(finalNum: number, existingNum: number | null): string {
  if (existingNum == null || !Number.isFinite(existingNum) || existingNum === 0) return ''
  if (!Number.isFinite(finalNum)) return ''
  const pct = ((finalNum - existingNum) / existingNum) * 100
  if (!Number.isFinite(pct)) return ''
  return (Math.round((pct + Number.EPSILON) * 100) / 100).toFixed(2)
}

function main() {
  const cwd = process.cwd()
  const { ratebook: ratebookPath, input: inputPath, output, resinBlendsPath } = parseArgs(process.argv.slice(2))

  const ratebookRaw = readFileSync(resolve(cwd, ratebookPath), 'utf8')
  const ratebook = JSON.parse(ratebookRaw) as QuoteRatebook

  const resinBlends = loadResinBlendsForRun(cwd, inputPath, resinBlendsPath)
  if (resinBlends?.length) {
    console.error(`Using ${resinBlends.length} resin blend preset(s) from resin-blends data (CSV resin_blend defaults to LD).`)
  }

  const csvRaw = readFileSync(resolve(cwd, inputPath), 'utf8')
  const { rows } = parseCsv(csvRaw)

  const outCols = [
    'label',
    'final_price',
    'price_per_kg',
    'totals_kg',
    'totals_units',
    'rolls',
    'printing_unavailable_reason',
    'existing_quote_price',
    'price_delta_pct',
    'customer',
    'quoter',
  ]

  const lines: string[] = []
  lines.push(outCols.join(','))
  const summaryRows: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNo = i + 1
    try {
      const { spec, quantity } = buildSpecAndQuantityFromRow(row, { resinBlends })
      const extruderCode = resolveExtruderCode(ratebook, row.extruder_code)
      const inputs = buildQuickQuoteInputsFromSpec(spec, quantity, { extruderCode: extruderCode, ratebook })
      const preview = computeQuickQuotePreview(inputs, ratebook)

      const priceStr = fmtMoney2(preview.final_price)
      const finalNum = Number(preview.final_price)
      const existingRaw = existingQuotePriceFromRow(row)
      const existingNum = parseMoney(existingRaw)
      const deltaPctStr =
        existingNum != null && Number.isFinite(finalNum) ? fmtDeltaPct(finalNum, existingNum) : ''
      const existingEcho = existingRaw != null ? String(existingRaw).trim() : ''
      const customer = customerFromRow(row)
      const quoter = quoterFromRow(row)

      const cells = [
        String(row.label ?? ''),
        priceStr,
        preview.price_per_kg != null ? fmtMoney2(preview.price_per_kg) : '',
        preview.totals_kg != null ? String(preview.totals_kg) : '',
        preview.totals_units != null ? String(preview.totals_units) : '',
        preview.rolls != null ? String(preview.rolls) : '',
        String(preview.printing_unavailable_reason ?? ''),
        existingEcho,
        deltaPctStr !== '' ? `${deltaPctStr}%` : '',
        customer,
        quoter,
      ].map((c) => csvEscape(c))
      lines.push(cells.join(','))

      const labelShort = String(row.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 56)
      const custQuotEnd =
        customer || quoter ? `  (${[customer, quoter].filter(Boolean).join(' · ')})` : ''
      const dollars = priceStr ? `$${priceStr}` : '—'
      const pctFmt =
        deltaPctStr !== ''
          ? `  vs existing: ${Number(deltaPctStr) >= 0 ? '+' : ''}${deltaPctStr}%`
          : existingEcho
            ? '  vs existing: —'
            : ''
      summaryRows.push(`  #${String(lineNo).padEnd(4)} ${dollars.padStart(14)}${pctFmt}  ${labelShort}${custQuotEnd}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const existingRaw = existingQuotePriceFromRow(row)
      const existingEcho = existingRaw != null ? String(existingRaw).trim() : ''
      const cells = [
        String(row.label ?? ''),
        '',
        '',
        '',
        '',
        '',
        `ERROR: ${msg}`,
        existingEcho,
        '',
        customerFromRow(row),
        quoterFromRow(row),
      ].map((c) => csvEscape(c))
      lines.push(cells.join(','))
      summaryRows.push(`  #${lineNo} ${'—'.padStart(14)}  ERROR: ${msg.replace(/\s+/g, ' ').slice(0, 100)}`)
    }
  }

  const text = lines.join('\n') + '\n'
  if (output) {
    writeFileSync(resolve(cwd, output), text, 'utf8')
    console.error(`Wrote ${lines.length - 1} row(s) to ${resolve(cwd, output)}`)
  } else {
    process.stdout.write(text)
  }

  if (summaryRows.length > 0) {
    console.error('')
    console.error(
      'Final price (per CSV row):  vs existing % = (estimate − existing_quote_price) / existing_quote_price × 100 when that column is set and non-zero',
    )
    console.error('  #    final_price    vs existing %  label  (customer · quoter)')
    for (const s of summaryRows) console.error(s)
    console.error('')
  }
}

main()

/**
 * Batch quote estimates: same engine as the Quotes page (`computeQuickQuotePreview`).
 *
 * Usage:
 *   npm install
 *   npm run estimate -- --ratebook ./ratebook.json --input ./rows.csv [--output ./out.csv]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { buildQuickQuoteInputsFromSpec } from '../../../frontend/src/utils/specToQuoteInputs'
import { computeQuickQuotePreview, type QuoteRatebook } from '../../../frontend/src/utils/quoteCalculator'

import { parseCsv } from './csv'
import { buildSpecAndQuantityFromRow } from './buildSpecFromRow'

function usage(): string {
  return `quote-batch-estimate

  npm run estimate -- --ratebook <ratebook.json> --input <rows.csv> [--output <out.csv>]

  Export a real ratebook JSON from GET /api/rate-cards/ratebook (logged-in session) and pass it with --ratebook.
  See README.md for CSV column definitions.
`
}

function parseArgs(argv: string[]): { ratebook: string; input: string; output: string | null } {
  let ratebook: string | null = null
  let input: string | null = null
  let output: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ratebook' || a === '-r') ratebook = argv[++i] ?? null
    else if (a === '--input' || a === '-i' || a === '--csv') input = argv[++i] ?? null
    else if (a === '--output' || a === '-o') output = argv[++i] ?? null
    else if (a === '--help' || a === '-h') {
      console.log(usage())
      process.exit(0)
    }
  }
  if (!ratebook || !input) {
    console.error(usage())
    process.exit(1)
  }
  return { ratebook: ratebook as string, input: input as string, output }
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
  const { ratebook: ratebookPath, input: inputPath, output } = parseArgs(process.argv.slice(2))

  const ratebookRaw = readFileSync(resolve(cwd, ratebookPath), 'utf8')
  const ratebook = JSON.parse(ratebookRaw) as QuoteRatebook

  const csvRaw = readFileSync(resolve(cwd, inputPath), 'utf8')
  const { rows } = parseCsv(csvRaw)

  const outCols = [
    'customer',
    'quoter',
    'label',
    'final_price',
    'price_per_kg',
    'totals_kg',
    'totals_units',
    'rolls',
    'printing_unavailable_reason',
    'existing_quote_price',
    'price_delta',
    'price_delta_pct',
  ]

  const lines: string[] = []
  lines.push(outCols.join(','))
  const summaryRows: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNo = i + 1
    try {
      const { spec, quantity } = buildSpecAndQuantityFromRow(row)
      const extruderCode = resolveExtruderCode(ratebook, row.extruder_code)
      const inputs = buildQuickQuoteInputsFromSpec(spec, quantity, { extruderCode: extruderCode, ratebook })
      const preview = computeQuickQuotePreview(inputs, ratebook)

      const priceStr = fmtMoney2(preview.final_price)
      const finalNum = Number(preview.final_price)
      const existingRaw = existingQuotePriceFromRow(row)
      const existingNum = parseMoney(existingRaw)
      const deltaStr =
        existingNum != null && Number.isFinite(finalNum)
          ? fmtMoney2(finalNum - existingNum)
          : ''
      const deltaPctStr =
        existingNum != null && Number.isFinite(finalNum) ? fmtDeltaPct(finalNum, existingNum) : ''
      const existingEcho = existingRaw != null ? String(existingRaw).trim() : ''
      const customer = customerFromRow(row)
      const quoter = quoterFromRow(row)

      const cells = [
        customer,
        quoter,
        String(row.label ?? ''),
        priceStr,
        preview.price_per_kg != null ? fmtMoney2(preview.price_per_kg) : '',
        preview.totals_kg != null ? String(preview.totals_kg) : '',
        preview.totals_units != null ? String(preview.totals_units) : '',
        preview.rolls != null ? String(preview.rolls) : '',
        String(preview.printing_unavailable_reason ?? ''),
        existingEcho,
        deltaStr,
        deltaPctStr !== '' ? `${deltaPctStr}%` : '',
      ].map((c) => csvEscape(c))
      lines.push(cells.join(','))

      const labelShort = String(row.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 64)
      const custQuot =
        customer || quoter
          ? `[${[customer, quoter].filter(Boolean).join(' · ')}] `.slice(0, 48)
          : ''
      const dollars = priceStr ? `$${priceStr}` : '—'
      const pctFmt =
        deltaPctStr !== '' ? ` (${Number(deltaPctStr) >= 0 ? '+' : ''}${deltaPctStr}%)` : ''
      const deltaFmt =
        deltaStr !== ''
          ? ` Δ ${Number(deltaStr) >= 0 ? '+' : ''}$${deltaStr}${pctFmt}`
          : existingEcho
            ? ' Δ —'
            : ''
      summaryRows.push(`  #${String(lineNo).padEnd(4)} ${custQuot}${dollars.padStart(14)}${deltaFmt} ${labelShort}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const existingRaw = existingQuotePriceFromRow(row)
      const existingEcho = existingRaw != null ? String(existingRaw).trim() : ''
      const cells = [
        customerFromRow(row),
        quoterFromRow(row),
        String(row.label ?? ''),
        '',
        '',
        '',
        '',
        '',
        `ERROR: ${msg}`,
        existingEcho,
        '',
        '',
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
      'Final price (per CSV row):  Δ = estimate − existing_quote_price; % = (estimate − existing) / existing × 100 when existing is set and non-zero',
    )
    console.error('  #    final_price    (delta vs existing)  label')
    for (const s of summaryRows) console.error(s)
    console.error('')
  }
}

main()

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

function parseMoney(s: string | undefined): number | null {
  if (s == null) return null
  const t = String(s).replace(/[$,\s]/g, '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function pickDefaultExtruder(rb: QuoteRatebook): string | null {
  const rows = Array.isArray(rb.extruders) ? rb.extruders : []
  const code = rows[0]?.extruder_code
  return code != null && String(code).trim() ? String(code).trim() : null
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function main() {
  const cwd = process.cwd()
  const { ratebook: ratebookPath, input: inputPath, output } = parseArgs(process.argv.slice(2))

  const ratebookRaw = readFileSync(resolve(cwd, ratebookPath), 'utf8')
  const ratebook = JSON.parse(ratebookRaw) as QuoteRatebook

  const csvRaw = readFileSync(resolve(cwd, inputPath), 'utf8')
  const { rows } = parseCsv(csvRaw)
  const defaultEx = pickDefaultExtruder(ratebook)

  const outCols = [
    'row_id',
    'label',
    'final_price',
    'price_per_kg',
    'totals_kg',
    'totals_units',
    'rolls',
    'printing_unavailable_reason',
    'ref_production',
    'ref_existing',
    'delta_vs_ref_production',
    'delta_vs_ref_existing',
  ]

  const lines: string[] = []
  lines.push(outCols.join(','))

  for (const row of rows) {
    const rowId = String(row.row_id ?? '').trim() || '?'
    try {
      const { spec, quantity } = buildSpecAndQuantityFromRow(row)
      const ex = String(row.extruder_code || '').trim() || defaultEx || ''
      const inputs = buildQuickQuoteInputsFromSpec(spec, quantity, { extruderCode: ex || null })
      const preview = computeQuickQuotePreview(inputs, ratebook)

      const refP = parseMoney(row.ref_production)
      const refE = parseMoney(row.ref_existing)
      const finalP = Number(preview.final_price)
      const dProd = refP != null && Number.isFinite(finalP) ? round2(finalP - refP) : ''
      const dExist = refE != null && Number.isFinite(finalP) ? round2(finalP - refE) : ''

      const cells = [
        rowId,
        String(row.label ?? ''),
        round2(preview.final_price),
        preview.price_per_kg != null ? String(preview.price_per_kg) : '',
        preview.totals_kg != null ? String(preview.totals_kg) : '',
        preview.totals_units != null ? String(preview.totals_units) : '',
        preview.rolls != null ? String(preview.rolls) : '',
        String(preview.printing_unavailable_reason ?? ''),
        row.ref_production != null ? String(row.ref_production) : '',
        row.ref_existing != null ? String(row.ref_existing) : '',
        dProd === '' ? '' : String(dProd),
        dExist === '' ? '' : String(dExist),
      ].map((c) => csvEscape(c))
      lines.push(cells.join(','))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const cells = [
        rowId,
        String(row.label ?? ''),
        '',
        '',
        '',
        '',
        '',
        `ERROR: ${msg}`,
        row.ref_production != null ? String(row.ref_production) : '',
        row.ref_existing != null ? String(row.ref_existing) : '',
        '',
        '',
      ].map((c) => csvEscape(c))
      lines.push(cells.join(','))
    }
  }

  const text = lines.join('\n') + '\n'
  if (output) {
    writeFileSync(resolve(cwd, output), text, 'utf8')
    console.error(`Wrote ${lines.length - 1} row(s) to ${resolve(cwd, output)}`)
  } else {
    process.stdout.write(text)
  }
}

function round2(n: number): string {
  if (!Number.isFinite(n)) return ''
  return String(Math.round((n + Number.EPSILON) * 100) / 100)
}

main()

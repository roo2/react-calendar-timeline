# Quote batch estimate (CLI)

Runs the **same TypeScript quote engine** as the Quotes page (`computeQuickQuotePreview` in `frontend/src/utils/quoteCalculator.ts`) against rows in a CSV file. This folder is self-contained: it does not change Vite routes or app bundles.

## Setup

```bash
cd tools/quote-batch-estimate
npm install
```

## Ratebook JSON

The calculator needs a full **QuoteRatebook** object (same shape as `GET /api/rate-cards/ratebook`).

1. Log into the app in a browser, open DevTools → Network, load Quotes (or any page that fetches the ratebook).
2. Copy the JSON response from `/api/rate-cards/ratebook` and save it, e.g. `my-ratebook.json`.

**Important:** In the API, each resin’s `density` is stored as **kg/cm³** (e.g. LDPE ≈ `0.00092`). The frontend multiplies by 10⁶ internally to get kg/m³. If you hand-edit JSON, use the same units as the API, not kg/m³.

For a tiny sanity check only (not for matching production dollars), this folder includes `ratebook.smoke.json`.

## CSV columns

The CLI maps each row to a minimal `SpecPayload` + quantity slice, then calls `buildQuickQuoteInputsFromSpec` → `computeQuickQuotePreview`.

| Column | Required | Description |
|--------|----------|-------------|
| `row_id` | suggested | Stable id for output |
| `label` | optional | Free-text description (echoed to output) |
| `product_type` | yes | `Bag`, `Tube`, `Sleeve`, `Sheet`, `Centerfold`, `U-Film` |
| `geometry` | yes | `Flat` or `Gusset` (gusset uses `base_width_mm` + `gusset_mm` as in the app) |
| `base_width_mm` | yes | Layflat-related width (mm) |
| `gusset_mm` | if Gusset | Return gusset (mm) |
| `base_length_mm` | usually | Cut length (mm). Tubes are always treated as continuous in the app; length still affects some paths—see Quotes UI behaviour. |
| `length_units` | optional | `mm` (default), `M`, or `Continuous` |
| `thickness_um` | yes | Gauge (µm) |
| `finish_mode` | optional | `Rolls` (default) or `Cartons` |
| `print_method` | optional | `None`, `Inline`, `Uteco` |
| `num_colours` | optional | Integer; use `0` with `None` |
| `colour` | optional | e.g. `GREEN` or `GREEN:3` for 3% strength |
| `resin_blend` | optional | Formulation `blend_type` (e.g. `LD`); defaults to `LD` |
| `run_up` | optional | `none`, `2up`, `4up`, `6up` (Sheet/Centerfold) |
| `qty_type` | yes | `kg`, `units`, `total_rolls`, `rolls_units` |
| `num_units` | if needed | Bag/product count |
| `num_rolls` | if needed | Roll count |
| `units_per_roll` | for `rolls_units` | e.g. bags per roll |
| `total_kg` | for `kg` | Total order kg |
| `weight_per_roll_kg` | optional | For roll / kg derivations |
| `extruder_code` | optional | Defaults to the **first** extruder in the ratebook if blank |
| `core_type` | optional | Defaults to `7mm` |
| `roll_weight_billing` | optional | `core_off` (default), `core_included`, `core_half_off` |
| `bags_per_carton` | Cartons | Integer |
| `carton_option_slug` | optional | Matches ratebook carton slugs |
| `inline_perforation`, `inline_seal`, `hole_punched` | optional | `true`/`1` or false |
| `trim_pct` | optional | Yield trim % |
| `print_side` | optional | Passed through to spec (`front` default) |
| `ref_production`, `ref_existing` | optional | Reference totals from invoices (numbers or `$1,234.56`); used only for delta columns in output |

`sample-rows.csv` encodes the example invoice lines you provided as **starting guesses**. You will need to adjust dimensions, `qty_type`, and roll fields until totals match how those jobs were entered in Production Software.

## Run

```bash
cd tools/quote-batch-estimate
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv
```

Write results to a file:

```bash
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv --output ./results.csv
```

Output columns include `final_price`, `price_per_kg`, `totals_kg`, `totals_units`, `rolls`, `printing_unavailable_reason`, optional deltas vs `ref_*`.

## Layout

```
tools/quote-batch-estimate/
  package.json          # tsx + typescript only
  tsconfig.json
  README.md
  ratebook.smoke.json   # tiny ratebook for smoke runs
  sample-rows.csv       # example rows (tune for parity with invoices)
  src/
    cli.ts              # entrypoint
    csv.ts              # minimal CSV parser
    buildSpecFromRow.ts # CSV → spec + quantity slice
```

Imports resolve into `../../frontend/src/utils/…` so the CLI always tracks the same calculator as the web app.

This package is **run with `tsx` only** (no separate `tsc` project): importing `specToQuoteInputs` pulls a `type` reference to `SpecPayloadForm.tsx`, which would drag the full React app into a standalone TypeScript build. The main app’s `frontend/npm run build` remains the source of truth for type errors in those modules.

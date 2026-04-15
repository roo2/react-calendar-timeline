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

CSV rows usually omit a full `formulation.blend`; the CLI then picks a **single fallback resin code from the same ratebook JSON** (`LDPE` if that key exists, otherwise the first resin in `resins`). That matches the Quotes page when no blend rows are stored. If `LDPE` is missing and you hard-coded the old implicit default, mass and price were understated (~half density vs real LD grades).

For a tiny sanity check only (not for matching production dollars), this folder includes `ratebook.smoke.json`.

## CSV columns

The CLI maps each row to a minimal `SpecPayload` + quantity slice, then calls `buildQuickQuoteInputsFromSpec` → `computeQuickQuotePreview`.

| Column | Required | Description |
|--------|----------|-------------|
| `customer` | optional | Customer name or code (echoed to output; not used in the calculator) |
| `quoter` | optional | Who quoted the line, e.g. `ross` or `joe` (echoed to output; not used in the calculator) |
| `label` | optional | Free-text description (echoed to output) |
| `product_type` | yes | `Bag`, `Tube`, `Sleeve`, `Sheet`, `Centerfold`, `U-Film` |
| `base_width_mm` | yes | Layflat-related width (mm) |
| `gusset_mm` | optional | Return gusset (mm). If **> 0** and the product type allows gussets (`Bag`, `Tube`), geometry is **Gusset**; otherwise **Flat** (ignored for other types). |
| `base_length_mm` | usually | Cut length **in mm** (always interpreted as mm). Tubes are still treated as **continuous length** in the calculator when `product_type` is `Tube`. |
| `thickness_um` | yes | Gauge (µm) |
| `finish_mode` | optional | `Rolls` (default) or `Cartons` |
| `print_method` | optional | `None`, `Inline`, `Uteco` |
| `num_colours` | optional | Integer; use `0` with `None` |
| `colour` | optional | e.g. `GREEN` defaults to **2%** strength in the compound (typical tint). Use `GREEN:5` for an explicit % (masterbatch loading passed through to the same material model as the Quotes page). |
| `resin_blend` | optional | Formulation `blend_type` (e.g. `LD`); defaults to `LD` |
| `run_up` | optional | `none`, `2up`, `4up`, `6up` (Sheet/Centerfold) |
| `qty_type` | yes | `kg`, `units`, `total_rolls`, `rolls_units` |
| `num_units` | if needed | Bag/product count |
| `num_rolls` | if needed | Roll count |
| `units_per_roll` | for `rolls_units` | e.g. bags per roll |
| `total_kg` | for `kg` | Total order kg |
| `weight_per_roll_kg` | optional | For roll / kg derivations |
| `extruder_code` | optional | If blank or not found on the ratebook, the **first** extruder in the ratebook is used. If there are no extruders, the calculator uses `extrusion_throughput_kg_per_hr` for waste timing (same as the app). |
| `core_type` | optional | Defaults to `7mm` |
| `roll_weight_billing` | optional | `core_off` (default), `core_included`, `core_half_off` |
| `bags_per_carton` | Cartons | Integer |
| `inline_perforation`, `inline_seal`, `hole_punched` | optional | `true`/`1` or false |
| `trim_pct` | optional | Yield trim % |
| `print_side` | optional | Passed through to spec (`front` default) |
| `existing_quote_price` | optional | Prior / invoice total (number or `$30,163.56`). Echoed in output; **`price_delta`** = `final_price − existing_quote_price` when parsable; **`price_delta_pct`** = `(final_price − existing) / existing × 100` (empty if existing is zero or missing). Alias: `existing_price`. |

There is no `geometry` or `length_units` column: gusset vs flat is inferred from **`gusset_mm`**, and length is always **mm**.

Extra columns (e.g. internal refs) are ignored except **`customer`**, **`quoter`**, **`existing_quote_price`** / **`existing_price`**. **`extruder_code`** remains optional (defaults from the ratebook).

`sample-rows.csv` is a minimal example; adjust dimensions and quantity fields to match how jobs are entered in the app.

## Run

```bash
cd tools/quote-batch-estimate
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv
```

Write results to a file:

```bash
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv --output ./results.csv
```

Output CSV columns: `customer`, `quoter`, `label`, `final_price`, `price_per_kg`, `totals_kg`, `totals_units`, `rolls`, `printing_unavailable_reason`, `existing_quote_price`, `price_delta`, `price_delta_pct` (`price_delta_pct` is a number with a `%` suffix in the CSV, e.g. `-0.78%`).

After each run, a **Final price** summary (with **Δ** in dollars and **(±pct%)** vs `existing_quote_price` when set) is printed to **stderr** (so you still see prices when using `--output` to write CSV only to a file). When `customer` or `quoter` is set, the summary prefixes **`[customer · quoter]`**. Rows are numbered `#1`, `#2`, … in row order.

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

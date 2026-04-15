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

When **`resin-blends.json`** is present in the working directory (export from `GET /api/rate-cards/resin-blends`, same as the app) or passed with **`--resin-blends <path>`**, the CLI fills `formulation.blend` from the preset whose `blend_code` matches the CSV **`resin_blend`** column, defaulting to **`LD`** when that column is empty—same as the Quotes page.

If no resin-blends file is loaded or the code is unknown, `formulation.blend` stays empty and the CLI uses a **single fallback resin** from the ratebook (`LDPE` if present, else the first resin in `resins`), matching the app when no blend components are stored.

For a tiny sanity check only (not for matching production dollars), this folder includes `ratebook.smoke.json`.

## CSV columns

The CLI maps each row to a minimal `SpecPayload` + quantity slice, then calls `buildQuickQuoteInputsFromSpec` → `computeQuickQuotePreview`.

| Column | Required | Description |
|--------|----------|-------------|
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
| `qty_type` | yes | `kg`, `units`, `total_rolls`, `rolls_units`. **`rolls_kg`** is accepted as an alias for **`total_rolls`** when `num_rolls` and `weight_per_roll_kg` are both positive (otherwise it falls through to `kg`). |
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
| `existing_quote_price` | optional | Prior / invoice total (number or `$30,163.56`). Echoed in output. **`price_delta_pct`** = `(final_price − existing) / existing × 100` with a `%` suffix in the CSV (empty if existing is zero or missing). Alias: `existing_price`. |
| `customer` | optional | Customer name or code (echoed as the **last** output column; not used in the calculator) |
| `quoter` | optional | Who quoted the line, e.g. `ross` or `joe` (echoed last; not used in the calculator) |

There is no `geometry` or `length_units` column: gusset vs flat is inferred from **`gusset_mm`**, and length is always **mm**.

Extra columns (e.g. internal refs) are ignored except **`customer`**, **`quoter`**, **`existing_quote_price`** / **`existing_price`**. **`extruder_code`** remains optional (defaults from the ratebook).

`sample-rows.csv` is a minimal example; adjust dimensions and quantity fields to match how jobs are entered in the app.

### Why CLI total can differ slightly from the Quotes UI

Use the **same** ratebook JSON and align inputs as closely as possible. Typical sources of a few‑percent gap:

- **`qty_type` / columns** — e.g. an unknown `qty_type` was treated as **`kg`** until **`rolls_kg`** was added as an alias for **`total_rolls`** when rolls and weight/roll are set. Prefer **`total_rolls`**, **`kg`**, **`rolls_units`**, or **`units`** explicitly.
- **Extruder** — the CLI picks the CSV `extruder_code` if valid on the ratebook, else the **first** extruder row; the UI auto-picks by **layflat vs `decision_width_mm`**. Different extruder → different waste minutes / throughput → small price shift.
- **Resin / blend** — load **`resin-blends.json`** (or `--resin-blends`) so the default **`LD`** preset and per-row **`resin_blend`** match the UI. Without it, an empty blend uses **`getDefaultResinCodeFromRatebook`**; the UI may still show a house blend from presets.
- **Colour strength** — CSV colour without `:pct` uses **2%** tint default; the UI uses whatever you typed in the materials table.
- **Suggested $/kg override** in the UI — if set, it overrides the summed retail path; the CLI does not read that from CSV.
- **Rounding** — UI may show **2 dp** while intermediate steps carry more precision.

## Run

```bash
cd tools/quote-batch-estimate
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv
```

Write results to a file:

```bash
npm run estimate -- --ratebook ./my-ratebook.json --input ./my-rows.csv --output ./results.csv
```

Output CSV columns: `label`, `final_price`, `price_per_kg`, `totals_kg`, `totals_units`, `rolls`, `printing_unavailable_reason`, `existing_quote_price`, `price_delta_pct`, `customer`, `quoter` (`price_delta_pct` is a number with a `%` suffix, e.g. `-0.78%`; there is **no** dollar delta column).

After each run, a **Final price** summary is printed to **stderr** (so you still see results when using `--output`): **vs existing** shows **percentage only** when `existing_quote_price` is set; **customer · quoter** appears at the **end** of each summary line when present. Rows are numbered `#1`, `#2`, … in CSV order.

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
    resinBlends.ts      # parse API resin-blends JSON → formulation.blend
```

Imports resolve into `../../frontend/src/utils/…` so the CLI always tracks the same calculator as the web app.

This package is **run with `tsx` only** (no separate `tsc` project): importing `specToQuoteInputs` pulls a `type` reference to `SpecPayloadForm.tsx`, which would drag the full React app into a standalone TypeScript build. The main app’s `frontend/npm run build` remains the source of truth for type errors in those modules.

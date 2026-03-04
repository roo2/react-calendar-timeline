# Shipping: pallet count and volume

This note describes how to work out **how many pallets** are needed (for rolls), so you can then add a shipping cost calculation.

## 1. Roll volume (envelope – cylinder)

A roll is a cylinder. Its **envelope volume** (space it occupies) is:

```
V_roll = π × R² × W
```

- **R** = outer radius of the roll (metres)
- **W** = roll width (metres) = layflat width = `layflatMm / 1000`

We already have **W** from the quote (layflat width). We do **not** currently store roll outer diameter (or R) anywhere.

### Option A – Estimate R from film and core

Film on the roll has:

- Length **L** = `m_per_roll` (m)
- Width **W** (m)
- Thickness **t** (m) = `thickness_um / 1e6`

Cross‑section of the wound film (annulus) has area:

```
A_film = L × t
```
   
So:

```
π × (R² − r_core²) = A_film  =>  R = √(r_core² + A_film / π)
```

- **r_core** = inner (core) radius in metres. You need a value per core type (e.g. 7mm → 38 mm inner radius if 76 mm inner diameter; 13mm → 65 mm if 130 mm inner diameter). These could live in config or in the cores table (e.g. `core_inner_diameter_mm`).

Then:

```
V_roll = π × R² × W
```

### Option B – Direct “volume per roll” or “rolls per pallet”

If you prefer not to model R:

- Store **volume per roll** (m³) by product/roll size, or
- Store **rolls per pallet** by width/diameter band.

Then:

- Either: `total_volume = rolls × volume_per_roll` and use that in step 2.
- Or: `pallets = ceil(rolls / rolls_per_pallet)` and skip volume.

---

## 2. Total roll volume

```
V_total_rolls = N_rolls × V_roll
```

Use `V_roll` from Option A or from a “volume per roll” value (Option B).

---

## 3. Pallets needed (using pallet volume and packing factor)

You said you have:

- **Pallet volume capacity** (e.g. m³ per pallet)
- **Packing factor for cylinders** (e.g. 0.6–0.7, because cylinders don’t fill the space perfectly)

Then:

```
effective_pallet_volume = pallet_volume_capacity × packing_factor
pallets_needed = ceil(V_total_rolls / effective_pallet_volume)
```

So:

```
pallets_needed = ceil( (N_rolls × V_roll) / (pallet_volume_capacity × packing_factor) )
```

---

## 4. What to add in the app

### Data (config or DB)

- **Pallet volume capacity** (m³ per pallet), e.g. by pallet type (Chep, Plain, etc.) if it varies.
- **Packing factor** for cylinders (0–1), e.g. single value or by pallet type.
- **For Option A:** core inner diameter (or radius) per core type, e.g. in `cores` table or conversion factors.

### Calculator (e.g. in `quoteCalculator.ts`)

1. **Rolls mode only:** if `finish_mode === 'Rolls'` and `rolls` and `kg_per_roll`/`m_per_roll` and layflat width are known:
   - Compute **V_roll** (Option A: from core radius + `m_per_roll`, `thickness_um`, `layflatMm`; or Option B: from stored volume per roll).
   - `V_total_rolls = rolls × V_roll`.
   - `effective_pallet_volume = pallet_volume_capacity × packing_factor`.
   - `pallets = ceil(V_total_rolls / effective_pallet_volume)`.
2. **Cartons mode:** you can add a separate rule later (e.g. cartons per layer × layers per pallet, or volume of cartons).

### Shipping cost

Once you have `pallets_needed` (and optionally total weight for chargeable weight):

- e.g. `shipping_cost = pallets_needed × cost_per_pallet`, or
- use your carrier’s rule (weight vs volume, zones, etc.).

---

## 5. Summary formulae (Option A – estimate R from core + film)

Given:

- `layflatMm`, `m_per_roll`, `thickness_um`, `rolls`
- Core inner radius `r_core` (m) for the selected core type
- `pallet_volume_capacity` (m³), `packing_factor` (0–1)

```text
W_m        = layflatMm / 1000
t_m        = thickness_um / 1e6
A_film     = m_per_roll × t_m
R          = sqrt(r_core² + A_film / π)
V_roll     = π × R² × W_m
V_total    = rolls × V_roll
pallets    = ceil(V_total / (pallet_volume_capacity × packing_factor))
```

Then use `pallets` for shipping cost (e.g. cost per pallet × pallets).

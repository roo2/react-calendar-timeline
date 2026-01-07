SDS 10 — UI Architecture & Navigation

1. Theming & Design Tokens

Purpose

Enable site‑wide branding (logo, colors, typography, shape tokens) via semantic design tokens and CSS variables so future rebranding requires configuration, not code changes.

Principles

Semantic tokens only in templates (no hard‑coded hex or font names).
CSS variables define the active theme; base CSS refers only to variables.
Logo and fonts are assets referenced by the active BrandTheme.

Implementation (MVP)

Base layout injects the active theme style (inline <style> or /static/theme.css?v={hash}).
Variables (illustrative subset):

```css
:root {
  /* Palette */
  --color-primary: #0052cc;
  --color-primary-contrast: #ffffff;
  --color-secondary: #4c6fff;
  --color-accent: #ff7a59;
  --color-surface: #ffffff;
  --color-surface-alt: #f6f7fb;
  --color-text-primary: #111111;
  --color-text-secondary: #4a4a4a;
  --color-border: #e6e8f0;
  --color-success: #2e7d32;
  --color-warning: #ed6c02;
  --color-danger: #c62828;

  /* Shape */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  /* Typography */
  --font-heading: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --font-body: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

Templates/styles must consume only variables (e.g., buttons use var(--color-primary), headings use var(--font-heading)).

Logo placement

Header, login page, and PDF/print templates pull BrandTheme.assets.logo_svg_url (fallback to PNG).

Fonts

Support uploaded WOFF2/WOFF hosted locally; declare @font-face blocks per BrandTheme with fallbacks.

```css
@font-face {
  font-family: "Inter";
  src: url("/uploads/fonts/inter-regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

Dark Mode (optional, MVP+)

Use [data-theme="dark"] on <html> to override variables; default light.

```css
[data-theme="dark"] {
  --color-surface: #0f1115;
  --color-surface-alt: #151821;
  --color-text-primary: #f2f3f5;
  --color-text-secondary: #c7c9d1;
  --color-border: #272b36;
}
```

PDF/Printables

Reuse the same variables via a print stylesheet; embed logo SVG for crisp output.

HTMX Live Preview

On theme edit, swap a <style id="theme"> block with newly rendered CSS to preview without reload.

Failure Modes & Fallbacks

If BrandTheme not set or assets invalid → use default system theme and system fonts.
Block saving palettes that fail contrast (WCAG AA) on primary/surface/text combinations.

2. Navigation (unchanged for branding)

Primary nav and controls inherit colors/typography from variables; no hard‑coded per‑page overrides.
Operational Dashboard (MVP)

1. Audience

Production Manager (primary), read-only for Sales/Operator.

2. Layout (Cards + Trends)

Inventory & WIP (point-in-time):

Raw materials (kg)

WIP — Extrusion (kg), Printing (kg)

Finished goods on hand (units)

WIP by Stage (today & week trend): running jobs, queued count, WIP balances

Throughput & Productivity (weekly):

Kg extruded, metres printed, units converted

Runtime hours vs operating hours (utilization %)

Jobs completed

Flow/Turns:

Median/95p job_flow_time (days)

Weekly inventory_turns

Quality (weekly):

First-pass yield %

Deviations count

Fulfilment Accuracy (weekly):

Jobs off target (#)

Total under_units, over_units; top offenders

3. Interactions

Time window selector: this week, last week, last 4 weeks.

Drill-down links to: Inventory ledger, Schedule, Production, QC reports, Dispatch list.

4. Tech

Server-rendered page; each card refreshable via HTMX; optimistic cache for 30–60s.


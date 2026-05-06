import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import type { SpecPayload } from '../../components/SpecPayloadForm'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'
import { fetchQuoteRatebook } from '../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals } from '../../utils/quoteCalculator'
import { buildSpecQuantitySliceFromPersistedJobSheet } from '../../utils/jobSheetQuantityFromApi'
import { buildQuickQuoteInputsFromSpec } from '../../utils/specToQuoteInputs'
import {
  jobSheetDescriptionWithPackagingTail,
  jobSheetOrderQuantityLabel,
} from '../../utils/quoteQuantityDescriptors'

function s(v: unknown, fallback = '—'): string {
  if (v == null) return fallback
  const t = String(v).trim()
  return t === '' ? fallback : t
}

function n(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function fmtMetres(v: number): string {
  const r = Math.round((v + Number.EPSILON) * 100) / 100
  return String(r)
}

/** Matches labels in {@link SpecPayloadForm} slit select. */
function displaySlit(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '—',
    none: 'None',
    one_side: 'Slit one side',
    both_sides: 'Slit both sides',
    middle: 'Slit up middle',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '—')
}

/** Matches labels in {@link SpecPayloadForm} treat inside/outside select. */
function displayTreat(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '—',
    none: 'None',
    inside: 'Inside',
    outside: 'Outside',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '—')
}

/** Matches `SpecPayloadForm` resin blend dropdown (House LD vs custom / other presets). */
function displayBlendTypeLabel(blendType: unknown): string {
  const c = String(blendType ?? '').trim()
  if (c === '' || c === 'LD') return 'House Blend (LD)'
  if (c === 'Custom') return 'Custom'
  return c
}

export function JobSheetPrintPage() {
  const { jobSheetId } = useParams()
  const dispatch = useAppDispatch()
  const entry = useAppSelector((state) => (jobSheetId ? state.jobSheets.detail.byId[jobSheetId] : undefined))
  const data = entry?.data as { job_sheet?: Record<string, unknown>; spec_payload?: Record<string, unknown> } | null
  const err = entry?.error
  const quoteRatebook = useAppSelector((state) => state.quotes.quoteRatebook)

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [jobSheetId, dispatch])

  useEffect(() => {
    if (quoteRatebook.status === 'idle') void dispatch(fetchQuoteRatebook())
  }, [dispatch, quoteRatebook.status])

  const model = useMemo(() => {
    const js = data?.job_sheet
    const spec = (data?.spec_payload || {}) as Record<string, any>
    const identity = (spec?.identity || {}) as Record<string, any>
    const dimensions = (spec?.dimensions || {}) as Record<string, any>
    const formulation = (spec?.formulation || {}) as Record<string, any>
    const printing = (spec?.printing || {}) as Record<string, any>
    const run = (spec?.run_requirements || {}) as Record<string, any>
    const packaging = (spec?.packaging || {}) as Record<string, any>
    const quality = (spec?.quality_expectations || {}) as Record<string, any>
    if (!js) return null

    const customer = js.customer_name ?? js.customer ?? ''
    const invoiceNo = js.invoice_no ?? ''
    const purchaseOrderNo = js.customer_purchase_order_number ?? js.purchase_order_no ?? ''
    const orderDate = js.order_date ?? ''
    const dueDate = js.due_date ?? ''
    const jobCode = js.job_no ?? ''
    const productCode = js.product_code ?? ''
    const productDescription = js.product_description ?? ''
    const notes = identity?.notes ?? run?.notes ?? packaging?.notes ?? spec?.notes ?? ''
    const qualityChecks = Array.isArray(quality?.flags)
      ? quality.flags
      : Array.isArray(spec?.quality_checks)
        ? spec.quality_checks
        : []

    const productType = identity?.product_type ?? spec?.product_type ?? '—'
    const finishMode = identity?.finish_mode ?? spec?.finish_mode ?? '—'
    const resinColour =
      formulation?.colour?.colour_code ??
      formulation?.colour?.name ??
      formulation?.colour ??
      spec?.resin_colour ??
      spec?.colour ??
      '—'
    const geometryLabel = dimensions?.geometry ?? spec?.geometry ?? '—'
    const widthMm = n(dimensions?.base_width_mm ?? spec?.base_width_mm)
    const widthShorthandWmm = widthMm != null && widthMm > 0 ? `${Math.round(widthMm)}Wmm` : '—'
    const ufilmLeftMm = n(dimensions?.ufilm_left_width_mm ?? spec?.ufilm_left_width_mm)
    const ufilmRightMm = n(dimensions?.ufilm_right_width_mm ?? spec?.ufilm_right_width_mm)
    const gussetMm = n(dimensions?.gusset_mm ?? spec?.gusset_mm)
    const widthTolRaw = dimensions?.width_tolerance_mm ?? spec?.width_tolerance_mm
    const widthTolMm = n(widthTolRaw)
    const widthToleranceDisplay =
      widthTolMm != null && widthTolMm > 0 ? `± ${widthTolMm} mm` : widthTolRaw != null && String(widthTolRaw).trim() !== '' ? s(widthTolRaw) : '—'

    const widthSplitMm: number[] = []
    if (ufilmLeftMm != null && ufilmLeftMm > 0) widthSplitMm.push(Math.round(ufilmLeftMm))
    if (widthMm != null && widthMm > 0) widthSplitMm.push(Math.round(widthMm))
    if (ufilmRightMm != null && ufilmRightMm > 0) widthSplitMm.push(Math.round(ufilmRightMm))

    const lengthLine = s(
      dimensions?.base_length_mm != null
        ? `${dimensions.base_length_mm} mm`
        : dimensions?.length != null
          ? dimensions.length
          : spec?.base_length_mm != null
            ? `${spec.base_length_mm} mm`
            : spec?.length,
    )
    const gaugeLine = s(
      dimensions?.thickness_um != null
        ? `${dimensions.thickness_um} um`
        : spec?.thickness_um != null
          ? `${spec.thickness_um} um`
          : spec?.gauge,
    )
    const trimPct =
      identity?.trim_pct != null
        ? `${identity.trim_pct}%`
        : spec?.trim_pct != null
          ? `${spec.trim_pct}%`
          : ''
    const gaugeTrimDisplay = trimPct !== '' ? trimPct : '—'
    const slitRaw = run?.slit ?? spec?.slit
    const treatRaw = run?.treat_inside_outside ?? run?.treat ?? spec?.treat
    const slit = displaySlit(slitRaw)
    const treat = displayTreat(treatRaw)
    const coresLine = s(packaging?.core_type ?? spec?.core_type)

    const qv = n(js.quantity_value)
    const qtyUnitRaw = String(js.quantity_unit || '').trim().toLowerCase()
    const qtyUnit = s(js.quantity_unit, '')
    const totalKg = n(js.quantity_unit === 'kg' ? js.quantity_value : js.total_kg)
    const numRolls = n(js.num_rolls)
    const numUnits = n(js.num_product_units)
    const weightPerRoll = n(js.weight_per_roll_kg)
    const totalMStored = n(js.total_m)
    const wasteFactorPct = n(identity?.waste_factor_pct ?? spec?.waste_factor_pct)
    const wasteKg = n(spec?.waste_kg)

    const rb = quoteRatebook.data
    let geoDerived: ReturnType<typeof computeDerivedGeometryAndTotals> | null = null
    if (rb && spec && typeof spec === 'object') {
      try {
        const qtySlice = buildSpecQuantitySliceFromPersistedJobSheet(js as Record<string, unknown>, spec as SpecPayload)
        const quick = buildQuickQuoteInputsFromSpec(spec as SpecPayload, qtySlice, { ratebook: rb })
        geoDerived = computeDerivedGeometryAndTotals(quick, rb)
      } catch {
        geoDerived = null
      }
    }

    const derivedTotalM =
      geoDerived != null && geoDerived.derivedTotalM > 0 && Number.isFinite(geoDerived.derivedTotalM)
        ? geoDerived.derivedTotalM
        : null
    const derivedMPerRoll =
      geoDerived != null && geoDerived.mPerRoll != null && geoDerived.mPerRoll > 0 && Number.isFinite(geoDerived.mPerRoll)
        ? geoDerived.mPerRoll
        : null

    const finishNorm = String(finishMode || '').trim().toLowerCase()
    const highlightTotalKg = qtyUnitRaw === 'kg'
    const highlightTotalM = qtyUnitRaw === '1000' || qtyUnitRaw === 'cartons'

    let cartonConversion: { bagsPerCarton: string; totalCartons: string } | null = null
    if (finishNorm === 'cartons') {
      const bpcN = n(packaging?.bags_per_carton)
      const qtyTypeStr = String(js.qty_type || '')
      const quLower = String(js.quantity_unit || '').toLowerCase()
      let totalCtns: number | null = null
      if (qtyTypeStr === 'units' && quLower === 'cartons' && qv != null && qv > 0) {
        totalCtns = Math.max(1, Math.round(qv))
      } else if (bpcN != null && bpcN > 0 && numUnits != null && numUnits > 0) {
        totalCtns = Math.max(1, Math.ceil(numUnits / bpcN))
      } else if (
        bpcN != null &&
        bpcN > 0 &&
        totalKg != null &&
        totalKg > 0 &&
        geoDerived?.kgPerUnit != null &&
        Number(geoDerived.kgPerUnit) > 0
      ) {
        const cartonKg = bpcN * Number(geoDerived.kgPerUnit)
        totalCtns = Math.max(1, Math.round(totalKg / cartonKg))
      }
      cartonConversion = {
        bagsPerCarton: bpcN != null && bpcN > 0 ? String(Math.max(1, Math.round(bpcN))) : '—',
        totalCartons: totalCtns != null ? String(totalCtns) : '—',
      }
    }

    const blendTypeCode = String(formulation?.blend_type ?? '').trim() || 'LD'
    const hasExplicitBlendType = formulation?.blend_type != null && String(formulation.blend_type).trim() !== ''
    const legacyBlendCodeOnly =
      !hasExplicitBlendType && spec?.resin_blend_code != null && String(spec.resin_blend_code).trim() !== ''
    /** House LD preset only: no highlight on resin lines. Custom / other presets / legacy blend codes: highlight. */
    const highlightNonStandardResins = blendTypeCode !== 'LD' || legacyBlendCodeOnly

    const blendRowsRaw = Array.isArray(formulation?.blend) ? formulation.blend : Array.isArray(spec?.blend) ? spec.blend : []
    const blendRowsSorted = [...blendRowsRaw].sort((a, b) => {
      const pa = Number((a as { pct?: unknown })?.pct ?? 0)
      const pb = Number((b as { pct?: unknown })?.pct ?? 0)
      return pb - pa
    })

    const resinMixRows: Array<{ text: string; highlight: boolean }> = []

    if (formulation?.blend_type != null && String(formulation.blend_type).trim() !== '') {
      resinMixRows.push({
        text: `Resin blend: ${displayBlendTypeLabel(formulation.blend_type)}`,
        highlight: highlightNonStandardResins,
      })
    } else if (spec?.resin_blend_code != null && String(spec.resin_blend_code).trim() !== '') {
      resinMixRows.push({
        text: `Resin blend code: ${s(spec.resin_blend_code)}`,
        highlight: true,
      })
    } else if (blendRowsSorted.length > 0) {
      resinMixRows.push({
        text: `Resin blend: ${displayBlendTypeLabel('LD')}`,
        highlight: false,
      })
    }

    for (const row of blendRowsSorted) {
      const code = s((row as { code?: unknown })?.code ?? (row as { resin_code?: unknown })?.resin_code, '')
      const pct = n((row as { pct?: unknown })?.pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `${code || 'Resin'} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: highlightNonStandardResins,
        })
      }
    }

    const colourRows = Array.isArray(formulation?.colour_components) ? formulation.colour_components : []
    for (const row of colourRows) {
      const code = s(row?.colour_code, '')
      const pct = n(row?.strength_pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `Colour ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: false,
        })
      }
    }

    const additiveRows = Array.isArray(formulation?.additives) ? formulation.additives : []
    for (const row of additiveRows) {
      const code = s(row?.additive_code, '')
      const pct = n(row?.pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `Additive ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: true,
        })
      }
    }

    if (resinMixRows.length === 0) resinMixRows.push({ text: '—', highlight: false })

    const printingRows = [
      { label: 'Print method', value: s(printing?.method ?? spec?.print_method ?? spec?.printing_method) },
      { label: 'No. colours', value: s(printing?.num_colours ?? spec?.num_colours) },
      { label: 'Cylinder / Anilox', value: s(printing?.cylinder_size_mm != null ? `${printing.cylinder_size_mm} mm` : spec?.anilox) },
      { label: 'Notes', value: s(printing?.print_description ?? printing?.print_position_notes ?? spec?.printing_notes ?? spec?.print_notes) },
    ]

    const geoSnapshotForTail =
      derivedTotalM != null || derivedMPerRoll != null
        ? { derivedTotalM: derivedTotalM ?? 0, mPerRoll: derivedMPerRoll }
        : null
    const orderedQuantityLabel = jobSheetOrderQuantityLabel(js as Record<string, unknown>, spec as Record<string, unknown>)
    const descriptionWithPackagingTail = jobSheetDescriptionWithPackagingTail(
      String(productDescription ?? ''),
      js as Record<string, unknown>,
      spec as Record<string, unknown>,
      geoSnapshotForTail,
    )

    return {
      titleLine: `JOB SHEET ${s(jobCode, '') ? `— ${s(jobCode, '')}` : ''}`.trim(),
      header: {
        customer: s(customer),
        invoiceNo: s(invoiceNo),
        purchaseOrderNo: s(purchaseOrderNo),
        orderDate: s(orderDate),
        dueDate: s(dueDate),
        jobCode: s(jobCode),
      },
      product: {
        productCode: s(productCode),
        productDescription: s(productDescription),
        descriptionWithPackagingTail,
        orderedQuantityLabel,
        notes: s(notes),
        qualityChecks: qualityChecks.map((x: unknown) => s(x, '')).filter(Boolean),
      },
      extrusion: {
        productType: s(productType),
        finishMode: s(finishMode),
        resinColour: s(resinColour),
        geometryLabel: s(geometryLabel),
        geometryExtras: [
          gussetMm != null && gussetMm > 0 ? `Gusset ${Math.round(gussetMm)} mm` : '',
        ].filter(Boolean),
        widthSplitMm: widthSplitMm.length >= 2 ? widthSplitMm : null,
        widthPrimarySingle:
          widthSplitMm.length >= 2
            ? null
            : widthMm != null && widthMm > 0
              ? `${Math.round(widthMm)} mm`
              : widthShorthandWmm !== '—'
                ? widthShorthandWmm
                : '—',
        widthToleranceDisplay,
        lengthLine,
        lengthToleranceDisplay: '—',
        gaugeLine,
        gaugeTrimDisplay,
        slit,
        treat,
        coresLine,
        orderQuantities: {
          numItems: numUnits != null ? String(Math.round(numUnits)) : '—',
          numRollsOrCtns: numRolls != null ? String(Math.round(numRolls)) : '—',
          totalKg: totalKg != null ? `${totalKg}` : qv != null && qtyUnit === 'kg' ? `${qv}` : '—',
          kgPerRoll:
            finishNorm === 'cartons'
              ? '—'
              : weightPerRoll != null && weightPerRoll > 0
                ? `${weightPerRoll}`
                : '—',
          totalM:
            derivedTotalM != null ? fmtMetres(derivedTotalM) : totalMStored != null ? `${totalMStored}` : '—',
          mPerRoll: derivedMPerRoll != null ? fmtMetres(derivedMPerRoll) : '—',
          wasteFactorPct,
          wasteKg: wasteKg != null ? `${wasteKg}` : null,
          highlightTotalKg,
          highlightTotalM,
        },
        resinMixRows,
      },
      printingRows,
      conversionInstructions: {
        carton: cartonConversion,
      },
    }
  }, [data, quoteRatebook.data])

  if (err && !data && entry?.status === 'failed') {
    return (
      <div className="js-print-root">
        <p>
          <strong>Error:</strong> {err}
        </p>
        <p>
          <Link to="/job-sheets">Back to job sheets</Link>
        </p>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="js-print-root">
        <p>Loading…</p>
      </div>
    )
  }

  const e = model.extrusion
  const q = e.orderQuantities
  const conv = model.conversionInstructions
  const printPath = jobSheetId ? `/job-sheets/${encodeURIComponent(jobSheetId)}/print` : ''
  const editHref = jobSheetId
    ? `/job-sheets/${encodeURIComponent(jobSheetId)}/edit?returnTo=${encodeURIComponent(printPath || '/job-sheets')}`
    : '/job-sheets'

  return (
    <>
      <style>{`
        .js-print-root, .js-print-root .js-sec, .js-print-root .js-sub, .js-print-root .js-tol, .js-print-root .js-pink, .js-print-root .js-blue, .js-print-root .js-inv-hl, .js-print-root .js-resin-mix-hl {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: A4; }
          .js-print-root {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11.5pt !important;
            line-height: 1.25;
          }
          .js-grid td, .js-grid th {
            padding: 5px 7px !important;
            font-size: 10.5pt !important;
          }
          /* Nested tables are still inside .js-grid; without this, the rule above adds 5×7px inside dim/run cells only when printing. */
          .js-dim-grid td.js-dim-col {
            padding: 0 !important;
          }
          .js-dim-grid th.js-dim-h {
            padding: 6px 8px !important;
            font-size: 10pt !important;
          }
          .js-run-triple th,
          .js-run-triple td {
            padding: 6px 8px !important;
            font-size: 10pt !important;
          }
          /* Nested dim grid: flex + min-height + flex-grow prints with bogus vertical gaps in table cells (Chrome/Safari). */
          .js-dim-stack {
            display: block !important;
            min-height: 0 !important;
          }
          .js-dim-primary {
            flex: none !important;
          }
          .js-dim-grid,
          .js-run-triple {
            margin: 0 !important;
          }
          .js-extrusion-dim-run-cell .js-dim-grid {
            margin-bottom: 0 !important;
          }
          .js-dim-wrap.js-extrusion-dim-run-cell {
            padding: 0 !important;
            vertical-align: top !important;
          }
          .js-sec, .js-sub { font-size: 10pt !important; }
          .js-muted { font-size: 9.5pt !important; }
        }
        .js-print-root {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          color: #111;
          max-width: 100%;
          width: 100%;
          margin: 0 auto;
          padding: 8px 0 0;
          font-size: 13px;
        }
        .js-title {
          text-align: center;
          font-weight: 800;
          font-size: 17px;
          letter-spacing: 0.04em;
          padding: 10px 8px;
          border: 1px solid #000;
          margin-bottom: 8px;
        }
        .js-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
        .js-grid td, .js-grid th {
          border: 1px solid #000;
          padding: 5px 7px;
          vertical-align: top;
          word-break: break-word;
        }
        .js-grid th { font-weight: 400; text-align: left; }
        .js-grid td { font-weight: 700; }
        .js-grid td.js-sec { font-weight: 600; text-transform: uppercase; }
        .js-grid td.js-sub { font-weight: 600; }
        .js-grid td.js-blue { font-weight: 400; }
        .js-grid td.js-td-mixed { font-weight: 400; }
        .js-print-val { font-weight: 700; }
        .js-sec { background: #d9d9d9; font-size: 11px; }
        .js-sub { background: #f2c894; font-size: 11px; }
        .js-tol { background: #fff566; font-size: 11px; }
        .js-pink { background: #ffc8d8; }
        .js-blue { background: #b4d7ff; }
        .js-inv-hl { background: #fff566; font-size: 1.05em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .js-muted { color: #333; font-size: 11px; }
        .js-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; }
        .js-dim-wrap { padding: 0 !important; border-left: none !important; border-right: none !important; }
        .js-extrusion-dim-run-cell .js-dim-grid { margin-bottom: 0; }
        .js-order-qty-grid { margin-top: 14px; }
        .js-dim-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 8px; }
        .js-dim-grid th.js-dim-h {
          border: 2px solid #000;
          background: #d9d9d9;
          font-weight: 700;
          text-align: center;
          padding: 6px 8px;
          font-size: 11px;
          letter-spacing: 0.02em;
        }
        .js-dim-grid td.js-dim-col {
          border: 2px solid #000;
          padding: 0;
          vertical-align: top;
          width: 25%;
        }
        .js-dim-stack { display: flex; flex-direction: column; min-height: 100%; }
        .js-dim-primary {
          background: #e8e8e8;
          padding: 8px 10px;
          font-weight: 700;
          flex: 1;
          text-align: center;
        }
        .js-dim-primary.js-dim-primary-left { text-align: left; }
        .js-dim-secondary {
          background: #fff566;
          padding: 6px 8px;
          font-weight: 700;
          font-size: 11px;
          border-top: 1px solid #000;
          white-space: normal;
        }
        .js-run-triple { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
        .js-run-triple th {
          width: 14%;
          font-weight: 400;
          text-align: left;
          background: #f2c894;
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: 11px;
        }
        .js-run-triple td { font-weight: 700; border: 1px solid #000; padding: 6px 8px; }
        .js-resin-mix-hl { background: #fff566; }
      `}</style>

      <div className="js-print-root">
        <div className="js-actions no-print">
          <Button variant="text" color="primary" component={Link} to={editHref}>
            Edit job sheet
          </Button>
          <Button type="button" variant="contained" color="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <div className="js-title">{model.titleLine}</div>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Order header</td></tr>
            <tr>
              <th>Customer</th><td colSpan={2}>{model.header.customer}</td>
              <th>Invoice no.</th><td colSpan={2} className="js-inv-hl">{model.header.invoiceNo}</td>
            </tr>
            <tr>
              <th>Purchase order</th><td colSpan={2}>{model.header.purchaseOrderNo}</td>
              <th>Order date</th><td colSpan={2}>{model.header.orderDate}</td>
            </tr>
            <tr>
              <th>Job code</th><td colSpan={2}>{model.header.jobCode}</td>
              <th>Due date</th><td colSpan={2}>{model.header.dueDate}</td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Product</td></tr>
            <tr>
              <th>Product code</th><td colSpan={2} style={{ fontFamily: 'ui-monospace, monospace' }}>{model.product.productCode}</td>
              <th>Description</th><td colSpan={2} style={{ whiteSpace: 'pre-wrap' }}>{model.product.descriptionWithPackagingTail}</td>
            </tr>
            <tr>
              <th>Ordered quantity</th>
              <td colSpan={5}>{model.product.orderedQuantityLabel}</td>
            </tr>
            <tr><th>Notes</th><td colSpan={5} style={{ whiteSpace: 'pre-wrap' }}>{model.product.notes}</td></tr>
            <tr><th>Quality checks</th><td colSpan={5}>{model.product.qualityChecks.length ? model.product.qualityChecks.join(' · ') : '—'}</td></tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Extrusion specifications</td></tr>
            <tr>
              <th>Product type</th><td>{e.productType}</td>
              <th>Finish</th><td>{e.finishMode}</td>
              <th className="js-pink">(Resin) colour</th><td className="js-pink">{e.resinColour}</td>
            </tr>
            <tr>
              <td colSpan={6} className="js-dim-wrap js-extrusion-dim-run-cell">
                <table className="js-dim-grid" role="presentation">
                  <thead>
                    <tr>
                      <th className="js-dim-h">Geometry</th>
                      <th className="js-dim-h">Width</th>
                      <th className="js-dim-h">Length</th>
                      <th className="js-dim-h">Gauge</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>
                              Geometry: {e.geometryLabel}
                              {e.geometryExtras.length > 0 ? (
                                <>
                                  <span className="js-muted"> · </span>
                                  <span>{e.geometryExtras.join(' · ')}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>
                              Width:{' '}
                              {e.widthSplitMm && e.widthSplitMm.length >= 2
                                ? e.widthSplitMm.join(' / ')
                                : e.widthPrimarySingle ?? '—'}
                            </div>
                          </div>
                          <div className="js-dim-secondary">Tolerance: {e.widthToleranceDisplay}</div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>Length: {e.lengthLine}</div>
                          </div>
                          <div className="js-dim-secondary">Tolerance: {e.lengthToleranceDisplay}</div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>Gauge: {e.gaugeLine}</div>
                          </div>
                          <div className="js-dim-secondary">Trim: {e.gaugeTrimDisplay}</div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table className="js-run-triple" role="presentation">
                  <tbody>
                    <tr>
                      <th>Slit</th>
                      <td>{e.slit}</td>
                      <th>Treat</th>
                      <td>{e.treat}</td>
                      <th>Cores</th>
                      <td>{e.coresLine}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr><td className="js-sub" colSpan={6}>Resin mix</td></tr>
            {e.resinMixRows.map((r, idx) => (
              <tr key={idx}>
                <td colSpan={6} className={r.highlight ? 'js-resin-mix-hl' : undefined}>
                  {r.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="js-grid js-order-qty-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Order quantities</td></tr>
            <tr>
              <th>No. of items</th><td>{q.numItems}</td>
              <th>Rolls / ctns</th><td>{q.numRollsOrCtns}</td>
              <th className={q.highlightTotalKg ? 'js-pink' : undefined}>Total kg</th>
              <td className={q.highlightTotalKg ? 'js-pink' : undefined}>{q.totalKg}</td>
            </tr>
            <tr>
              <th>Kg per roll</th><td>{q.kgPerRoll}</td>
              <th className={q.highlightTotalM ? 'js-pink' : undefined}>Total M</th>
              <td className={q.highlightTotalM ? 'js-pink' : undefined}>{q.totalM}</td>
              <th>M per roll</th><td>{q.mPerRoll}</td>
            </tr>
            <tr>
              <th>Waste factor</th>
              <td colSpan={5} className="js-td-mixed">
                {q.wasteFactorPct != null ? (
                  <>
                    <span className="js-print-val">{q.wasteFactorPct}%</span>
                    <span className="js-muted"> of ordered job kg (extrusion waste</span>
                    {q.wasteKg ? (
                      <>
                        <span className="js-muted">: </span>
                        <span className="js-print-val">{q.wasteKg}</span>
                        <span className="js-muted">)</span>
                      </>
                    ) : (
                      <span className="js-muted">)</span>
                    )}
                  </>
                ) : (
                  <span className="js-print-val">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={2}>Printing</td></tr>
            {model.printingRows.map((row) => (
              <tr key={row.label}>
                <th style={{ width: '32%' }}>{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr>
              <td className="js-blue" colSpan={2}>
                Conversion instructions
              </td>
            </tr>
            {conv.carton ? (
              <>
                <tr>
                  <th>Total cartons</th>
                  <td>{conv.carton.totalCartons}</td>
                </tr>
                <tr>
                  <th>Bags per carton</th>
                  <td>{conv.carton.bagsPerCarton}</td>
                </tr>
              </>
            ) : null}
            <tr>
              <td colSpan={2} className="js-muted" style={{ height: 40, fontWeight: 400 }}>
                Conversion dimensions (if different) — to be filled on floor
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'

function s(v: unknown, fallback = '—'): string {
  if (v == null) return fallback
  const t = String(v).trim()
  return t === '' ? fallback : t
}

function n(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export function JobSheetPrintPage() {
  const { jobSheetId } = useParams()
  const dispatch = useAppDispatch()
  const entry = useAppSelector((state) => (jobSheetId ? state.jobSheets.detail.byId[jobSheetId] : undefined))
  const data = entry?.data as { job_sheet?: Record<string, unknown>; spec_payload?: Record<string, unknown> } | null
  const err = entry?.error

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [jobSheetId, dispatch])

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
    const slit = s(run?.slit ?? spec?.slit)
    const treat = s(run?.treat_inside_outside ?? run?.treat ?? spec?.treat)
    const coresLine = s(packaging?.core_type ?? spec?.core_type)

    const qv = n(js.quantity_value)
    const qtyUnit = s(js.quantity_unit, '')
    const totalKg = n(js.quantity_unit === 'kg' ? js.quantity_value : js.total_kg)
    const numRolls = n(js.num_rolls)
    const numUnits = n(js.num_product_units)
    const weightPerRoll = n(js.weight_per_roll_kg)
    const totalM = n(js.total_m)
    const wasteFactorPct = n(identity?.waste_factor_pct ?? spec?.waste_factor_pct)
    const wasteKg = n(spec?.waste_kg)
    const resinRows: Array<{ text: string; highlight?: boolean }> = []
    if (formulation?.blend_type) resinRows.push({ text: `Resin blend: ${formulation.blend_type}` })
    else if (spec?.resin_blend_code) resinRows.push({ text: `Resin blend: ${spec.resin_blend_code}` })
    const blendRows = Array.isArray(formulation?.blend) ? formulation.blend : Array.isArray(spec?.blend) ? spec.blend : []
    if (blendRows.length > 0) {
      for (const row of blendRows) {
        const code = s(row?.code ?? row?.resin_code, '')
        const pct = n(row?.pct)
        if (code || pct != null) resinRows.push({ text: `${code || 'Resin'} ${pct != null ? `${pct}%` : ''}`.trim() })
      }
    }
    const colourRows = Array.isArray(formulation?.colour_components) ? formulation.colour_components : []
    for (const row of colourRows) {
      const code = s(row?.colour_code, '')
      const pct = n(row?.strength_pct)
      if (code || pct != null) resinRows.push({ text: `Colour ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim() })
    }
    const additiveRows = Array.isArray(formulation?.additives) ? formulation.additives : []
    for (const row of additiveRows) {
      const code = s(row?.additive_code, '')
      const pct = n(row?.pct)
      if (code || pct != null) resinRows.push({ text: `Additive ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim() })
    }
    if (resinRows.length === 0) resinRows.push({ text: '—' })

    const printingRows = [
      { label: 'Print method', value: s(printing?.method ?? spec?.print_method ?? spec?.printing_method) },
      { label: 'No. colours', value: s(printing?.num_colours ?? spec?.num_colours) },
      { label: 'Cylinder / Anilox', value: s(printing?.cylinder_size_mm != null ? `${printing.cylinder_size_mm} mm` : spec?.anilox) },
      { label: 'Notes', value: s(printing?.print_description ?? printing?.print_position_notes ?? spec?.printing_notes ?? spec?.print_notes) },
    ]

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
          kgPerRoll: weightPerRoll != null ? `${weightPerRoll}` : '—',
          totalM: totalM != null ? `${totalM}` : '—',
          mPerRoll: '—',
          wasteFactorPct,
          wasteKg: wasteKg != null ? `${wasteKg}` : null,
        },
        resinRows,
      },
      printingRows,
    }
  }, [data])

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
  const printPath = jobSheetId ? `/job-sheets/${encodeURIComponent(jobSheetId)}/print` : ''
  const editHref = jobSheetId
    ? `/job-sheets/${encodeURIComponent(jobSheetId)}/edit?returnTo=${encodeURIComponent(printPath || '/job-sheets')}`
    : '/job-sheets'

  return (
    <>
      <style>{`
        .js-print-root, .js-print-root .js-sec, .js-print-root .js-sub, .js-print-root .js-tol, .js-print-root .js-pink, .js-print-root .js-blue, .js-print-root .js-inv-hl {
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
        .js-run-details td { font-weight: 700; padding: 6px 8px !important; }
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
              <th>Description</th><td colSpan={2}>{model.product.productDescription}</td>
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
              <td colSpan={6} className="js-dim-wrap">
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
              </td>
            </tr>
            <tr>
              <td className="js-sub" colSpan={6}>
                Slit, treat & cores
              </td>
            </tr>
            <tr className="js-run-details">
              <td colSpan={6}>
                <div>Slit: {e.slit}</div>
                <div style={{ marginTop: 4 }}>Treat: {e.treat}</div>
                <div style={{ marginTop: 4 }}>Cores: {e.coresLine}</div>
              </td>
            </tr>
            <tr><td className="js-sub" colSpan={6}>Order quantities (derived where applicable)</td></tr>
            <tr>
              <th>No. of items</th><td>{q.numItems}</td>
              <th>Rolls / ctns</th><td>{q.numRollsOrCtns}</td>
              <th className="js-pink">Total kg</th><td className="js-pink">{q.totalKg}</td>
            </tr>
            <tr>
              <th>Kg per roll</th><td>{q.kgPerRoll}</td>
              <th>Total M</th><td>{q.totalM}</td>
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
            <tr><td className="js-sub" colSpan={6}>Resin mix</td></tr>
            {e.resinRows.map((r, idx) => <tr key={idx}><td colSpan={6}>{r.text}</td></tr>)}
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
            <tr><td className="js-blue" colSpan={2}>Conversion dimensions (if different) — to be filled on floor</td></tr>
            <tr><td colSpan={2} style={{ height: 48 }} /></tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

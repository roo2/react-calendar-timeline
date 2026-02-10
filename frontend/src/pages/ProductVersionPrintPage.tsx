import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'

function fmtList(x: unknown): string {
  return Array.isArray(x) && x.length > 0 ? x.join(', ') : '-'
}

export function ProductVersionPrintPage() {
  const { productId, versionId } = useParams()
  const [productData, setProductData] = useState<any>(null)
  const [versionData, setVersionData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!productId || !versionId) return
    void (async () => {
      try {
        setErr(null)
        const [p, v] = await Promise.all([
          apiFetch<any>(`/api/products/${productId}`),
          apiFetch<any>(`/api/products/${productId}/versions/${versionId}`),
        ])
        setProductData(p)
        setVersionData(v)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load job sheet')
      }
    })()
  }, [productId, versionId])

  if (err) {
    return (
      <div className="container">
        <h1>Print — Job Sheet</h1>
        <p>
          <strong>Error:</strong> {err}
        </p>
      </div>
    )
  }
  if (!productData || !versionData) return <p>Loading…</p>

  const product = productData.product
  const version = versionData.version
  const routing = versionData.routing || { operations: [], warnings: [] }
  const spec = version?.spec_payload

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-after: always; }
        }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; }
        .container { max-width: 960px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; gap: 16px; }
        .logo { width: 160px; height: 48px; background: #eee; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        h1 { margin: 0; font-size: 20px; }
        .meta { margin-top: 6px; font-size: 12px; color: #444; }
        section { margin: 24px 0; }
        .spec-table { width: 100%; border-collapse: collapse; }
        .spec-table th { text-align: left; padding: 6px; background: #f1f3f5; width: 220px; border: 1px solid #dee2e6; }
        .spec-table td { padding: 6px; border: 1px solid #dee2e6; }
      `}</style>

      <div className="container">
        <header>
          <div className="logo">Company Logo</div>
          <div style={{ flex: 1 }}>
            <h1>
              Job Sheet: {product.code} — Version {version.version_number}
            </h1>
            <div className="meta">
              Customer: {product.customer_name || '-'} | Created by: {version.created_by} | Created at: {version.created_at || '-'}
            </div>
          </div>
          <div className="no-print">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                window.print()
              }}
            >
              Print
            </a>
          </div>
        </header>

        {!spec ? (
          <p>No spec payload found for this version.</p>
        ) : (
          <>
            <section>
              <h2>1. Product Identity</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Product Type</th>
                    <td>{spec.identity?.product_type || '-'}</td>
                  </tr>
                  <tr>
                    <th>Finish Mode</th>
                    <td>{spec.identity?.finish_mode || '-'}</td>
                  </tr>
                  <tr>
                    <th>Industry Flags</th>
                    <td>{fmtList(spec.identity?.industry_flags)}</td>
                  </tr>
                  <tr>
                    <th>Notes</th>
                    <td>{spec.identity?.notes || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2>2. Dimensions &amp; Geometry</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Base Width</th>
                    <td>{spec.dimensions?.base_width_mm} mm</td>
                  </tr>
                  <tr>
                    <th>Base Length</th>
                    <td>{spec.dimensions?.base_length_mm ?? 'Continuous'} mm</td>
                  </tr>
                  <tr>
                    <th>Thickness</th>
                    <td>{spec.dimensions?.thickness_um} µm</td>
                  </tr>
                  <tr>
                    <th>Geometry</th>
                    <td>{spec.dimensions?.geometry}</td>
                  </tr>
                  {spec.dimensions?.gusset_mm ? (
                    <tr>
                      <th>Gusset Size</th>
                      <td>{spec.dimensions?.gusset_mm} mm</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>

            <section>
              <h2>3. Materials &amp; Formulation</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Blend Type</th>
                    <td>{spec.formulation?.blend_type || 'Custom'}</td>
                  </tr>
                  <tr>
                    <th>Resin Blend</th>
                    <td>
                      {Array.isArray(spec.formulation?.blend) && spec.formulation.blend.length > 0 ? (
                        <ul>
                          {spec.formulation.blend.map((c: any, idx: number) => (
                            <li key={idx}>
                              {c.resin_code}: {c.pct}%
                            </li>
                          ))}
                        </ul>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Colour Components</th>
                    <td>
                      {Array.isArray(spec.formulation?.colour_components) && spec.formulation.colour_components.length > 0 ? (
                        <ul>
                          {spec.formulation.colour_components.map((c: any, idx: number) => (
                            <li key={idx}>
                              {c.colour_code || '-'}
                              {c.strength_pct != null ? `: ${c.strength_pct}%` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : spec.formulation?.colour?.colour_code ? (
                        <>
                          Code: {spec.formulation.colour.colour_code}
                          {spec.formulation.colour.strength_pct != null ? `, Strength: ${spec.formulation.colour.strength_pct}%` : ''}
                          {spec.formulation.colour.opaque ? ', Opaque' : ''}
                        </>
                      ) : (
                        'None'
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Additives</th>
                    <td>
                      {Array.isArray(spec.formulation?.additives) && spec.formulation.additives.length > 0 ? (
                        <ul>
                          {spec.formulation.additives.map((a: any, idx: number) => (
                            <li key={idx}>
                              {a.additive_code}: {a.pct}%
                            </li>
                          ))}
                        </ul>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2>4. Printing &amp; Artwork</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Printing Method</th>
                    <td>{spec.printing?.method || '-'}</td>
                  </tr>
                  {spec.printing?.method && spec.printing.method !== 'None' ? (
                    <>
                      <tr>
                        <th>Print Side</th>
                        <td>{spec.printing?.side || '-'}</td>
                      </tr>
                      <tr>
                        <th>Number of Colours</th>
                        <td>{spec.printing?.num_colours || 0}</td>
                      </tr>
                      <tr>
                        <th>Print Description</th>
                        <td>{spec.printing?.print_description || '-'}</td>
                      </tr>
                      {Array.isArray(spec.printing?.front_ink_plate) && spec.printing.front_ink_plate.length > 0 ? (
                        <tr>
                          <th>Front Ink/Plate</th>
                          <td>
                            <table className="spec-table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>Ink Code</th>
                                  <th>Plate Code</th>
                                </tr>
                              </thead>
                              <tbody>
                                {spec.printing.front_ink_plate.map((r: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{r?.ink_code || '-'}</td>
                                    <td>{r?.plate_code || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                      {Array.isArray(spec.printing?.back_ink_plate) && spec.printing.back_ink_plate.length > 0 ? (
                        <tr>
                          <th>Back Ink/Plate</th>
                          <td>
                            <table className="spec-table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>Ink Code</th>
                                  <th>Plate Code</th>
                                </tr>
                              </thead>
                              <tbody>
                                {spec.printing.back_ink_plate.map((r: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{r?.ink_code || '-'}</td>
                                    <td>{r?.plate_code || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  ) : null}
                </tbody>
              </table>
            </section>

            <section>
              <h2>5. Quality Expectations</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Critical Flags</th>
                    <td>{fmtList(spec.quality_expectations?.flags)}</td>
                  </tr>
                  <tr>
                    <th>Known Issues</th>
                    <td>{spec.quality_expectations?.known_issues || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2>6. Run Requirements</h2>
              <table className="spec-table">
                <tbody>
                  <tr>
                    <th>Preferred Extruders</th>
                    <td>{fmtList(spec.run_requirements?.preferred_extruders)}</td>
                  </tr>
                  <tr>
                    <th>Preferred Printer</th>
                    <td>{spec.run_requirements?.preferred_printer || '-'}</td>
                  </tr>
                  <tr>
                    <th>Preferred Converter</th>
                    <td>{spec.run_requirements?.preferred_converter || '-'}</td>
                  </tr>
                  <tr>
                    <th>Treat Inside/Outside</th>
                    <td>{spec.run_requirements?.treat_inside_outside || '-'}</td>
                  </tr>
                  <tr>
                    <th>Inline Perforation</th>
                    <td>{spec.run_requirements?.inline_perforation ? 'Yes' : 'No'}</td>
                  </tr>
                  <tr>
                    <th>Inline Seal</th>
                    <td>{spec.run_requirements?.inline_seal ? 'Yes' : 'No'}</td>
                  </tr>
                  <tr>
                    <th>Setup Notes</th>
                    <td>{spec.run_requirements?.notes || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            {Array.isArray(spec.tool_requirements) && spec.tool_requirements.length > 0 ? (
              <section>
                <h2>8. Tool Requirements</h2>
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Tool Type</th>
                      <th>Quantity</th>
                      <th>Preferred Machines</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.tool_requirements.map((t: any, idx: number) => (
                      <tr key={idx}>
                        <td>{t.stage}</td>
                        <td>{t.tool_type}</td>
                        <td>{t.quantity}</td>
                        <td>{fmtList(t.preferred_machine_ids)}</td>
                        <td>{t.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            <section className="page-break">
              <h2>Required Operation Sequence</h2>
              <ol>
                {(routing.operations || []).map((op: any, idx: number) => (
                  <li key={idx}>
                    {op.operation_type}: {op.description}
                  </li>
                ))}
              </ol>
              {Array.isArray(routing.warnings) && routing.warnings.length > 0 ? (
                <div>
                  <strong>Warnings:</strong>
                  <ul>
                    {routing.warnings.map((w: string, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </>
  )
}


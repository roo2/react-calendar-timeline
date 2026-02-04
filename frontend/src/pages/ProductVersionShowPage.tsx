import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { Alert, Box, Button, Paper, Typography } from '@mui/material'

function fmtList(x: unknown): string {
  return Array.isArray(x) && x.length > 0 ? x.join(', ') : '-'
}

export function ProductVersionShowPage() {
  const { productId, versionId } = useParams()
  const csrfToken = useAppSelector((s) => s.auth.csrfToken)
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = roles.includes('PROD_MANAGER')

  const [productData, setProductData] = useState<any>(null)
  const [versionData, setVersionData] = useState<any>(null)
  const [derived, setDerived] = useState<any>(null)
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
        setErr(e instanceof Error ? e.message : 'Failed to load version')
      }
    })()
  }, [productId, versionId])

  const spec = useMemo(() => versionData?.version?.spec_payload || null, [versionData])

  useEffect(() => {
    if (!spec) return
    void (async () => {
      try {
        const res = await apiFetch<{ derived: any }>('/api/products/preview/dimensions', {
          method: 'POST',
          body: JSON.stringify(spec),
          csrfToken: csrfToken || undefined,
        })
        setDerived(res.derived)
      } catch {
        // ignore: derived preview is a convenience
      }
    })()
  }, [spec, csrfToken])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Product Version
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to={productId ? `/products/${productId}` : '/products'} variant="outlined">
          Back
        </Button>
      </Box>
    )
  }

  if (!productData || !versionData) return <p>Loading…</p>

  const product = productData.product
  const version = versionData.version
  const routing = versionData.routing || { operations: [], warnings: [] }

  return (
    <Box>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Typography variant="h5">
            Job Sheet: {product.code} — Version {version.version_number}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <span>Customer: {product.customer_name || '-'}</span>
            <span>Created by: {version.created_by}</span>
            <span>Created at: {version.created_at || '-'}</span>
          </Typography>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {isPm && (
            <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
              Create New Version
            </Button>
          )}
          <Button
            variant="outlined"
            component={Link}
            to={`/products/${productId}/versions/${versionId}/print`}
            target="_blank"
            rel="noreferrer"
          >
            Print
          </Button>
        </div>
      </header>

      {!spec ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No spec payload found for this version.
        </Typography>
      ) : (
        <>
          <section style={{ marginTop: 24 }}>
            <h2>1. Product Identity</h2>
            <table>
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

          <section style={{ marginTop: 24 }}>
            <h2>2. Dimensions &amp; Geometry</h2>
            <table>
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

            {derived && (
              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="body2">
                  Layflat (mm): <strong>{derived.layflat_mm}</strong>
                </Typography>
                <Typography variant="body2">
                  Decision Width (mm): <strong>{derived.decision_width_mm}</strong>
                </Typography>
                {derived.area_per_unit_mm2 != null && (
                  <Typography variant="body2">
                    Area per unit (mm²): <strong>{derived.area_per_unit_mm2}</strong>
                  </Typography>
                )}
              </Paper>
            )}
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>3. Materials &amp; Formulation</h2>
            <table>
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
                  <th>Colour</th>
                  <td>
                    {spec.formulation?.colour?.colour_code ? (
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

          <section style={{ marginTop: 24 }}>
            <h2>4. Printing &amp; Artwork</h2>
            <table>
              <tbody>
                <tr>
                  <th>Printing Method</th>
                  <td>{spec.printing?.method || '-'}</td>
                </tr>
                {spec.printing?.method && spec.printing.method !== 'None' ? (
                  <>
                    <tr>
                      <th>Number of Colours</th>
                      <td>{spec.printing?.num_colours || 0}</td>
                    </tr>
                    <tr>
                      <th>Ink Codes</th>
                      <td>{fmtList(spec.printing?.ink_codes)}</td>
                    </tr>
                    <tr>
                      <th>Plate Codes</th>
                      <td>{fmtList(spec.printing?.plate_codes)}</td>
                    </tr>
                    <tr>
                      <th>Print Side</th>
                      <td>{spec.printing?.side || '-'}</td>
                    </tr>
                    <tr>
                      <th>Artwork References</th>
                      <td>{fmtList(spec.printing?.artwork_refs)}</td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>5. Quality Expectations</h2>
            <table>
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

          <section style={{ marginTop: 24 }}>
            <h2>6. Run Requirements</h2>
            <table>
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

          <section style={{ marginTop: 24 }}>
            <h2>7. Packaging &amp; Logistics Requirements</h2>
            <table>
              <tbody>
                <tr>
                  <th>Pack Mode</th>
                  <td>{spec.packaging?.pack_mode || '-'}</td>
                </tr>
                <tr>
                  <th>Core Type</th>
                  <td>{spec.packaging?.core_type || '-'}</td>
                </tr>
                <tr>
                  <th>Core Policy</th>
                  <td>{spec.packaging?.core_policy || '-'}</td>
                </tr>
                <tr>
                  <th>Bags per Carton</th>
                  <td>{spec.packaging?.bags_per_carton ?? '-'}</td>
                </tr>
                <tr>
                  <th>Pallet Type</th>
                  <td>{spec.packaging?.pallet_type || '-'}</td>
                </tr>
                <tr>
                  <th>Wrapping Required</th>
                  <td>{spec.packaging?.wrapped ? 'Yes' : 'No'}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {Array.isArray(spec.tool_requirements) && spec.tool_requirements.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2>8. Tool Requirements</h2>
              <table>
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

          <section style={{ marginTop: 24 }}>
            <h2>Required Operation Sequence</h2>
            <ol>
              {(routing.operations || []).map((op: any, idx: number) => (
                <li key={idx}>
                  {op.operation_type}: {op.description}
                </li>
              ))}
            </ol>
            {Array.isArray(routing.warnings) && routing.warnings.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <strong>Warnings:</strong>
                <ul>
                  {routing.warnings.map((w: string, idx: number) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </Paper>
            ) : null}
          </section>
        </>
      )}

      <Box sx={{ mt: 3 }}>
        <Button component={Link} to={`/products/${productId}`} variant="outlined">
          ← Back to Product
        </Button>
      </Box>
    </Box>
  )
}


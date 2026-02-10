import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

function fmtList(x: unknown): string {
  return Array.isArray(x) && x.length > 0 ? x.join(', ') : '-'
}

function SectionCard(props: { title: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {props.title}
      </Typography>
      {props.children}
    </Paper>
  )
}

function KVTable(props: { rows: Array<{ k: string; v: React.ReactNode }> }) {
  return (
    <Table size="small">
      <TableBody>
        {props.rows.map((r) => (
          <TableRow key={r.k}>
            <TableCell sx={{ width: 240, color: 'text.secondary', fontWeight: 600 }}>{r.k}</TableCell>
            <TableCell>{r.v}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ProductVersionShowPage() {
  const { productId, versionId } = useParams()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = can(roles, 'PROD_MANAGER')

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
        setErr(e instanceof Error ? e.message : 'Failed to load version')
      }
    })()
  }, [productId, versionId])

  const spec = useMemo(() => versionData?.version?.spec_payload || null, [versionData])

  const layflatMm = useMemo(() => {
    const productType = spec?.identity?.product_type as string | undefined
    const baseWidth = typeof spec?.dimensions?.base_width_mm === 'number' ? spec.dimensions.base_width_mm : 0
    const sideOrGusset = typeof spec?.dimensions?.gusset_mm === 'number' ? spec.dimensions.gusset_mm : 0

    if (productType === 'Centerfold') return 0.5 * baseWidth
    if (productType === 'U-Film') return baseWidth + 2 * sideOrGusset
    if ((productType === 'Bag' || productType === 'Tube') && sideOrGusset > 0) return baseWidth + 2 * sideOrGusset
    return baseWidth
  }, [spec])

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
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h5">
            Job Sheet: {product.code} — Version {version.version_number}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Customer: {product.customer_name || '-'} • Created by: {version.created_by} • Created at: {version.created_at || '-'}
          </Typography>
          {product.description ? (
            <Typography variant="body2" color="text.secondary">
              Description: {product.description}
            </Typography>
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {isPm && (
            <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
              Create New Version
            </Button>
          )}
          <Button variant="outlined" component={Link} to={`/products/${productId}`}>
            Previous Versions
          </Button>
          <Button
            variant="outlined"
            component={Link}
            to={`/products/${productId}/versions/${versionId}/print`}
            target="_blank"
            rel="noreferrer"
          >
            Print
          </Button>
        </Box>
      </Box>

      {!spec ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No spec payload found for this version.
        </Typography>
      ) : (
        <>
          <SectionCard title="1. Product Identity">
            <KVTable
              rows={[
                { k: 'Product Type', v: spec.identity?.product_type || '-' },
                { k: 'Finish Mode', v: spec.identity?.finish_mode || '-' },
                { k: 'Industry Flags', v: fmtList(spec.identity?.industry_flags) },
                { k: 'Notes', v: spec.identity?.notes || '-' },
              ]}
            />
          </SectionCard>

          <SectionCard title="2. Dimensions & Geometry">
            <KVTable
              rows={[
                { k: 'Base Width', v: `${spec.dimensions?.base_width_mm ?? '-'} mm` },
                { k: 'Base Length', v: `${spec.dimensions?.base_length_mm ?? 'Continuous'} mm` },
                { k: 'Thickness', v: `${spec.dimensions?.thickness_um ?? '-'} µm` },
                { k: 'Geometry', v: spec.dimensions?.geometry || '-' },
                { k: 'Gusset Size', v: spec.dimensions?.gusset_mm ? `${spec.dimensions?.gusset_mm} mm` : '-' },
              ]}
            />

            <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Derived dimensions
              </Typography>
              <Typography variant="body2">
                Layflat (mm): <strong>{layflatMm}</strong>
              </Typography>
            </Paper>
          </SectionCard>

          <SectionCard title="3. Materials & Formulation">
            <KVTable
              rows={[
                { k: 'Blend Type', v: spec.formulation?.blend_type || 'Custom' },
                {
                  k: 'Resin Blend',
                  v:
                    Array.isArray(spec.formulation?.blend) && spec.formulation.blend.length > 0 ? (
                      <Stack spacing={0.5}>
                        {spec.formulation.blend.map((c: any, idx: number) => (
                          <Typography key={idx} variant="body2">
                            {c.resin_code}: {c.pct}%
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      '-'
                    ),
                },
                {
                  k: 'Colour',
                  v: spec.formulation?.colour?.colour_code ? (
                    <>
                      Code: {spec.formulation.colour.colour_code}
                      {spec.formulation.colour.strength_pct != null ? `, Strength: ${spec.formulation.colour.strength_pct}%` : ''}
                      {spec.formulation.colour.opaque ? ', Opaque' : ''}
                    </>
                  ) : (
                    'None'
                  ),
                },
                {
                  k: 'Additives',
                  v:
                    Array.isArray(spec.formulation?.additives) && spec.formulation.additives.length > 0 ? (
                      <Stack spacing={0.5}>
                        {spec.formulation.additives.map((a: any, idx: number) => (
                          <Typography key={idx} variant="body2">
                            {a.additive_code}: {a.pct}%
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      '-'
                    ),
                },
              ]}
            />
          </SectionCard>

          <SectionCard title="4. Printing & Artwork">
            <KVTable
              rows={[
                { k: 'Printing Method', v: spec.printing?.method || '-' },
                { k: 'Print Side', v: spec.printing?.method && spec.printing.method !== 'None' ? spec.printing?.side || '-' : '-' },
                { k: 'Number of Colours', v: spec.printing?.method && spec.printing.method !== 'None' ? spec.printing?.num_colours || 0 : '-' },
                { k: 'Print Description', v: spec.printing?.method && spec.printing.method !== 'None' ? spec.printing?.print_description || '-' : '-' },
                {
                  k: 'Front Ink/Plate',
                  v:
                    spec.printing?.method && spec.printing.method !== 'None' && Array.isArray(spec.printing?.front_ink_plate) && spec.printing.front_ink_plate.length > 0 ? (
                      <Stack spacing={0.5}>
                        {spec.printing.front_ink_plate.map((r: any, idx: number) => (
                          <Typography key={idx} variant="body2">
                            {r?.ink_code || '-'} | {r?.plate_code || '-'}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      '-'
                    ),
                },
                {
                  k: 'Back Ink/Plate',
                  v:
                    spec.printing?.method && spec.printing.method !== 'None' && Array.isArray(spec.printing?.back_ink_plate) && spec.printing.back_ink_plate.length > 0 ? (
                      <Stack spacing={0.5}>
                        {spec.printing.back_ink_plate.map((r: any, idx: number) => (
                          <Typography key={idx} variant="body2">
                            {r?.ink_code || '-'} | {r?.plate_code || '-'}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      '-'
                    ),
                },
              ]}
            />
          </SectionCard>

          <SectionCard title="5. Quality Expectations">
            <KVTable
              rows={[
                { k: 'Critical Flags', v: fmtList(spec.quality_expectations?.flags) },
                { k: 'Known Issues', v: spec.quality_expectations?.known_issues || '-' },
              ]}
            />
          </SectionCard>

          <SectionCard title="6. Run Requirements">
            <KVTable
              rows={[
                { k: 'Preferred Extruders', v: fmtList(spec.run_requirements?.preferred_extruders) },
                { k: 'Preferred Printer', v: spec.run_requirements?.preferred_printer || '-' },
                { k: 'Preferred Converter', v: spec.run_requirements?.preferred_converter || '-' },
                { k: 'Treat Inside/Outside', v: spec.run_requirements?.treat_inside_outside || '-' },
                { k: 'Inline Perforation', v: spec.run_requirements?.inline_perforation ? 'Yes' : 'No' },
                { k: 'Inline Seal', v: spec.run_requirements?.inline_seal ? 'Yes' : 'No' },
                { k: 'Setup Notes', v: spec.run_requirements?.notes || '-' },
              ]}
            />
          </SectionCard>

          <SectionCard title="7. Packaging & Logistics Requirements">
            <KVTable
              rows={[
                { k: 'Pack Mode', v: spec.packaging?.pack_mode || '-' },
                { k: 'Core Type', v: spec.packaging?.core_type || '-' },
                { k: 'Core Policy', v: spec.packaging?.core_policy || '-' },
                { k: 'Bags per Carton', v: spec.packaging?.bags_per_carton ?? '-' },
                { k: 'Pallet Type', v: spec.packaging?.pallet_type || '-' },
                { k: 'Wrapping Required', v: spec.packaging?.wrapped ? 'Yes' : 'No' },
              ]}
            />
          </SectionCard>

          {Array.isArray(spec.tool_requirements) && spec.tool_requirements.length > 0 ? (
            <SectionCard title="8. Tool Requirements">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Stage</TableCell>
                    <TableCell>Tool Type</TableCell>
                    <TableCell>Quantity</TableCell>
                    <TableCell>Preferred Machines</TableCell>
                    <TableCell>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {spec.tool_requirements.map((t: any, idx: number) => (
                    <TableRow key={idx} hover>
                      <TableCell>{t.stage}</TableCell>
                      <TableCell>{t.tool_type}</TableCell>
                      <TableCell>{t.quantity}</TableCell>
                      <TableCell>{fmtList(t.preferred_machine_ids)}</TableCell>
                      <TableCell>{t.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>
          ) : null}

          <SectionCard title="Required Operation Sequence">
            <Stack spacing={1}>
              {(routing.operations || []).map((op: any, idx: number) => (
                <Typography key={idx} variant="body2">
                  <strong>{op.operation_type}</strong>: {op.description}
                </Typography>
              ))}
            </Stack>

            {Array.isArray(routing.warnings) && routing.warnings.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Warnings
                </Typography>
                <Stack spacing={0.5}>
                  {routing.warnings.map((w: string, idx: number) => (
                    <Typography key={idx} variant="body2">
                      {w}
                    </Typography>
                  ))}
                </Stack>
              </Paper>
            ) : null}
          </SectionCard>
        </>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button component={Link} to={`/products/${productId}`} variant="outlined">
          Back to Product
        </Button>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
        <MuiLink component={Link} to={`/products/${productId}`} underline="hover" sx={{ alignSelf: 'center' }}>
          View product versions
        </MuiLink>
      </Box>
    </Stack>
  )
}


import { Paper, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material'

function fmtList(x: unknown): string {
  return Array.isArray(x) && x.length > 0 ? x.join(', ') : '-'
}

function fmtMm(v: unknown): string {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return '-'
  return String(Math.round(n))
}

function computeLayflatMm(spec: any): number {
  const productType = spec?.identity?.product_type as string | undefined
  const dims = spec?.dimensions || {}
  const middle = typeof dims.base_width_mm === 'number' ? dims.base_width_mm : 0
  const gusset = typeof dims.gusset_mm === 'number' ? dims.gusset_mm : 0
  const geometry = String(dims.geometry || 'Flat')

  if (productType === 'Centerfold' || geometry === 'CentreFold') return 0.5 * middle
  if (productType === 'U-Film') {
    const l = typeof dims.ufilm_left_width_mm === 'number' ? dims.ufilm_left_width_mm : 0
    const r = typeof dims.ufilm_right_width_mm === 'number' ? dims.ufilm_right_width_mm : 0
    return middle + l + r
  }
  if (geometry === 'Gusset' || (productType === 'Bag' || productType === 'Tube')) {
    if (gusset > 0) return middle + 2 * gusset
  }
  return middle
}

function layflatShorthand(spec: any, layflatMm: number): string {
  const productType = spec?.identity?.product_type as string | undefined
  const dims = spec?.dimensions || {}
  const middle = fmtMm(dims.base_width_mm)
  const geometry = String(dims.geometry || 'Flat')

  if (productType === 'U-Film') {
    const l = fmtMm(dims.ufilm_left_width_mm)
    const r = fmtMm(dims.ufilm_right_width_mm)
    return `${l} / ${middle} / ${r}`
  }
  if (productType === 'Centerfold' || geometry === 'CentreFold') {
    return `${middle} ( ${fmtMm(layflatMm)} )`
  }
  if (geometry === 'Gusset') {
    return `( ${middle} + ${fmtMm(dims.gusset_mm)} )`
  }
  return middle
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

export function ProductVersionSummary(props: { spec: any }) {
  const { spec } = props
  const layflatMm = computeLayflatMm(spec)
  const shorthand = layflatShorthand(spec, layflatMm)

  const printed = spec?.printing?.method && spec.printing.method !== 'None'
  const printMethod = (spec?.printing?.method as string | undefined) || 'None'
  const frontPairs = Array.isArray(spec?.printing?.front_ink_plate) ? spec.printing.front_ink_plate : []
  const backPairs = Array.isArray(spec?.printing?.back_ink_plate) ? spec.printing.back_ink_plate : []
  const fmtPairs = (pairs: any[]) => {
    const cleaned = pairs
      .map((r) => ({
        ink: (r?.ink_code ?? '').toString().trim(),
        plate: (r?.plate_code ?? '').toString().trim(),
        anilox: (r?.anilox_code ?? '').toString().trim(),
      }))
      .filter((r) => r.ink || r.plate || (printMethod === 'Uteco' && r.anilox))
    if (cleaned.length === 0) return '-'
    return (
      <Stack spacing={0.25}>
        {cleaned.slice(0, 4).map((r, idx) => (
          <Typography key={idx} variant="body2" sx={{ fontFamily: 'monospace' }}>
            {printMethod === 'Uteco' ? `${r.ink || '-'} | ${r.plate || '-'} | ${r.anilox || '-'}` : `${r.ink || '-'} | ${r.plate || '-'}`}
          </Typography>
        ))}
      </Stack>
    )
  }
  const options = [
    spec?.dimensions?.geometry === 'Gusset' ? 'Gusset' : null,
    printed ? 'Printed' : null,
    spec?.run_requirements?.inline_perforation ? 'Perforated' : null,
    spec?.run_requirements?.inline_seal ? 'Sealed' : null,
    spec?.run_requirements?.hole_punched ? 'Punched' : null,
  ].filter(Boolean)

  const lengthUnits = (spec?.dimensions?.length_units as string | undefined) || 'mm'
  const baseLenMm = spec?.dimensions?.base_length_mm
  const lengthDisplay =
    baseLenMm == null
      ? 'Continuous'
      : lengthUnits === 'M'
        ? `${(Number(baseLenMm) / 1000).toFixed(3).replace(/\.?0+$/, '')} M`
        : `${baseLenMm} mm`

  return (
    <Stack spacing={2}>
      <SectionCard title="1. Product Identity">
        <KVTable
          rows={[
            { k: 'Product Type', v: spec?.identity?.product_type || '-' },
            { k: 'Finish Mode', v: spec?.identity?.finish_mode || '-' },
            { k: 'Industry / Compliance Intent', v: fmtList(spec?.identity?.industry_flags) },
            { k: 'Options', v: options.length ? options.join(', ') : '-' },
            { k: 'Notes', v: spec?.identity?.notes || '-' },
          ]}
        />
      </SectionCard>

      <SectionCard title="2. Dimensions & Geometry">
        <KVTable
          rows={[
            { k: 'Geometry', v: spec?.dimensions?.geometry || '-' },
            { k: 'Width', v: `${spec?.dimensions?.base_width_mm ?? '-'} mm` },
            { k: 'Width tolerance', v: spec?.dimensions?.width_tolerance_mm != null ? `${spec.dimensions.width_tolerance_mm} mm` : '-' },
            {
              k: 'U-Film Left / Right',
              v:
                spec?.identity?.product_type === 'U-Film'
                  ? `${spec?.dimensions?.ufilm_left_width_mm ?? '-'} / ${spec?.dimensions?.ufilm_right_width_mm ?? '-'} mm`
                  : '-',
            },
            { k: 'Gusset Return', v: spec?.dimensions?.gusset_mm != null ? `${spec.dimensions.gusset_mm} mm` : '-' },
            { k: 'Length', v: lengthDisplay },
            { k: 'Thickness/Gauge', v: `${spec?.dimensions?.thickness_um ?? '-'} µm` },
          ]}
        />

        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Geometry
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            Shorthand: {shorthand}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Layflat Width: <strong>{fmtMm(layflatMm)}mm</strong>
          </Typography>
        </Paper>
      </SectionCard>

      <SectionCard title="3. Materials & Formulation">
        <KVTable
          rows={[
            { k: 'Resin Blend', v: spec?.formulation?.blend_type || 'Custom' },
            {
              k: 'Resin Components',
              v:
                Array.isArray(spec?.formulation?.blend) && spec.formulation.blend.length > 0 ? (
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
              k: 'Colour Components',
              v:
                Array.isArray(spec?.formulation?.colour_components) && spec.formulation.colour_components.length > 0 ? (
                  <Stack spacing={0.5}>
                    {spec.formulation.colour_components.map((c: any, idx: number) => (
                      <Typography key={idx} variant="body2">
                        {c.colour_code || '-'}
                        {c.strength_pct != null ? `: ${c.strength_pct}%` : ''}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  'None'
                ),
            },
            {
              k: 'Additives',
              v:
                Array.isArray(spec?.formulation?.additives) && spec.formulation.additives.length > 0 ? (
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
            { k: 'Method', v: spec?.printing?.method || '-' },
            { k: 'Side', v: printed ? spec?.printing?.side || '-' : '-' },
            { k: 'Print Description', v: printed ? spec?.printing?.print_description || '-' : '-' },
            {
              k: 'Front Ink/Plate',
              v: printMethod === 'Inline' || printMethod === 'Uteco' ? fmtPairs(frontPairs) : '-',
            },
            {
              k: 'Back Ink/Plate',
              v: printMethod === 'Inline' || printMethod === 'Uteco' ? fmtPairs(backPairs) : '-',
            },
            {
              k: 'Cylinder size (mm)',
              v: printMethod === 'Uteco' ? (spec?.printing?.cylinder_size_mm != null ? String(spec.printing.cylinder_size_mm) : '-') : '-',
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="5. Quality Expectations">
        <KVTable
          rows={[
            { k: 'Quality Flags', v: fmtList(spec?.quality_expectations?.flags) },
            { k: 'Known Issues', v: spec?.quality_expectations?.known_issues || '-' },
          ]}
        />
      </SectionCard>

      <SectionCard title="6. Run Requirements">
        <KVTable
          rows={[
            { k: 'Trim (%)', v: spec?.identity?.trim_pct ?? '-' },
            { k: 'Run Up', v: spec?.run_requirements?.run_up || '-' },
            { k: 'Slit', v: spec?.run_requirements?.slit || '-' },
            { k: 'Treat Inside/Outside', v: spec?.run_requirements?.treat_inside_outside || '-' },
            { k: 'Notes', v: spec?.run_requirements?.notes || '-' },
          ]}
        />
      </SectionCard>

      <SectionCard title="7. Packaging & Logistics">
        <KVTable
          rows={[
            { k: 'Finish Mode', v: spec?.identity?.finish_mode || '-' },
            { k: 'Core Type', v: spec?.packaging?.core_type || '-' },
            { k: 'Roll weight billing', v: spec?.identity?.roll_weight_billing || '-' },
            { k: 'Bags per carton', v: spec?.packaging?.bags_per_carton ?? '-' },
            { k: 'Pallet Type', v: spec?.packaging?.pallet_type || '-' },
            { k: 'Packing Notes', v: spec?.packaging?.notes || '-' },
          ]}
        />
      </SectionCard>
    </Stack>
  )
}


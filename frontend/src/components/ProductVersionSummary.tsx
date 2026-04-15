import { Box, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'

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
  const geomLower = geometry.toLowerCase()

  if (productType === 'Centerfold' || geometry === 'CentreFold') return 0.5 * middle
  if (productType === 'U-Film') {
    const l = typeof dims.ufilm_left_width_mm === 'number' ? dims.ufilm_left_width_mm : 0
    const r = typeof dims.ufilm_right_width_mm === 'number' ? dims.ufilm_right_width_mm : 0
    return middle + l + r
  }
  // Match quoteCalculator / SpecPayloadForm: gusset_mm is additional layflat once (width + gusset).
  if (geomLower === 'gusset') return middle + gusset
  return middle
}

const QUALITY_FLAG_LABELS: Record<string, string> = {
  tight_gauge: 'Tight gauge tolerance',
  seal_integrity: 'Seal integrity critical',
  cosmetic: 'Printing Quality',
  colour: 'Colour critical',
}

const INDUSTRY_FLAG_LABELS: Record<string, string> = {
  food_contact: 'Food Contact',
  medical: 'Medical',
  chemical_industrial: 'Chemical / Industrial',
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

function formatRunUp(slug: unknown): string {
  if (slug == null || slug === '' || slug === 'none') return '—'
  const s = String(slug)
  if (s === '1up' || s === '2up' || s.endsWith('up')) return s.replace('up', ' up')
  return s
}

/** Non-empty ink/plate rows for display (same idea as edit form rows). */
function meaningfulInkPlateRows(pairs: unknown[]): Array<{ ink: string; plate: string }> {
  return (Array.isArray(pairs) ? pairs : [])
    .map((r: any) => ({
      ink: (r?.ink_code ?? '').toString().trim(),
      plate: (r?.plate_code ?? '').toString().trim(),
    }))
    .filter((row) => row.ink || row.plate)
}

function InkPlateTable(props: { title: string; rows: Array<{ ink: string; plate: string }> }) {
  const { title, rows } = props
  if (rows.length === 0) {
    return (
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          —
        </Typography>
      </Stack>
    )
  }
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 48 }}>#</TableCell>
            <TableCell>Ink</TableCell>
            <TableCell>Plate</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell>{i + 1}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace' }}>{r.ink || '—'}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace' }}>{r.plate || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}

export function ProductVersionSummary(props: { spec: any }) {
  const { spec } = props
  const layflatMm = computeLayflatMm(spec)

  const printed = spec?.printing?.method && spec.printing.method !== 'None'
  const printMethod = (spec?.printing?.method as string | undefined) || 'None'
  const printSide = (spec?.printing?.side as string | undefined) || 'front'
  const showFrontPrint = printed && (printSide === 'front' || printSide === 'both')
  const showBackPrint = printed && (printSide === 'back' || printSide === 'both')

  const frontRows = meaningfulInkPlateRows(spec?.printing?.front_ink_plate)
  const backRows = meaningfulInkPlateRows(spec?.printing?.back_ink_plate)

  const inkCodesLegacy = Array.isArray(spec?.printing?.ink_codes) ? spec.printing.ink_codes.filter(Boolean) : []
  const plateCodesLegacy = Array.isArray(spec?.printing?.plate_codes) ? spec.printing.plate_codes.filter(Boolean) : []
  const artworkRefs = Array.isArray(spec?.printing?.artwork_refs) ? spec.printing.artwork_refs.filter(Boolean) : []

  const gussetOn = spec?.dimensions?.geometry === 'Gusset'
  const options = [
    gussetOn ? 'Gusset' : null,
    printed ? 'Printed' : null,
    spec?.run_requirements?.inline_perforation ? 'Perforated' : null,
    spec?.run_requirements?.inline_seal ? 'Sealed' : null,
    spec?.run_requirements?.hole_punched ? 'Punched' : null,
  ].filter(Boolean)

  const lengthUnitsRaw = (spec?.dimensions?.length_units as string | undefined) || 'mm'
  const lengthUnits =
    lengthUnitsRaw === 'Continuous' || lengthUnitsRaw?.toLowerCase() === 'continuous' ? 'Continuous' : lengthUnitsRaw
  const baseLenMm = spec?.dimensions?.base_length_mm
  const lengthDisplay =
    lengthUnits === 'Continuous' || baseLenMm == null
      ? 'Continuous'
      : lengthUnits === 'M'
        ? `${(Number(baseLenMm) / 1000).toFixed(3).replace(/\.?0+$/, '')} M`
        : `${baseLenMm} mm`

  const productType = spec?.identity?.product_type as string | undefined
  const isUFilm = productType === 'U-Film'
  const finishMode = spec?.identity?.finish_mode || '-'

  const qualityFlags = Array.isArray(spec?.quality_expectations?.flags) ? spec.quality_expectations.flags : []
  const qualityLabels = qualityFlags.map((id: string) => QUALITY_FLAG_LABELS[id] || id)

  const industryFlags = Array.isArray(spec?.identity?.industry_flags) ? spec.identity.industry_flags : []
  const industryLabels = industryFlags.map((id: string) => INDUSTRY_FLAG_LABELS[id] || id)

  return (
    <Stack spacing={2}>
      {/* 1. Product Type — matches SpecPayloadForm first Paper */}
      <SectionCard title="1. Product Type">
        <KVTable
          rows={[
            { k: 'Product Type', v: spec?.identity?.product_type || '-' },
            { k: 'Finish Mode', v: finishMode },
            ...(spec?.identity?.notes
              ? [{ k: 'Product notes', v: spec.identity.notes }]
              : []),
          ]}
        />
      </SectionCard>

      {/* 2. Dimensions & Geometry — matches SpecPayloadForm second Paper (checkboxes → widths → length → thickness/trim/tolerance) */}
      <SectionCard title="2. Dimensions & Geometry">
        <KVTable
          rows={[
            { k: 'Options', v: options.length ? options.join(', ') : '-' },
            ...(isUFilm
              ? [
                  { k: 'Left width (mm)', v: spec?.dimensions?.ufilm_left_width_mm ?? '-' },
                  { k: 'Middle width (mm)', v: spec?.dimensions?.base_width_mm ?? '-' },
                  { k: 'Right width (mm)', v: spec?.dimensions?.ufilm_right_width_mm ?? '-' },
                ]
              : gussetOn
                ? [
                    { k: `${productType || 'Product'} width (mm)`, v: spec?.dimensions?.base_width_mm ?? '-' },
                    { k: 'Gusset return (mm)', v: spec?.dimensions?.gusset_mm ?? '-' },
                    { k: 'Layflat width (mm)', v: fmtMm(layflatMm) },
                  ]
                : [{ k: `${productType || 'Product'} width (mm)`, v: spec?.dimensions?.base_width_mm ?? '-' }]),
            { k: 'Length units', v: lengthUnits },
            { k: 'Length', v: lengthDisplay },
            { k: 'Thickness/Gauge (µm)', v: spec?.dimensions?.thickness_um ?? '-' },
          ]}
        />
      </SectionCard>

      {/* 3. Materials */}
      <SectionCard title="3. Materials">
        <KVTable
          rows={[
            { k: 'Resin blend', v: spec?.formulation?.blend_type || 'Custom' },
            {
              k: 'Resin components',
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
              k: 'Colour components',
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

      {/* 4. Printing & Artwork — method, side, ink/plate tables, Uteco extras, description */}
      <SectionCard title="4. Printing & Artwork">
        <KVTable
          rows={[
            { k: 'Printing method', v: printMethod },
            { k: 'Print side', v: printed ? printSide : '-' },
          ]}
        />

        {printed && (printMethod === 'Inline' || printMethod === 'Uteco') ? (
          <Stack sx={{ mt: 2 }}>
            {showFrontPrint ? <InkPlateTable title="Front print" rows={frontRows} /> : null}
            {showBackPrint ? <InkPlateTable title="Back print" rows={backRows} /> : null}

            {frontRows.length === 0 && backRows.length === 0 && (inkCodesLegacy.length > 0 || plateCodesLegacy.length > 0) ? (
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Legacy ink / plate codes
                </Typography>
                <Typography variant="body2">
                  Inks: {inkCodesLegacy.length ? inkCodesLegacy.join(', ') : '—'}
                </Typography>
                <Typography variant="body2">
                  Plates: {plateCodesLegacy.length ? plateCodesLegacy.join(', ') : '—'}
                </Typography>
              </Stack>
            ) : null}

            {printMethod === 'Uteco' ? (
              <KVTable
                rows={[
                  {
                    k: 'Cylinder size (mm)',
                    v: spec?.printing?.cylinder_size_mm != null ? String(spec.printing.cylinder_size_mm) : '-',
                  },
                ]}
              />
            ) : null}

            {spec?.printing?.num_colours != null && spec.printing.num_colours !== '' ? (
              <Typography variant="body2" sx={{ mt: 1 }}>
                <strong>Number of colours:</strong> {String(spec.printing.num_colours)}
              </Typography>
            ) : null}

            {artworkRefs.length > 0 ? (
              <Typography variant="body2" sx={{ mt: 1 }}>
                <strong>Artwork refs:</strong> {artworkRefs.join(', ')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {printed ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
              Print description
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {spec?.printing?.print_description?.trim() ? spec.printing.print_description : '—'}
            </Typography>
          </Box>
        ) : null}
      </SectionCard>

      {/* 5. Quality Expectations */}
      <SectionCard title="5. Quality Expectations">
        <KVTable
          rows={[
            { k: 'Quality flags', v: qualityLabels.length ? qualityLabels.join(', ') : '-' },
            { k: 'Industry / compliance intent', v: industryLabels.length ? industryLabels.join(', ') : '-' },
            { k: 'Known issues', v: spec?.quality_expectations?.known_issues || '-' },
          ]}
        />
      </SectionCard>

      {/* 6. Run Requirements */}
      <SectionCard title="6. Run Requirements">
        <KVTable
          rows={[
            { k: 'Core Type', v: spec?.packaging?.core_type || '-' },
            {
              k: finishMode === 'Cartons' ? 'Bags per carton' : 'Roll weight billing',
              v:
                finishMode === 'Cartons'
                  ? (spec?.packaging?.bags_per_carton ?? '-')
                  : (spec?.identity?.roll_weight_billing || '-'),
            },
            { k: 'Trim (%)', v: spec?.identity?.trim_pct ?? '-' },
            { k: 'Tolerance (mm)', v: spec?.dimensions?.width_tolerance_mm ?? '-' },
            { k: 'Run up', v: formatRunUp(spec?.run_requirements?.run_up) },
            { k: 'Slit', v: spec?.run_requirements?.slit || '-' },
            { k: 'Treat inside/outside', v: spec?.run_requirements?.treat_inside_outside || '-' },
            { k: 'Notes', v: spec?.run_requirements?.notes || '-' },
          ]}
        />
      </SectionCard>

      {/* 7. Packaging & Logistics */}
      <SectionCard title="7. Packaging & Logistics">
        <KVTable
          rows={[
            { k: 'Pallet type', v: spec?.packaging?.pallet_type || '-' },
            { k: 'Packing notes', v: spec?.packaging?.notes || '-' },
          ]}
        />
      </SectionCard>
    </Stack>
  )
}

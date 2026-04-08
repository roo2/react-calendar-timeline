import { Box, Divider, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import {
  fmtCount,
  fmtDollarsPreview,
  fmtHoursMinutesPreview,
  fmtQtyNumber,
} from '../../../utils/quoteFormat'

export function QuotePreviewPanel(props: {
  preview: any
  loading: boolean
  canCalculate: boolean
  missing: string[]
  finishMode: 'Rolls' | 'Cartons'
  productType: string
  estimatedPallets: number | null
  /** From {@link computeProductDescriptionFromSpec} on the current quote spec (same as product list / editor). */
  productDescription?: string
}) {
  const {
    preview,
    loading,
    canCalculate,
    missing,
    finishMode,
    productType,
    estimatedPallets,
    productDescription = '',
  } = props
  const p = preview
  const dash = '—'
  const productUnitLabel = productType === 'Bag' ? 'Bags' : productType === 'U-Film' ? 'U-Films' : `${productType}s`
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Live Quote</Typography>
        <Typography variant="caption" color="text.secondary">
          {loading ? 'Calculating…' : p ? 'Up to date' : canCalculate ? 'Ready' : 'Incomplete'}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ mt: 1.5, wordBreak: 'break-word' }}>
        {productDescription.trim() ? productDescription.trim() : '—'}
      </Typography>

      <Divider sx={{ mt: 2, mb: 1 }} />

      {!p && missing.length > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Missing: {missing.join(', ')}
        </Typography>
      ) : null}

      <Box>
        {p ? (
          <>
            {(() => {
              const kgPerUnit =
                p.kg_per_unit != null
                  ? Number(p.kg_per_unit)
                  : Number(p.totals_units || 0) > 0 && p.totals_kg != null
                    ? Number(p.totals_kg) / Number(p.totals_units || 1)
                    : null
              const kgPer1000 = kgPerUnit != null && Number.isFinite(kgPerUnit) ? kgPerUnit * 1000 : null
              if (kgPer1000 == null || !Number.isFinite(kgPer1000)) return null
              return (
                <Typography variant="body2">
                  Yield estimate: {fmtQtyNumber(kgPer1000, 2)}kg / {fmtCount(1000)} products
                </Typography>
              )
            })()}
            {p.cost_per_kg != null && (
              <Typography variant="body2">
                Cost / kg: {fmtDollarsPreview(p.cost_per_kg)}
              </Typography>
            )}
            {p.extrusion_hours != null ? (
              <Typography variant="body2">
                Extrusion time: {fmtHoursMinutesPreview(Number(p.extrusion_hours) * 60)}
              </Typography>
            ) : null}
            {Number(p.extrusion_waste_minutes || 0) > 0 ? (
              <Typography variant="body2">
                Wasted extrusion time: {fmtHoursMinutesPreview(Number(p.extrusion_waste_minutes || 0))}
              </Typography>
            ) : null}
            {p.total_extruded_kg != null && Number(p.total_extruded_kg) > 0 ? (
              <Typography variant="body2">
                Total extruded KGs: {fmtQtyNumber(Number(p.total_extruded_kg), 2)} kg
              </Typography>
            ) : null}
            {finishMode === 'Rolls' && p.kg_per_roll != null && (
              <Typography variant="body2">
                Weight / Roll: {fmtQtyNumber(Number(p.kg_per_roll), 2)}kg
              </Typography>
            )}
            {finishMode === 'Rolls' && p.units_per_roll != null && (
              <Typography variant="body2">
                {productUnitLabel} / Roll: {fmtQtyNumber(Number(p.units_per_roll), 2)}
              </Typography>
            )}
            {p.unit_price != null && (
              <Typography variant="body2">
                {productType === 'Bag' ? (
                  <>Price per 1000 bags: {fmtDollarsPreview(Number(p.unit_price) * 1000, 2)}</>
                ) : productType === 'Centerfold' ? (
                  <>Price per 1000 Centerfolds: {fmtDollarsPreview(Number(p.unit_price) * 1000, 2)}</>
                ) : productType === 'Sleeve' ? (
                  <>Price per 1000 Sleeves: {fmtDollarsPreview(Number(p.unit_price) * 1000, 2)}</>
                ) : (
                  <>Price per {productType}: {fmtDollarsPreview(p.unit_price, 4)}</>
                )}
              </Typography>
            )}
            {productType === 'Centerfold' ? (
              <Typography variant="body2">
                Total Centerfolds:{' '}
                {p.totals_units != null && Number(p.totals_units) > 0 ? fmtCount(Number(p.totals_units)) : dash}
              </Typography>
            ) : null}
            {p.totals_m != null && Number(p.totals_m) > 0 && (
              <Typography variant="body2">
                Total meters: {fmtQtyNumber(Number(p.totals_m), 2)}m
              </Typography>
            )}
            {p.cartons != null && (
              <Typography variant="body2">
                Cartons: {fmtCount(Number(p.cartons))}
                {p.kg_per_carton != null ? ` (${fmtQtyNumber(Number(p.kg_per_carton), 2)}kg/carton)` : ''}
              </Typography>
            )}
            {estimatedPallets != null && (
              <Typography variant="body2">
                Estimated pallets: {fmtCount(estimatedPallets)}
              </Typography>
            )}
            {p.conversion_minutes_total != null && (
              <Typography variant="body2">
                Conversion time: {fmtHoursMinutesPreview(Number(p.conversion_minutes_total))}
                {p.conversion_minutes_run != null && p.conversion_minutes_roll_changes != null
                  ? ` (${fmtHoursMinutesPreview(Number(p.conversion_minutes_run))} run + ${fmtHoursMinutesPreview(Number(p.conversion_minutes_roll_changes))} change)`
                  : ''}
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {canCalculate ? 'Ready to calculate.' : 'Add more details to see pricing.'}
          </Typography>
        )}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Breakdown
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Stage</TableCell>
            <TableCell>Cost</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Material</TableCell>
            <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.material_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Extrusion</TableCell>
            <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.extrusion_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Printing</TableCell>
            <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.printing_cost) : dash}</TableCell>
          </TableRow>
          {p?.printing_unavailable_reason ? (
            <TableRow>
              <TableCell colSpan={2} sx={{ py: 0.5, pt: 0, borderBottom: 'none' }}>
                <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                  {String(p.printing_unavailable_reason)}
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>Conversion</TableCell>
            <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.conversion_cost) : dash}</TableCell>
          </TableRow>
          {finishMode === 'Rolls' ? (
            <TableRow>
              <TableCell>Core</TableCell>
              <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.core_cost) : dash}</TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>Waste</TableCell>
            <TableCell>{p ? fmtDollarsPreview(p.cost_breakdown?.waste_cost) : dash}</TableCell>
          </TableRow>

          <TableRow>
            <TableCell colSpan={2} sx={{ py: 0.5 }} />
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Total cost</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{p ? fmtDollarsPreview(p.total_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Margin (%)</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>
              {p ? `${fmtQtyNumber(Number(p.margin || 0) * 100, 2)}%` : dash}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Suggested price</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{p ? fmtDollarsPreview(p.final_price) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Total KG</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>
              {p && p.totals_kg != null && Number.isFinite(Number(p.totals_kg)) && Number(p.totals_kg) > 0
                ? `${fmtQtyNumber(Number(p.totals_kg), 2)} kg`
                : dash}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Suggested price / kg</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>
              {p && Number(p.totals_kg || 0) > 0
                ? `${fmtDollarsPreview(Number(p.final_price || 0) / Number(p.totals_kg || 1))} /kg`
                : dash}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  )
}

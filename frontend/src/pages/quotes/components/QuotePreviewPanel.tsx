import { Box, Divider, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { fmtDollars, fmtHoursMinutes } from '../../../utils/quoteFormat'

export function QuotePreviewPanel(props: {
  preview: any
  loading: boolean
  canCalculate: boolean
  missing: string[]
  finishMode: 'Rolls' | 'Cartons'
  productType: string
  estimatedPallets: number | null
}) {
  const { preview, loading, canCalculate, missing, finishMode, productType, estimatedPallets } = props
  const p = preview
  const dash = '—'
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Live Quote</Typography>
        <Typography variant="caption" color="text.secondary">
          {loading ? 'Calculating…' : p ? 'Up to date' : canCalculate ? 'Ready' : 'Incomplete'}
        </Typography>
      </Box>

      {!p && missing.length > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Missing: {missing.join(', ')}
        </Typography>
      ) : null}

      <Box sx={{ mt: 1 }}>
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
                  Yield estimate: {kgPer1000.toFixed(2)}kg / 1000 products
                </Typography>
              )
            })()}
            {p.cost_per_kg != null && (
              <Typography variant="body2">
                Cost / kg: {fmtDollars(p.cost_per_kg)}
              </Typography>
            )}
            {p.extrusion_hours != null ? (
              <Typography variant="body2">
                Extrusion time: {fmtHoursMinutes(Number(p.extrusion_hours) * 60)}
              </Typography>
            ) : null}
            {Number(p.extrusion_waste_minutes || 0) > 0 ? (
              <Typography variant="body2">
                Wasted extrusion time: {fmtHoursMinutes(Number(p.extrusion_waste_minutes || 0))}
              </Typography>
            ) : null}
            {finishMode === 'Rolls' && p.kg_per_roll != null && (
              <Typography variant="body2">
                Weight / Roll: {Number(p.kg_per_roll).toFixed(2)}kg
              </Typography>
            )}
            {finishMode === 'Rolls' && p.m_per_roll != null && (
              <Typography variant="body2">
                Meters / Roll: {Number(p.m_per_roll).toFixed(2)}m
              </Typography>
            )}
            {p.unit_price != null && (
              <Typography variant="body2">
                Price per {productType}: {fmtDollars(p.unit_price, 4)}
              </Typography>
            )}
            {p.totals_m != null && Number(p.totals_m) > 0 && (
              <Typography variant="body2">
                Total meters: {Number(p.totals_m).toFixed(2)}m
              </Typography>
            )}
            {p.cartons != null && (
              <Typography variant="body2">
                Cartons: {Number(p.cartons)}
                {p.kg_per_carton != null ? ` (${Number(p.kg_per_carton).toFixed(2)}kg/carton)` : ''}
              </Typography>
            )}
            {estimatedPallets != null && (
              <Typography variant="body2">
                Estimated pallets: {estimatedPallets}
              </Typography>
            )}
            {p.conversion_minutes_total != null && (
              <Typography variant="body2">
                Conversion time: {fmtHoursMinutes(Number(p.conversion_minutes_total))}
                {p.conversion_minutes_run != null && p.conversion_minutes_roll_changes != null
                  ? ` (${fmtHoursMinutes(Number(p.conversion_minutes_run))} run + ${fmtHoursMinutes(Number(p.conversion_minutes_roll_changes))} change)`
                  : ''}
              </Typography>
            )}
            {p.carton_cost_total != null && Number(p.carton_cost_total || 0) > 0 && (
              <Typography variant="body2">Carton cost: {fmtDollars(p.carton_cost_total)}</Typography>
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
            <TableCell>{p ? fmtDollars(p.cost_breakdown?.material_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Extrusion</TableCell>
            <TableCell>{p ? fmtDollars(p.cost_breakdown?.extrusion_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Printing</TableCell>
            <TableCell>{p ? fmtDollars(p.cost_breakdown?.printing_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Conversion</TableCell>
            <TableCell>{p ? fmtDollars(p.cost_breakdown?.conversion_cost) : dash}</TableCell>
          </TableRow>
          {finishMode === 'Rolls' ? (
            <TableRow>
              <TableCell>Core</TableCell>
              <TableCell>{p ? fmtDollars(p.cost_breakdown?.core_cost) : dash}</TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>Waste</TableCell>
            <TableCell>{p ? fmtDollars(p.cost_breakdown?.waste_cost) : dash}</TableCell>
          </TableRow>

          <TableRow>
            <TableCell colSpan={2} sx={{ py: 0.5 }} />
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Total cost</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{p ? fmtDollars(p.total_cost) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Margin (%)</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{p ? `${(Number(p.margin || 0) * 100).toFixed(2)}%` : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Suggested price</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{p ? fmtDollars(p.final_price) : dash}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Suggested price / kg</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>
              {p && Number(p.totals_kg || 0) > 0
                ? fmtDollars(Number(p.final_price || 0) / Number(p.totals_kg || 1))
                : dash}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  )
}

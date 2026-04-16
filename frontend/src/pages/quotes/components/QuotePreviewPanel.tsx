import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Divider, IconButton, Paper, SvgIcon, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import {
  fmtCount,
  fmtDollarsLineItem,
  fmtDollarsPreview,
  fmtHoursMinutesPreview,
  fmtQtyNumber,
} from '../../../utils/quoteFormat'
import type { QtyType } from '../../../utils/quantityRollFields'

/** Brief yellow highlight when `watch` (serialized) changes — skips first paint. */
function FlashSpan(props: { watch: unknown; children: ReactNode }) {
  const { watch, children } = props
  const key = watch == null || (typeof watch === 'number' && !Number.isFinite(Number(watch))) ? '' : String(watch)
  const prev = useRef<string | null>(null)
  const [gen, setGen] = useState(0)
  useEffect(() => {
    if (prev.current === null) {
      prev.current = key
      return
    }
    if (prev.current !== key) {
      prev.current = key
      setGen((g) => g + 1)
    }
  }, [key])
  return (
    <Box
      component="span"
      key={gen}
      sx={{
        display: 'inline-block',
        borderRadius: 0.5,
        px: 0.25,
        mx: -0.25,
        '@keyframes quotePreviewFlash': {
          '0%': { backgroundColor: 'rgba(255, 236, 179, 0.92)' },
          '40%': { backgroundColor: 'rgba(255, 236, 179, 0.5)' },
          '100%': { backgroundColor: 'transparent' },
        },
        animation: gen > 0 ? 'quotePreviewFlash 1.35s ease-out forwards' : 'none',
      }}
    >
      {children}
    </Box>
  )
}

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
  /** Clears the optional Price per kg override (e.g. from the Adjustments row). */
  onClearPricePerKgOverride?: () => void
  /** When `units` (total product count), show **per 1000** in the breakdown next to per Kg / per Roll / per Carton. */
  qtyType?: QtyType
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
    onClearPricePerKgOverride,
    qtyType,
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
            {p.unit_price != null &&
            productType !== 'Bag' &&
            productType !== 'Centerfold' &&
            productType !== 'Sleeve' ? (
              <Typography variant="body2">
                Price per {productType}: {fmtDollarsLineItem(p.unit_price, 4)}
              </Typography>
            ) : null}
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
            <TableCell align="right">Cost</TableCell>
            <TableCell align="right">Price</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Material</TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.cost_breakdown?.material_cost}>{fmtDollarsLineItem(p.cost_breakdown?.material_cost)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.price_breakdown?.material_price}>{fmtDollarsLineItem(p.price_breakdown?.material_price)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ pl: 2, color: 'text.secondary' }}>Colours / additives / blend</TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.cost_breakdown?.formulation_line_cost}>
                  {fmtDollarsLineItem(p.cost_breakdown?.formulation_line_cost)}
                </FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.price_breakdown?.formulation_line_price}>
                  {fmtDollarsLineItem(p.price_breakdown?.formulation_line_price)}
                </FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Extrusion</TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.cost_breakdown?.extrusion_cost}>{fmtDollarsLineItem(p.cost_breakdown?.extrusion_cost)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.price_breakdown?.extrusion_price}>{fmtDollarsLineItem(p.price_breakdown?.extrusion_price)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Printing</TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.cost_breakdown?.printing_cost}>{fmtDollarsLineItem(p.cost_breakdown?.printing_cost)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.price_breakdown?.printing_price}>{fmtDollarsLineItem(p.price_breakdown?.printing_price)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          {p?.printing_unavailable_reason ? (
            <TableRow>
              <TableCell colSpan={3} sx={{ py: 0.5, pt: 0, borderBottom: 'none' }}>
                <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                  {String(p.printing_unavailable_reason)}
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>Conversion</TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.cost_breakdown?.conversion_cost}>{fmtDollarsLineItem(p.cost_breakdown?.conversion_cost)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
            <TableCell align="right">
              {p ? (
                <FlashSpan watch={p.price_breakdown?.conversion_price}>{fmtDollarsLineItem(p.price_breakdown?.conversion_price)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          {finishMode === 'Rolls' ? (
            <TableRow>
              <TableCell>Core</TableCell>
              <TableCell align="right">
                {p ? <FlashSpan watch={p.cost_breakdown?.core_cost}>{fmtDollarsLineItem(p.cost_breakdown?.core_cost)}</FlashSpan> : dash}
              </TableCell>
              <TableCell align="right">
                {p ? <FlashSpan watch={p.price_breakdown?.core_price}>{fmtDollarsLineItem(p.price_breakdown?.core_price)}</FlashSpan> : dash}
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>Waste</TableCell>
            <TableCell align="right">
              {p ? <FlashSpan watch={p.cost_breakdown?.waste_cost}>{fmtDollarsLineItem(p.cost_breakdown?.waste_cost)}</FlashSpan> : dash}
            </TableCell>
            <TableCell align="right">
              {p ? <FlashSpan watch={p.price_breakdown?.waste_price}>{fmtDollarsLineItem(p.price_breakdown?.waste_price)}</FlashSpan> : dash}
            </TableCell>
          </TableRow>
          {p?.price_override_active ? (
            <TableRow>
              <TableCell>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, verticalAlign: 'middle' }}>
                  Adjustments
                  {onClearPricePerKgOverride ? (
                    <IconButton
                      size="small"
                      aria-label="Clear price per kg override"
                      onClick={onClearPricePerKgOverride}
                      sx={{ p: 0.25, ml: 0.25, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
                    >
                      <SvgIcon fontSize="small" viewBox="0 0 24 24" aria-hidden>
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </SvgIcon>
                    </IconButton>
                  ) : null}
                </Box>
              </TableCell>
              <TableCell align="right">{dash}</TableCell>
              <TableCell align="right">
                {p.adjustments_price != null ? (
                  <FlashSpan watch={p.adjustments_price}>{fmtDollarsPreview(p.adjustments_price)}</FlashSpan>
                ) : (
                  dash
                )}
              </TableCell>
            </TableRow>
          ) : null}

          <TableRow>
            <TableCell colSpan={3} sx={{ py: 0.5 }} />
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
            <TableCell align="right" sx={{ fontWeight: 400 }}>
              {p ? <FlashSpan watch={p.total_cost}>{fmtDollarsLineItem(p.total_cost)}</FlashSpan> : dash}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {p ? <FlashSpan watch={p.final_price}>{fmtDollarsLineItem(p.final_price)}</FlashSpan> : dash}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Margin (%)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }} colSpan={2}>
              {p ? (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ fontWeight: 600, color: Number(p.margin) < 0 ? 'error.main' : 'inherit' }}
                >
                  <FlashSpan watch={p.margin}>{`${fmtQtyNumber(Number(p.margin || 0) * 100, 2)}%`}</FlashSpan>
                </Typography>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          {(() => {
            const kgOk = p && Number(p.totals_kg || 0) > 0 && p.cost_per_kg != null && p.price_per_kg != null
            if (!kgOk) return null
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>per Kg</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }}>
                  <FlashSpan watch={p.cost_per_kg}>{fmtDollarsLineItem(Number(p.cost_per_kg))}</FlashSpan>
                </TableCell>
                <TableCell align="right">
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                    <FlashSpan watch={p.price_per_kg}>{fmtDollarsLineItem(Number(p.price_per_kg))}</FlashSpan>
                  </Typography>
                </TableCell>
              </TableRow>
            )
          })()}
          {(() => {
            if (!p || qtyType !== 'units') return null
            const u = Number(p.totals_units || 0)
            if (!(u > 0)) return null
            const per1000 = u / 1000
            const c = Number(p.total_cost) / per1000
            const pr = Number(p.final_price) / per1000
            if (!Number.isFinite(c) || !Number.isFinite(pr)) return null
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>per 1000</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }}>
                  <FlashSpan watch={`${p.total_cost}|${u}`}>{fmtDollarsLineItem(c)}</FlashSpan>
                </TableCell>
                <TableCell align="right">
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                    <FlashSpan watch={`${p.final_price}|${u}`}>{fmtDollarsLineItem(pr)}</FlashSpan>
                  </Typography>
                </TableCell>
              </TableRow>
            )
          })()}
          {(() => {
            if (!p || finishMode !== 'Rolls') return null
            const n = Number(p.rolls || 0)
            if (!(n > 0)) return null
            const c = Number(p.total_cost) / n
            const pr = Number(p.final_price) / n
            if (!Number.isFinite(c) || !Number.isFinite(pr)) return null
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>per Roll</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }}>
                  <FlashSpan watch={`${p.total_cost}|${n}`}>{fmtDollarsLineItem(c)}</FlashSpan>
                </TableCell>
                <TableCell align="right">
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                    <FlashSpan watch={`${p.final_price}|${n}`}>{fmtDollarsLineItem(pr)}</FlashSpan>
                  </Typography>
                </TableCell>
              </TableRow>
            )
          })()}
          {(() => {
            if (!p || finishMode !== 'Cartons') return null
            const n = Number(p.cartons || 0)
            if (!(n > 0)) return null
            const c = Number(p.total_cost) / n
            const pr = Number(p.final_price) / n
            if (!Number.isFinite(c) || !Number.isFinite(pr)) return null
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>per Carton</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }}>
                  <FlashSpan watch={`${p.total_cost}|${n}`}>{fmtDollarsLineItem(c)}</FlashSpan>
                </TableCell>
                <TableCell align="right">
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                    <FlashSpan watch={`${p.final_price}|${n}`}>{fmtDollarsLineItem(pr)}</FlashSpan>
                  </Typography>
                </TableCell>
              </TableRow>
            )
          })()}
        </TableBody>
      </Table>
    </Paper>
  )
}

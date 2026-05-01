import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  SvgIcon,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EditIcon from '@mui/icons-material/Edit'
import {
  fmtCount,
  fmtDollarsLineItem,
  fmtDollarsPreview,
  fmtQtyNumber,
} from '../../../utils/quoteFormat'
import { roundToDecimalPlaces } from '../moqQuoteQuantity'

/** Live-quote unit-rate editor draft: 2 d.p., no grouping float tail (e.g. 120.08 not 120.08000000002). */
function formatTableUnitRateDraft(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const r = roundToDecimalPlaces(n, 2)
  if (!Number.isFinite(r) || r <= 0) return ''
  return r.toFixed(2)
}
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

/** Renders a band MOQ line with the part after the first `:` in bold. */
function MaterialsMoqLineText(props: { line: string }) {
  const { line } = props
  const t = line.trim()
  const i = t.indexOf(':')
  if (i === -1) {
    return <>{t}</>
  }
  const lead = t.slice(0, i + 1)
  const value = t.slice(i + 1).trim()
  if (!value) {
    return <>{t}</>
  }
  return (
    <>
      {lead}{' '}
      <Box component="strong" sx={{ fontWeight: 700 }}>
        {value}
      </Box>
    </>
  )
}

/** Compact duration for breakdown row labels, e.g. `6hr, 33m` (`totalMinutes` rounded). */
function fmtBreakdownDurationMinutes(totalMinutes: unknown): string | null {
  const n = Number(totalMinutes)
  if (!Number.isFinite(n) || n <= 0) return null
  const total = Math.max(0, Math.round(n))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}hr`
  return `${h}hr, ${m}m`
}

export function QuotePreviewPanel(props: {
  preview: any
  loading: boolean
  canCalculate: boolean
  missing: string[]
  finishMode: 'Rolls' | 'Cartons'
  productType: string
  /** Clears the optional Price per kg override (e.g. from the Adjustments row). */
  onClearPricePerKgOverride?: () => void
  /** Top-of-panel row for email: description, min order or job QTY, price; optional Total when job quantity is used. */
  emailQuoteTable: {
    description: string
    minOrder: string
    price: string
    priceHeader: string
    middleColumnHeader: 'Min QTY' | 'QTY'
    total: string | null
    /** Numeric unit rate backing `price` (e.g. $/ROLL); null when not priced. */
    unitRateNumber: number | null
  }
  /** One line for width-based materials MOQ (shown under the email table with yield), e.g. `Minimum order quantity (plain): 350.00kg`. */
  materialsMoqLine?: string | null
  /** Continuous web (e.g. Tube): totals row uses per m instead of per 1000. */
  isContinuousLength?: boolean
  /** Quote Qty Type basis (from parent): used to bold only the matching per‑unit row in the breakdown footer. */
  qtyMode: 'units' | 'kg' | 'roll' | 'ctn'
  /** With continuous length + units qty: yield uses kg/ea instead of kg per 1000 products. */
  yieldPerEa?: boolean
  /** When price override is active: locked rate with unit, e.g. `$8.01/kg` or `$120.08/ROLL` (matches quote price basis). */
  adjustmentsLockedRateLabel?: string | null
  /** When set, user can edit the table price cell; parent applies (e.g. $/kg override in KG mode, or implied $/kg from $/ROLL etc.). */
  onApplyTableUnitPrice?: (value: number) => void
}) {
  const {
    preview,
    loading,
    canCalculate,
    missing,
    finishMode,
    productType,
    onClearPricePerKgOverride,
    emailQuoteTable,
    materialsMoqLine = null,
    isContinuousLength = false,
    qtyMode,
    yieldPerEa = false,
    adjustmentsLockedRateLabel = null,
    onApplyTableUnitPrice,
  } = props
  const p = preview
  /** Breakdown footer: bold only rows that match the active quantity basis. */
  const breakdownBold = {
    perKg: qtyMode === 'kg',
    /** Continuous + units qty: Live Quote headline is $/ea. */
    perEa: qtyMode === 'units' && isContinuousLength,
    /** Discrete + units qty: Live Quote headline is $/1000 products. */
    per1000: qtyMode === 'units' && !isContinuousLength,
    perCarton: qtyMode === 'ctn',
    perRoll: qtyMode === 'roll',
  }
  const materialsMoqLineTrimmed =
    materialsMoqLine != null && String(materialsMoqLine).trim() ? String(materialsMoqLine).trim() : null
  const yieldEstimateNode =
    p != null
      ? (() => {
          const kgPerUnit =
            p.kg_per_unit != null
              ? Number(p.kg_per_unit)
              : Number(p.totals_units || 0) > 0 && p.totals_kg != null
                ? Number(p.totals_kg) / Number(p.totals_units || 1)
                : null
          if (yieldPerEa) {
            if (kgPerUnit == null || !Number.isFinite(kgPerUnit) || kgPerUnit <= 0) return null
            return (
              <Typography variant="body2">
                Yield estimate: {fmtQtyNumber(kgPerUnit, 2)}kg / ea
              </Typography>
            )
          }
          const kgPer1000 = kgPerUnit != null && Number.isFinite(kgPerUnit) ? kgPerUnit * 1000 : null
          if (kgPer1000 == null || !Number.isFinite(kgPer1000)) return null
          return (
            <Typography variant="body2">
              Yield estimate: {fmtQtyNumber(kgPer1000, 2)}kg / {fmtCount(1000)} products
            </Typography>
          )
        })()
      : null
  const showYieldAndMoqBlock = Boolean(yieldEstimateNode || materialsMoqLineTrimmed)
  const dash = '—'
  const [emailCopyDone, setEmailCopyDone] = useState(false)
  const [unitPriceEditing, setUnitPriceEditing] = useState(false)
  const [unitPriceDraft, setUnitPriceDraft] = useState('')
  const canEditTableUnitPrice =
    typeof onApplyTableUnitPrice === 'function' &&
    emailQuoteTable.unitRateNumber != null &&
    Number.isFinite(Number(emailQuoteTable.unitRateNumber)) &&
    Number(emailQuoteTable.unitRateNumber) > 0 &&
    emailQuoteTable.price !== '—'

  useEffect(() => {
    if (!canEditTableUnitPrice) setUnitPriceEditing(false)
  }, [canEditTableUnitPrice])

  const onCopyEmailQuote = useCallback(async () => {
    const { description, minOrder, price, priceHeader, middleColumnHeader, total } = emailQuoteTable
    const hasTotal = total != null && total !== ''
    const plain = hasTotal
      ? `Description\t${middleColumnHeader}\t${priceHeader}\tTotal\n${description}\t${minOrder}\t${price}\t${total}`
      : `Description\t${middleColumnHeader}\t${priceHeader}\n${description}\t${minOrder}\t${price}`
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    const html = hasTotal
      ? `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><thead><tr><th align="left">Description</th><th align="left">${esc(
          middleColumnHeader,
        )}</th><th align="left">${esc(priceHeader)}</th><th align="left">Total</th></tr></thead><tbody><tr><td>${esc(
          description,
        )}</td><td>${esc(minOrder)}</td><td>${esc(price)}</td><td>${esc(total)}</td></tr></tbody></table>`
      : `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><thead><tr><th align="left">Description</th><th align="left">${esc(
          middleColumnHeader,
        )}</th><th align="left">${esc(priceHeader)}</th></tr></thead><tbody><tr><td>${esc(description)}</td><td>${esc(
          minOrder,
        )}</td><td>${esc(price)}</td></tr></tbody></table>`
    try {
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(plain)
      }
      setEmailCopyDone(true)
      window.setTimeout(() => setEmailCopyDone(false), 2000)
    } catch {
      try {
        await navigator.clipboard.writeText(plain)
        setEmailCopyDone(true)
        window.setTimeout(() => setEmailCopyDone(false), 2000)
      } catch {
        // ignore
      }
    }
  }, [emailQuoteTable])
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Live Quote</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {loading ? (
            <Typography variant="caption" color="text.secondary">
              Calculating…
            </Typography>
          ) : !p ? (
            <Typography variant="caption" color="text.secondary">
              {canCalculate ? 'Ready' : 'Incomplete'}
            </Typography>
          ) : null}
          <Button
            variant="outlined"
            size="small"
            startIcon={<ContentCopyIcon fontSize="small" />}
            onClick={() => void onCopyEmailQuote()}
          >
            {emailCopyDone ? 'Copied' : 'Copy Quote Summary'}
          </Button>
        </Box>
      </Box>

      <TableContainer
        sx={{
          mt: 1.5,
          mb: 1.5,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          '& .MuiTableCell-head': { fontWeight: 600, bgcolor: 'action.hover' },
        }}
      >
        <Table
          size="small"
          sx={{
            '& .MuiTableCell-root': {
              verticalAlign: 'middle',
              py: '8px',
              pl: '8px',
              pr: '8px',
            },
            '& .MuiTableCell-root:first-of-type': {
              pl: '16px',
            },
            '& .MuiTableCell-root:last-of-type': {
              pr: '16px',
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Description</TableCell>
              <TableCell>{emailQuoteTable.middleColumnHeader}</TableCell>
              <TableCell>{emailQuoteTable.priceHeader}</TableCell>
              {emailQuoteTable.total != null && emailQuoteTable.total !== '' ? <TableCell>Total</TableCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ wordBreak: 'break-word', maxWidth: 320 }}>{emailQuoteTable.description}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{emailQuoteTable.minOrder}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {unitPriceEditing ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, maxWidth: 280 }}>
                    <TextField
                      size="small"
                      type="text"
                      inputMode="decimal"
                      value={unitPriceDraft}
                      onChange={(e) => setUnitPriceDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const n = Number(unitPriceDraft.trim().replace(/[$,]/g, ''))
                        if (!Number.isFinite(n) || n <= 0) return
                        const v = roundToDecimalPlaces(n, 2)
                        if (!Number.isFinite(v) || v <= 0) return
                        onApplyTableUnitPrice?.(v)
                        setUnitPriceEditing(false)
                      }}
                      onBlur={() => {
                        const t = unitPriceDraft.trim().replace(/[$,]/g, '')
                        if (t === '') return
                        const n = Number(t)
                        if (!Number.isFinite(n) || n <= 0) return
                        setUnitPriceDraft(formatTableUnitRateDraft(n))
                      }}
                      placeholder="0.00"
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                      }}
                      sx={{ width: 128 }}
                    />
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        const n = Number(unitPriceDraft.trim().replace(/[$,]/g, ''))
                        if (!Number.isFinite(n) || n <= 0) return
                        const v = roundToDecimalPlaces(n, 2)
                        if (!Number.isFinite(v) || v <= 0) return
                        onApplyTableUnitPrice?.(v)
                        setUnitPriceEditing(false)
                      }}
                    >
                      Apply
                    </Button>
                    <Button size="small" variant="text" onClick={() => setUnitPriceEditing(false)}>
                      Cancel
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <span>{emailQuoteTable.price}</span>
                    {canEditTableUnitPrice ? (
                      <IconButton
                        size="small"
                        aria-label={`Edit ${emailQuoteTable.priceHeader}`}
                        onClick={() => {
                          const u = emailQuoteTable.unitRateNumber
                          setUnitPriceDraft(u != null && Number.isFinite(u) && u > 0 ? formatTableUnitRateDraft(u) : '')
                          setUnitPriceEditing(true)
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Box>
                )}
              </TableCell>
              {emailQuoteTable.total != null && emailQuoteTable.total !== '' ? (
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{emailQuoteTable.total}</TableCell>
              ) : null}
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ mt: 2, mb: 1 }} />

      {!p && missing.length > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Missing: {missing.join(', ')}
        </Typography>
      ) : null}

      <Box>
        {showYieldAndMoqBlock ? (
          <Stack component="div" spacing={0.75} sx={{ mb: 0.5 }}>
            {yieldEstimateNode}
            {materialsMoqLineTrimmed ? (
              <Typography variant="body2" component="div" sx={{ lineHeight: 1.4 }}>
                <MaterialsMoqLineText line={materialsMoqLineTrimmed} />
              </Typography>
            ) : null}
          </Stack>
        ) : null}
        {p ? (
          <>
            {p.unit_price != null &&
            productType !== 'Bag' &&
            productType !== 'Centerfold' &&
            productType !== 'Sleeve' &&
            productType !== 'Tube' ? (
              <Typography variant="body2">
                Price per {productType}: {fmtDollarsLineItem(p.unit_price)}
              </Typography>
            ) : null}
          </>
        ) : !materialsMoqLineTrimmed ? (
          <Typography variant="body2" color="text.secondary">
            {canCalculate ? 'Ready to calculate.' : 'Add more details to see pricing.'}
          </Typography>
        ) : null}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Table
        size="small"
        sx={{
          '& .MuiTableCell-root': { py: '4px' },
        }}
      >
        <TableHead>
          <TableRow
            sx={{
              '& .MuiTableCell-root': {
                fontWeight: 700,
                borderBottom: '1px solid #000',
              },
            }}
          >
            <TableCell>Stage</TableCell>
            <TableCell align="right">Cost</TableCell>
            <TableCell align="right">Price</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>
              {(() => {
                const kg = p?.totals_kg != null && Number(p.totals_kg) > 0 ? Number(p.totals_kg) : null
                return kg != null ? `Material (${fmtQtyNumber(kg, 0)}kg)` : 'Material'
              })()}
            </TableCell>
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
            <TableCell sx={{ color: 'text.secondary' }}>Custom Blend</TableCell>
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
            <TableCell>
              {(() => {
                const extrusionMin =
                  p?.extrusion_hours != null && Number.isFinite(Number(p.extrusion_hours))
                    ? Number(p.extrusion_hours) * 60
                    : null
                const dur =
                  extrusionMin != null && extrusionMin > 0 ? fmtBreakdownDurationMinutes(extrusionMin) : null
                return dur ? `Extrusion (${dur})` : 'Extrusion'
              })()}
            </TableCell>
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
          {(p?.price_breakdown?.gusset_retail_price ?? 0) > 0 ? (
            <TableRow>
              <TableCell sx={{ pl: 2, color: 'text.secondary' }}>Gusset</TableCell>
              <TableCell align="right">{dash}</TableCell>
              <TableCell align="right">
                <FlashSpan watch={p.price_breakdown?.gusset_retail_price}>
                  {fmtDollarsLineItem(p.price_breakdown?.gusset_retail_price)}
                </FlashSpan>
              </TableCell>
            </TableRow>
          ) : null}
          {(p?.price_breakdown?.punched_retail_price ?? 0) > 0 ? (
            <TableRow>
              <TableCell sx={{ pl: 2, color: 'text.secondary' }}>Hole punched</TableCell>
              <TableCell align="right">{dash}</TableCell>
              <TableCell align="right">
                <FlashSpan watch={p.price_breakdown?.punched_retail_price}>
                  {fmtDollarsLineItem(p.price_breakdown?.punched_retail_price)}
                </FlashSpan>
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>
              {(() => {
                const m =
                  p != null && p.totals_m != null && Number.isFinite(Number(p.totals_m)) && Number(p.totals_m) > 0
                    ? Number(p.totals_m)
                    : null
                const n = p != null && p.num_colours != null ? Number(p.num_colours) : null
                const colsOk = n != null && Number.isFinite(n) && n > 0
                const parts: string[] = []
                if (m != null) parts.push(`${fmtQtyNumber(Math.round(m), 0)}m`)
                if (colsOk && n != null) parts.push(`${fmtCount(n)} Col`)
                return parts.length > 0 ? `Printing (${parts.join(' x ')})` : 'Printing'
              })()}
            </TableCell>
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
            <TableCell>
              {(() => {
                const dur =
                  p?.conversion_minutes_total != null && Number(p.conversion_minutes_total) > 0
                    ? fmtBreakdownDurationMinutes(Number(p.conversion_minutes_total))
                    : null
                return dur ? `Conversion (${dur})` : 'Conversion'
              })()}
            </TableCell>
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
              <TableCell>
                {(() => {
                  const m = p?.core_length_m != null && Number(p.core_length_m) > 0 ? Number(p.core_length_m) : null
                  return m != null ? `Core (${fmtQtyNumber(m, 1)}m)` : 'Core'
                })()}
              </TableCell>
              <TableCell align="right">
                {p ? <FlashSpan watch={p.cost_breakdown?.core_cost}>{fmtDollarsLineItem(p.cost_breakdown?.core_cost)}</FlashSpan> : dash}
              </TableCell>
              <TableCell align="right">
                {p ? <FlashSpan watch={p.price_breakdown?.core_price}>{fmtDollarsLineItem(p.price_breakdown?.core_price)}</FlashSpan> : dash}
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell>
              {p && p.waste_kg != null && Number(p.waste_kg) > 0
                ? `Waste (${fmtQtyNumber(Number(p.waste_kg), 0)}kg)`
                : 'Waste'}
            </TableCell>
            <TableCell align="right">
              {p ? <FlashSpan watch={p.cost_breakdown?.waste_cost}>{fmtDollarsLineItem(p.cost_breakdown?.waste_cost)}</FlashSpan> : dash}
            </TableCell>
            <TableCell align="right">
              {p ? <FlashSpan watch={p.price_breakdown?.waste_price}>{fmtDollarsLineItem(p.price_breakdown?.waste_price)}</FlashSpan> : dash}
            </TableCell>
          </TableRow>
          <TableRow
            sx={{
              '& .MuiTableCell-root': {
                borderBottom: '1px solid #000',
              },
            }}
          >
            <TableCell>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, verticalAlign: 'middle' }}>
                {p?.price_override_active && adjustmentsLockedRateLabel
                  ? `Adjustments (${adjustmentsLockedRateLabel})`
                  : 'Adjustments'}
                {p?.price_override_active && onClearPricePerKgOverride ? (
                  <IconButton
                    size="small"
                    aria-label="Clear locked price override"
                    onClick={onClearPricePerKgOverride}
                    sx={{ p: 0.25, ml: 0.25, color: 'error.main', '&:hover': { color: 'error.dark' } }}
                  >
                    <SvgIcon fontSize="small" viewBox="0 0 24 24" aria-hidden>
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </SvgIcon>
                  </IconButton>
                ) : null}
              </Box>
            </TableCell>
            <TableCell align="right" />
            <TableCell align="right">
              {p && p.price_override_active && p.adjustments_price != null ? (
                <FlashSpan watch={p.adjustments_price}>{fmtDollarsPreview(p.adjustments_price)}</FlashSpan>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>

          <TableRow
            sx={{
              '& .MuiTableCell-root': {
                borderBottom: '1px solid #000',
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
              },
            }}
          >
            <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
            <TableCell align="right" sx={{ fontWeight: 400 }}>
              {p ? <FlashSpan watch={p.total_cost}>{fmtDollarsLineItem(p.total_cost)}</FlashSpan> : dash}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              {p ? <FlashSpan watch={p.final_price}>{fmtDollarsLineItem(p.final_price)}</FlashSpan> : dash}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 400 }}>Margin (%)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 400 }} colSpan={2}>
              {p ? (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ fontWeight: 400, color: Number(p.margin) < 0 ? 'error.main' : 'inherit' }}
                >
                  <FlashSpan watch={p.margin}>{`${fmtQtyNumber(Number(p.margin || 0) * 100, 2)}%`}</FlashSpan>
                </Typography>
              ) : (
                dash
              )}
            </TableCell>
          </TableRow>
          {(() => {
            const priceKgOk =
              p &&
              Number(p.totals_kg || 0) > 0 &&
              p.price_per_kg != null &&
              Number.isFinite(Number(p.price_per_kg))
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: breakdownBold.perKg ? 600 : 400 }}>per Kg</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }} />
                <TableCell align="right">
                  {priceKgOk ? (
                    <Typography component="span" variant="body2" sx={{ fontWeight: breakdownBold.perKg ? 600 : 400 }}>
                      <FlashSpan watch={p.price_per_kg}>{fmtDollarsLineItem(Number(p.price_per_kg))}</FlashSpan>
                    </Typography>
                  ) : (
                    dash
                  )}
                </TableCell>
              </TableRow>
            )
          })()}
          {(() => {
            if (!p) {
              return (
                <>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 400 }}>per 1000m</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 400 }} />
                    <TableCell align="right">{dash}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 400 }}>{isContinuousLength ? 'per ea' : 'per 1000'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 400 }} />
                    <TableCell align="right">{dash}</TableCell>
                  </TableRow>
                </>
              )
            }
            const m = Number(p.totals_m || 0)
            const okM = m > 0 && Number.isFinite(m)
            const per1000mBlock = okM ? m / 1000 : 0
            const pr1000m = okM && per1000mBlock > 0 ? Number(p.final_price) / per1000mBlock : null
            const showPrice1000m = pr1000m != null && Number.isFinite(pr1000m)

            const u = Number(p.totals_units || 0)
            const okU = u > 0
            const prEaOr1000 =
              okU && isContinuousLength
                ? Number(p.final_price) / u
                : okU
                  ? Number(p.final_price) / (u / 1000)
                  : null
            const showPriceEaOr1000 = prEaOr1000 != null && Number.isFinite(prEaOr1000)
            const countLabel = isContinuousLength ? 'per ea' : 'per 1000'
            const boldCountRow = isContinuousLength ? breakdownBold.perEa : breakdownBold.per1000

            return (
              <>
                <TableRow>
                  <TableCell sx={{ fontWeight: 400 }}>per 1000m</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 400 }} />
                  <TableCell align="right">
                    {showPrice1000m ? (
                      <Typography component="span" variant="body2" sx={{ fontWeight: 400 }}>
                        <FlashSpan watch={`${p.final_price}|${m}`}>{fmtDollarsLineItem(pr1000m)}</FlashSpan>
                      </Typography>
                    ) : (
                      dash
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: boldCountRow ? 600 : 400 }}>{countLabel}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 400 }} />
                  <TableCell align="right">
                    {showPriceEaOr1000 ? (
                      <Typography component="span" variant="body2" sx={{ fontWeight: boldCountRow ? 600 : 400 }}>
                        <FlashSpan watch={`${p.final_price}|${u}|${countLabel}`}>{fmtDollarsLineItem(prEaOr1000)}</FlashSpan>
                      </Typography>
                    ) : (
                      dash
                    )}
                  </TableCell>
                </TableRow>
              </>
            )
          })()}
          {(() => {
            if (!p) {
              return (
                <TableRow>
                  <TableCell sx={{ fontWeight: 400 }}>{finishMode === 'Cartons' ? 'per Carton' : 'per Roll'}</TableCell>
                  <TableCell align="right" />
                  <TableCell align="right">{dash}</TableCell>
                </TableRow>
              )
            }
            if (finishMode === 'Cartons') {
              const n = Number(p.cartons || 0)
              const pr = n > 0 ? Number(p.final_price) / n : null
              const showPrice = pr != null && Number.isFinite(pr) && n > 0
              const prN = showPrice ? pr : null
              return (
                <TableRow>
                  <TableCell sx={{ fontWeight: breakdownBold.perCarton ? 600 : 400 }}>per Carton</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 400 }} />
                  <TableCell align="right">
                    {prN != null ? (
                      <Typography component="span" variant="body2" sx={{ fontWeight: breakdownBold.perCarton ? 600 : 400 }}>
                        <FlashSpan watch={`${p.final_price}|${n}`}>{fmtDollarsLineItem(prN)}</FlashSpan>
                      </Typography>
                    ) : (
                      dash
                    )}
                  </TableCell>
                </TableRow>
              )
            }
            const n = Number(p.rolls || 0)
            const pr = n > 0 ? Number(p.final_price) / n : null
            const showPrice = pr != null && Number.isFinite(pr) && n > 0
            const prN = showPrice ? pr : null
            return (
              <TableRow>
                <TableCell sx={{ fontWeight: breakdownBold.perRoll ? 600 : 400 }}>per Roll</TableCell>
                <TableCell align="right" sx={{ fontWeight: 400 }} />
                <TableCell align="right">
                  {prN != null ? (
                    <Typography component="span" variant="body2" sx={{ fontWeight: breakdownBold.perRoll ? 600 : 400 }}>
                      <FlashSpan watch={`${p.final_price}|${n}`}>{fmtDollarsLineItem(prN)}</FlashSpan>
                    </Typography>
                  ) : (
                    dash
                  )}
                </TableCell>
              </TableRow>
            )
          })()}
        </TableBody>
      </Table>
    </Paper>
  )
}

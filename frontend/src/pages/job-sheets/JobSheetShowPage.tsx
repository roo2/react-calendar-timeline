import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'
import { fetchQuoteRatebook } from '../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals } from '../../utils/quoteCalculator'
import { fmtCount, fmtQtyNumber } from '../../utils/quoteFormat'
import { buildQuickQuoteInputsFromSpec } from '../../utils/specToQuoteInputs'
import { formatDateDMYShort } from '../../utils/dateFormat'
import {
  coerceQtyTypeForFinishMode,
  qtyTypeFromPersisted,
  type FinishMode,
  type QtyType,
} from '../../utils/quantityRollFields'
import { makeDefaultSpec, type SpecPayload } from '../../components/SpecPayloadForm'
import { Alert, Box, Button, Link as MuiLink, Paper, Stack, Typography } from '@mui/material'
import { ProductVersionSummary } from '../../components/ProductVersionSummary'

type JobSheetDetail = {
  job_sheet: {
    id: string
    job_no: string
    customer_name?: string | null
    order_id?: string | null
    product_code: string
    product_description?: string | null
    due_date?: string | null
    quantity_value: number
    quantity_unit: string
    qty_type?: string
    num_product_units?: number | null
    weight_per_roll_kg?: number | null
    num_rolls?: number
    version_number: number
    product_id: string
    product_version_id: string
    invoice_no?: string | null
    order_date?: string | null
  }
  spec_payload: any
}

function fmtQty(v: number, u: string) {
  const unit =
    u === 'kg' ? 'kg' : u === 'rolls' ? 'rolls' : u === 'bags' ? 'bags' : u === 'meters' ? 'm' : u
  return `${v} ${unit}`
}

function qtyTypeLabel(u: string) {
  if (u === 'kg') return 'Total KGs'
  if (u === 'rolls') return 'No. of Rolls'
  if (u === 'bags') return 'No. of Bags'
  if (u === 'meters') return 'Total Meters'
  return u
}

function ensureSpec(s: any): SpecPayload {
  const d = makeDefaultSpec()
  const src = s && typeof s === 'object' ? s : {}
  return {
    ...d,
    ...src,
    identity: { ...d.identity, ...(src.identity || {}) },
    dimensions: { ...d.dimensions, ...(src.dimensions || {}) },
    formulation: { ...d.formulation, ...(src.formulation || {}) },
    printing: { ...d.printing, ...(src.printing || {}) },
    quality_expectations: { ...d.quality_expectations, ...(src.quality_expectations || {}) },
    run_requirements: { ...d.run_requirements, ...(src.run_requirements || {}) },
    packaging: { ...d.packaging, ...(src.packaging || {}) },
    tool_requirements: Array.isArray(src.tool_requirements) ? src.tool_requirements : d.tool_requirements,
  }
}

function inferQtyTypeFromUnit(u: string | undefined): QtyType {
  const x = (u || '').toLowerCase()
  if (x === 'rolls') return 'total_rolls'
  if (x === 'kg') return 'kg'
  return 'units'
}

function FieldBlock(props: { label: string; children: ReactNode; secondary?: ReactNode }) {
  const { label, children, secondary } = props
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ wordBreak: 'break-word' }}>
        {children}
      </Typography>
      {secondary ? (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {secondary}
        </Typography>
      ) : null}
    </Box>
  )
}

export function JobSheetShowPage() {
  const { jobSheetId } = useParams()
  const loc = useLocation()
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`
  const dispatch = useAppDispatch()
  const entry = useAppSelector((s) => (jobSheetId ? s.jobSheets.detail.byId[jobSheetId] : undefined))
  const data = entry?.data as JobSheetDetail | null
  const err = entry?.error
  const ratebook = useAppSelector((s) => s.quotes.quoteRatebook.data)

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [jobSheetId, dispatch])

  useEffect(() => {
    void dispatch(fetchQuoteRatebook())
  }, [dispatch])

  const derivedTotalsRow = useMemo(() => {
    const pending = {
      loading: true,
      kgDisplay: null as string | null,
      unitsLabel: 'Total units',
      unitsDisplay: null as string | null,
      metersDisplay: null as string | null,
    }
    if (!data || !ratebook) return pending
    try {
      const spec = ensureSpec(data.spec_payload)
      const js = data.job_sheet
      const fm: FinishMode = spec.identity?.finish_mode === 'Cartons' ? 'Cartons' : 'Rolls'
      const rawQt =
        js.qty_type != null && String(js.qty_type).trim()
          ? qtyTypeFromPersisted(String(js.qty_type))
          : inferQtyTypeFromUnit(js.quantity_unit)
      const pt = String(spec.identity?.product_type || 'Bag')
      const lenRaw = String(spec.dimensions?.length_units || '')
      const continuousLength =
        pt === 'Tube' || lenRaw === 'Continuous' || lenRaw.toLowerCase() === 'continuous'
      const effectiveQtyType = coerceQtyTypeForFinishMode(fm, rawQt, continuousLength)
      const qv = Number(js.quantity_value || 0)
      const numRollsNum = Math.max(1, Math.round(Number(js.num_rolls ?? 1)))
      const weightPerRollNum = Number(js.weight_per_roll_kg ?? 0)
      const numUnitsNum =
        effectiveQtyType === 'units'
          ? Math.max(0, Math.round(Number(js.num_product_units ?? qv)))
          : Math.max(0, Math.round(Number(js.num_product_units ?? 0)))
      let totalKgForCalc = 0
      if (effectiveQtyType === 'kg') {
        totalKgForCalc = qv
      } else if (effectiveQtyType === 'total_rolls' && numRollsNum > 0 && weightPerRollNum > 0) {
        totalKgForCalc = numRollsNum * weightPerRollNum
      }
      const productType = String(spec.identity?.product_type || 'Bag')
      const d = computeDerivedGeometryAndTotals(
        buildQuickQuoteInputsFromSpec(
          spec,
          {
            qtyType: effectiveQtyType,
            totalKg: totalKgForCalc,
            numUnits: numUnitsNum,
            numRolls: numRollsNum,
            weightPerRoll: weightPerRollNum,
          },
          { ratebook },
        ),
        ratebook,
      )
      const billedKg = Number(d?.billedTotalsKg ?? 0)
      const kgDisplay =
        Number.isFinite(billedKg) && billedKg > 0
          ? `${fmtQtyNumber(billedKg, 2)} kg`
          : totalKgForCalc > 0
            ? `${fmtQtyNumber(totalKgForCalc, 2)} kg`
            : null

      const unitsFromCalc = d?.units
      const unitsCount =
        unitsFromCalc != null && Number.isFinite(Number(unitsFromCalc)) && Number(unitsFromCalc) > 0
          ? Math.round(Number(unitsFromCalc))
          : effectiveQtyType === 'units' && numUnitsNum > 0
            ? numUnitsNum
            : null
      const unitsLabel = productType === 'Bag' ? 'Total bags' : 'Total units'
      const unitsSuffix = productType === 'Bag' ? 'bags' : 'units'
      const unitsDisplay =
        unitsCount != null && unitsCount > 0 ? `${fmtCount(unitsCount)} ${unitsSuffix}` : null

      const m = d?.derivedTotalM
      const metersDisplay =
        m != null && Number.isFinite(Number(m)) && Number(m) > 0
          ? `${Math.round(Number(m)).toLocaleString()} m`
          : null

      return {
        loading: false,
        kgDisplay,
        unitsLabel,
        unitsDisplay,
        metersDisplay,
      }
    } catch {
      return {
        loading: false,
        kgDisplay: null,
        unitsLabel: 'Total units',
        unitsDisplay: null,
        metersDisplay: null,
      }
    }
  }, [data, ratebook])

  if (err && !data && entry?.status === 'failed') {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Job Sheet</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to="/job-sheets" variant="text" color="primary">
          Back
        </Button>
      </Stack>
    )
  }
  if (!data) return <p>Loading…</p>

  const js = data.job_sheet
  const hasJobNo = Boolean((js.job_no || '').trim())

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
            <Typography variant="h6" component="span">
              Job Sheet
            </Typography>
            {hasJobNo ? (
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary" component="span">
                  Job code
                </Typography>
                <Typography component="span" variant="subtitle1" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                  {js.job_no}
                </Typography>
              </Box>
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {js.order_id ? (
              <Button variant="text" color="primary" component={Link} to={`/orders/${encodeURIComponent(js.order_id)}`}>
                View Order
              </Button>
            ) : null}
            <Button component={Link} to="/job-sheets" variant="text" color="primary">
              Back to Job Sheets
            </Button>
            <Button
              component={Link}
              to={`/job-sheets/${encodeURIComponent(js.id)}/edit?returnTo=${encodeURIComponent(returnTo)}`}
              variant="outlined"
            >
              Edit Job Sheet
            </Button>
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
          <FieldBlock label="Customer">{js.customer_name?.trim() ? js.customer_name : '—'}</FieldBlock>
          <FieldBlock label="Invoice No">{js.invoice_no?.trim() ? js.invoice_no : '—'}</FieldBlock>
          <FieldBlock label="Order Date">
            {formatDateDMYShort(js.order_date, '—')}
          </FieldBlock>
          <FieldBlock label="Due Date">{js.due_date?.trim() ? js.due_date : '—'}</FieldBlock>
        </Box>

        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          <FieldBlock label="Quantity Type">{js.quantity_unit?.trim() ? js.quantity_unit : '—'}</FieldBlock>
          <FieldBlock label={qtyTypeLabel(js.quantity_unit)}>
            {fmtQty(Number(js.quantity_value || 0), js.quantity_unit)}
          </FieldBlock>
        </Box>

        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <FieldBlock label="Total KG">
            {derivedTotalsRow.loading ? '…' : derivedTotalsRow.kgDisplay ?? '—'}
          </FieldBlock>
          <FieldBlock label={derivedTotalsRow.unitsLabel}>
            {derivedTotalsRow.loading ? '…' : derivedTotalsRow.unitsDisplay ?? '—'}
          </FieldBlock>
          <FieldBlock label="Total meters">
            {derivedTotalsRow.loading ? '…' : derivedTotalsRow.metersDisplay ?? '—'}
          </FieldBlock>
        </Box>

        <Box sx={{ mt: 2 }}>
          <FieldBlock label="Product" secondary={`Version: ${js.version_number}`}>
            {`${js.product_code}${js.product_description ? ` — ${js.product_description}` : ''}`}
          </FieldBlock>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'baseline', mb: 1 }}>
          <Typography variant="h6">Product Spec</Typography>
          {js.product_id ? (
            <MuiLink
              component={Link}
              to={`/products/${encodeURIComponent(js.product_id)}`}
              target="_blank"
              rel="noreferrer"
              underline="hover"
              sx={{ fontSize: '0.875rem' }}
            >
              View previous versions
            </MuiLink>
          ) : null}
        </Box>
        <ProductVersionSummary spec={data.spec_payload} />
      </Paper>
    </Stack>
  )
}

import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Box, Link as MuiLink, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { FinishMode, QtyType } from '../../../utils/quantityRollFields'

export type JobSheetCustomerOption = { id: string; name: string; code?: string | null }

export type JobSheetQuantityFieldsProps = {
  productUnitLabel: string
  /** When Bag, qty menu uses "Bags (total units)" / "Rolls x bags per roll". */
  productTypeIsBag: boolean
  /** Hide "Rolls × … per roll" when length is continuous (no fixed units per roll). */
  showRollsUnitsQtyType?: boolean
  finishMode: FinishMode
  effectiveQtyType: QtyType
  onQtyTypeChange: (t: QtyType) => void
  totalMetersReadonly: string
  totalKgField: {
    value: string
    onChange?: (value: string) => void
    disabled: boolean
    required: boolean
  }
  /** Rolls: units per roll (rolls_units) or derived average; Cartons: bags per carton. */
  rollOrCartonSizingField: {
    rollsLabel: string
    rollsValue: string
    rollsOnChange?: (value: string) => void
    rollsDisabled: boolean
    rollsInputStep: number | 'any'
    cartonsLabel: string
    cartonsValue: string
    cartonsOnChange: (value: string) => void
  }
  weightPerRollField: {
    value: string
    onChange?: (value: string) => void
    disabled: boolean
    helperText?: string
  }
  numRollsField: {
    value: string
    onChange?: (value: string) => void
    disabled: boolean
    required: boolean
  }
  totalProductsField: {
    value: string
    onChange?: (value: string) => void
    disabled: boolean
  }
}

/** Quantity inputs only (no outer Paper). Layout matches Quotes page Quantity block. */
export function JobSheetQuantityFields(props: JobSheetQuantityFieldsProps) {
  const {
    productUnitLabel,
    productTypeIsBag,
    showRollsUnitsQtyType = true,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange,
    totalMetersReadonly,
    totalKgField,
    rollOrCartonSizingField,
    weightPerRollField,
    numRollsField,
    totalProductsField,
  } = props

  const unitsMenuLabel = productTypeIsBag ? 'Bags (total units)' : `${productUnitLabel} (total units)`
  const rollsPerRollMenuLabel = productTypeIsBag
    ? 'Rolls x bags per roll'
    : `Rolls x ${productUnitLabel.toLowerCase()} per roll`

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <TextField select label="Qty Type" value={effectiveQtyType} onChange={(e) => onQtyTypeChange(e.target.value as QtyType)}>
          <MenuItem value="units">{unitsMenuLabel}</MenuItem>
          <MenuItem value="kg">Total KG</MenuItem>
          {finishMode === 'Rolls' && showRollsUnitsQtyType ? <MenuItem value="rolls_units">{rollsPerRollMenuLabel}</MenuItem> : null}
          {finishMode === 'Rolls' ? <MenuItem value="total_rolls">Rolls x KG per roll</MenuItem> : null}
        </TextField>
        <TextField label="Total Meters" value={totalMetersReadonly} disabled />
      </Box>
      <Box
        sx={{
          mt: 2,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 2,
        }}
      >
        <TextField
          label="Total KG"
          type="number"
          inputProps={{ min: 0, step: 0.1 }}
          value={totalKgField.value}
          onChange={totalKgField.onChange ? (e) => totalKgField.onChange!(e.target.value) : undefined}
          disabled={totalKgField.disabled}
          required={totalKgField.required}
        />
        {finishMode === 'Rolls' ? (
          <TextField
            label={rollOrCartonSizingField.rollsLabel}
            type="number"
            inputProps={{ min: 0, step: rollOrCartonSizingField.rollsInputStep }}
            value={rollOrCartonSizingField.rollsValue}
            onChange={
              rollOrCartonSizingField.rollsOnChange ? (e) => rollOrCartonSizingField.rollsOnChange!(e.target.value) : undefined
            }
            disabled={rollOrCartonSizingField.rollsDisabled}
          />
        ) : (
          <TextField
            label={rollOrCartonSizingField.cartonsLabel}
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={rollOrCartonSizingField.cartonsValue}
            onChange={(e) => rollOrCartonSizingField.cartonsOnChange(e.target.value)}
          />
        )}
        <TextField
          label="Weight per Roll (kg)"
          type="number"
          inputProps={{ min: 0, step: 'any' }}
          value={weightPerRollField.value}
          onChange={weightPerRollField.onChange ? (e) => weightPerRollField.onChange!(e.target.value) : undefined}
          disabled={weightPerRollField.disabled}
          helperText={weightPerRollField.helperText}
        />
        <TextField
          label={finishMode === 'Cartons' ? 'No. of Cartons' : 'No. of Rolls'}
          type="number"
          inputProps={{ min: 0, step: 1 }}
          value={numRollsField.value}
          onChange={numRollsField.onChange ? (e) => numRollsField.onChange!(e.target.value) : undefined}
          disabled={numRollsField.disabled}
          required={numRollsField.required}
        />
        <TextField
          label="Total products"
          type="number"
          inputProps={{ min: 0, step: 1 }}
          sx={{ gridColumn: '1 / -1' }}
          value={totalProductsField.value}
          onChange={totalProductsField.onChange ? (e) => totalProductsField.onChange!(e.target.value) : undefined}
          disabled={totalProductsField.disabled}
        />
      </Box>
    </>
  )
}

/** Standalone quantity section (e.g. after Dimensions in SpecPayloadForm). */
export function JobSheetQuantityPaper(
  props: JobSheetQuantityFieldsProps & {
    /** When set (e.g. job sheet on an order line), show a link next to the section title. */
    orderViewHref?: string | null
  },
) {
  const { orderViewHref, ...quantityProps } = props
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          mb: 2,
        }}
      >
        <Typography variant="h6">Quantity</Typography>
        {orderViewHref ? (
          <MuiLink component={Link} to={orderViewHref} underline="hover" variant="body2" sx={{ flexShrink: 0 }}>
            View order
          </MuiLink>
        ) : null}
      </Box>
      <Stack spacing={0}>
        <JobSheetQuantityFields {...quantityProps} />
      </Stack>
    </Paper>
  )
}

/** Show Production started/finished when status is running or a terminal/hand-off state. */
export const PRODUCTION_STATUSES_WITH_DATETIME_FIELDS = ['running', 'dispatched', 'cancelled'] as const

export function productionStatusShowsDatetimeFields(status: string | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase()
  return (PRODUCTION_STATUSES_WITH_DATETIME_FIELDS as readonly string[]).includes(s)
}

export type JobSheetIdentityQuantitySectionProps = JobSheetQuantityFieldsProps & {
  /** MUI `sx` for the outer Paper */
  paperSx?: object
  /** Main heading (default: Job Sheet) */
  title?: string
  jobCode?: string | null
  /** Read-only invoice line (matches printed header). */
  invoiceNo?: string
  /** Read-only customer purchase order line (matches printed header). */
  purchaseOrderNo?: string
  headerActions?: ReactNode
  customers: JobSheetCustomerOption[]
  customersStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
  customerId: string
  onCustomerIdChange: (customerId: string) => void
  customerSelectDisabled: boolean
  orderDate: string
  onOrderDateChange: (isoDate: string) => void
  /** When true, order date follows the parent order and cannot be edited (e.g. new job sheet on order page). */
  orderDateDisabled?: boolean
  dueDate: string
  onDueDateChange: (isoDate: string) => void
  orderDateInputRef: RefObject<HTMLInputElement | null>
  dueDateInputRef: RefObject<HTMLInputElement | null>
  /** When false, quantity fields are omitted here — render {@link JobSheetQuantityPaper} elsewhere (e.g. `afterDimensionsSlot` on SpecPayloadForm). */
  includeQuantity?: boolean
  /** Optional read-only product row (full job sheet edit) */
  productRow?: ReactNode
  /** Full job sheet edit: linked production Job status */
  productionStatus?: string
  onProductionStatusChange?: (value: string) => void
  /** `datetime-local` value (local) or '' */
  productionStartedLocal?: string
  onProductionStartedLocalChange?: (value: string) => void
  productionFinishedLocal?: string
  onProductionFinishedLocalChange?: (value: string) => void
}

/**
 * Customer, dates, and quantity block shared by the full job sheet editor and the order-line product modal.
 */
export function JobSheetIdentityQuantitySection(props: JobSheetIdentityQuantitySectionProps) {
  const {
    paperSx,
    title = 'Job Sheet',
    jobCode,
    invoiceNo = '',
    purchaseOrderNo = '',
    headerActions,
    customers,
    customersStatus,
    customerId,
    onCustomerIdChange,
    customerSelectDisabled,
    orderDate,
    onOrderDateChange,
    orderDateDisabled = false,
    dueDate,
    onDueDateChange,
    orderDateInputRef,
    dueDateInputRef,
    productUnitLabel,
    productTypeIsBag,
    showRollsUnitsQtyType,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange,
    totalMetersReadonly,
    totalKgField,
    rollOrCartonSizingField,
    weightPerRollField,
    numRollsField,
    totalProductsField,
    includeQuantity = true,
    productRow,
    productionStatus,
    onProductionStatusChange,
    productionStartedLocal,
    onProductionStartedLocalChange,
    productionFinishedLocal,
    onProductionFinishedLocalChange,
  } = props

  const showProdDatetimeFields =
    Boolean(onProductionStartedLocalChange && onProductionFinishedLocalChange) &&
    productionStatusShowsDatetimeFields(productionStatus)

  const quantityProps: JobSheetQuantityFieldsProps = {
    productUnitLabel,
    productTypeIsBag,
    showRollsUnitsQtyType,
    finishMode,
    effectiveQtyType,
    onQtyTypeChange,
    totalMetersReadonly,
    totalKgField,
    rollOrCartonSizingField,
    weightPerRollField,
    numRollsField,
    totalProductsField,
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, ...paperSx }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="span">
          {title}
        </Typography>
        {headerActions ? (
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>{headerActions}</Box>
        ) : null}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        <TextField
          select
          label="Customer"
          value={customerId}
          onChange={(e) => onCustomerIdChange(e.target.value)}
          required
          disabled={customerSelectDisabled || customersStatus === 'loading' || customersStatus === 'idle'}
        >
          <MenuItem value="" disabled>
            Select…
          </MenuItem>
          {customers.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name} {c.code ? `(${String(c.code).toUpperCase()})` : ''}
            </MenuItem>
          ))}
        </TextField>

        <TextField label="Invoice no." value={String(invoiceNo ?? '')} InputProps={{ readOnly: true }} />

        <TextField label="Job code" value={jobCode ? String(jobCode) : ''} InputProps={{ readOnly: true }} />

        <TextField
          label="Order Date"
          type="date"
          value={orderDate}
          onChange={(e) => onOrderDateChange(e.target.value)}
          onClick={() => {
            if (orderDateDisabled) return
            const el = orderDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          onFocus={() => {
            if (orderDateDisabled) return
            const el = orderDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          inputRef={orderDateInputRef}
          InputLabelProps={{ shrink: true }}
          disabled={orderDateDisabled}
        />

        <TextField
          label="Due Date"
          type="date"
          value={dueDate}
          onChange={(e) => onDueDateChange(e.target.value)}
          onClick={() => {
            const el = dueDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          onFocus={() => {
            const el = dueDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          inputRef={dueDateInputRef}
          InputLabelProps={{ shrink: true }}
        />

        <TextField label="Purchase order" value={String(purchaseOrderNo ?? '')} InputProps={{ readOnly: true }} />
      </Box>

      {onProductionStatusChange ? (
        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: showProdDatetimeFields ? 'repeat(2, minmax(0, 1fr))' : '1fr',
              md: showProdDatetimeFields ? 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
            },
            gap: 2,
            alignItems: 'flex-start',
            columnGap: 2,
          }}
        >
          <TextField
            select
            label="Production status"
            value={productionStatus ?? ''}
            onChange={(e) => onProductionStatusChange(e.target.value)}
            fullWidth
            sx={{
              gridColumn: {
                xs: 'span 1',
                sm: showProdDatetimeFields ? 'span 2' : 'span 1',
                md: showProdDatetimeFields ? 'span 1' : '1 / -1',
              },
            }}
          >
            <MenuItem value="planned">Backlog</MenuItem>
            <MenuItem value="scheduled">Scheduled</MenuItem>
            <MenuItem value="running">Running</MenuItem>
            <MenuItem value="dispatched">Dispatched</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
          </TextField>
          {showProdDatetimeFields && onProductionStartedLocalChange && onProductionFinishedLocalChange ? (
            <>
              <TextField
                label="Production started"
                type="datetime-local"
                value={productionStartedLocal ?? ''}
                onChange={(e) => onProductionStartedLocalChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 60 }}
                fullWidth
              />
              <TextField
                label="Production finished"
                type="datetime-local"
                value={productionFinishedLocal ?? ''}
                onChange={(e) => onProductionFinishedLocalChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 60 }}
                fullWidth
              />
            </>
          ) : null}
        </Box>
      ) : null}

      {includeQuantity ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Quantity
          </Typography>
          <JobSheetQuantityFields {...quantityProps} />
        </Box>
      ) : null}

      {productRow ? <Box sx={{ mt: 2 }}>{productRow}</Box> : null}
    </Paper>
  )
}

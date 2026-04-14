import type { ReactNode, RefObject } from 'react'
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { FinishMode, QtyType } from '../../../utils/quantityRollFields'

export type JobSheetCustomerOption = { id: string; name: string; code?: string | null }

export type JobSheetQuantityFieldsProps = {
  productUnitLabel: string
  /** When Bag, qty menu uses "Bags (total units)" / "Rolls x bags per roll". */
  productTypeIsBag: boolean
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
          {finishMode === 'Rolls' ? <MenuItem value="rolls_units">{rollsPerRollMenuLabel}</MenuItem> : null}
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
          label="No. of Rolls"
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
export function JobSheetQuantityPaper(props: JobSheetQuantityFieldsProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Quantity
      </Typography>
      <Stack spacing={0}>
        <JobSheetQuantityFields {...props} />
      </Stack>
    </Paper>
  )
}

export type JobSheetIdentityQuantitySectionProps = JobSheetQuantityFieldsProps & {
  /** MUI `sx` for the outer Paper */
  paperSx?: object
  /** Main heading (default: Job Sheet) */
  title?: string
  jobCode?: string | null
  headerActions?: ReactNode
  customers: JobSheetCustomerOption[]
  customersStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
  customerId: string
  onCustomerIdChange: (customerId: string) => void
  customerSelectDisabled: boolean
  orderDate: string
  onOrderDateChange: (isoDate: string) => void
  dueDate: string
  onDueDateChange: (isoDate: string) => void
  orderDateInputRef: RefObject<HTMLInputElement | null>
  dueDateInputRef: RefObject<HTMLInputElement | null>
  /** When false, quantity fields are omitted here — render {@link JobSheetQuantityPaper} elsewhere (e.g. `afterDimensionsSlot` on SpecPayloadForm). */
  includeQuantity?: boolean
  /** Optional read-only product row (full job sheet edit) */
  productRow?: ReactNode
}

/**
 * Customer, dates, and quantity block shared by the full job sheet editor and the order-line product modal.
 */
export function JobSheetIdentityQuantitySection(props: JobSheetIdentityQuantitySectionProps) {
  const {
    paperSx,
    title = 'Job Sheet',
    jobCode,
    headerActions,
    customers,
    customersStatus,
    customerId,
    onCustomerIdChange,
    customerSelectDisabled,
    orderDate,
    onOrderDateChange,
    dueDate,
    onDueDateChange,
    orderDateInputRef,
    dueDateInputRef,
    productUnitLabel,
    productTypeIsBag,
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
  } = props

  const quantityProps: JobSheetQuantityFieldsProps = {
    productUnitLabel,
    productTypeIsBag,
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
          <Typography variant="h6" component="span">
            {title}
          </Typography>
          {jobCode ? (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" component="span">
                Job code
              </Typography>
              <Typography component="span" variant="subtitle1" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                {jobCode}
              </Typography>
            </Box>
          ) : null}
        </Box>
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

        <TextField
          label="Order Date"
          type="date"
          value={orderDate}
          onChange={(e) => onOrderDateChange(e.target.value)}
          onClick={() => {
            const el = orderDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          onFocus={() => {
            const el = orderDateInputRef.current as HTMLInputElement & { showPicker?: () => void }
            if (el && typeof el.showPicker === 'function') el.showPicker()
          }}
          inputRef={orderDateInputRef}
          InputLabelProps={{ shrink: true }}
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
          required
        />
      </Box>

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

import { TextField } from '@mui/material'
import type { FinishMode } from '../../utils/quantityRollFields'
import { formatQtyToStockForInput, parseQtyToStockInput } from '../../utils/jobSheetQtyToStock'

export function QtyToStockField(props: {
  finishMode: FinishMode
  value: number | null
  onChange: (value: number | null) => void
  overTotal?: boolean
  disabled?: boolean
}) {
  const { finishMode, value, onChange, overTotal = false, disabled = false } = props
  const label = finishMode === 'Cartons' ? 'Cartons to Stock' : 'Rolls to Stock'

  return (
    <TextField
      label={label}
      type="number"
      inputProps={{ min: 0, step: 1 }}
      value={formatQtyToStockForInput(value)}
      onChange={(e) => onChange(parseQtyToStockInput(e.target.value))}
      error={overTotal}
      disabled={disabled}
      fullWidth
      helperText="Quantity held in stock (not shipped to the customer)."
    />
  )
}

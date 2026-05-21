import { Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material'
import type { SpecPayload } from '../SpecPayloadForm'
import {
  DEFAULT_OVERPRODUCTION_HANDLING,
  normalizeCustomerOverproductionHandling,
  overproductionOptionLabel,
  overproductionOptionsForFinishMode,
  type CustomerOverproductionHandling,
} from '../../utils/customerOverproductionHandling'
import { getSpecOrderDefaults, mergeOrderDefaultsIntoSpec } from '../../utils/specOrderDefaults'
import type { FinishMode } from '../../utils/quantityRollFields'

export function CustomerOverproductionHandlingField(props: {
  spec: SpecPayload
  finishMode: FinishMode
  productType: string | undefined | null
  onSpecChange: (next: SpecPayload) => void
}) {
  const { spec, finishMode, productType, onSpecChange } = props
  const stored = getSpecOrderDefaults(spec).customer_overproduction_handling
  const value = normalizeCustomerOverproductionHandling(stored, finishMode)
  const options = overproductionOptionsForFinishMode(finishMode)

  const setValue = (next: CustomerOverproductionHandling) => {
    onSpecChange(mergeOrderDefaultsIntoSpec(spec, { customer_overproduction_handling: next }))
  }

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <FormControl component="fieldset" fullWidth>
        <FormLabel component="legend">
          <Typography variant="subtitle2" component="span">
            Customer handles overproduction
          </Typography>
        </FormLabel>
        <RadioGroup
          value={value}
          onChange={(_e, v) => {
            const next = normalizeCustomerOverproductionHandling(v, finishMode)
            setValue(next)
          }}
        >
          {options.map((opt) => (
            <FormControlLabel
              key={opt}
              value={opt}
              control={<Radio />}
              label={
                <>
                  {overproductionOptionLabel(opt, productType)}
                  {opt === DEFAULT_OVERPRODUCTION_HANDLING ? (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                      (default)
                    </Typography>
                  ) : null}
                </>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>
    </Box>
  )
}

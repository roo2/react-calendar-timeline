import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import type { SpecPayload } from '../SpecPayloadForm'
import type { QuoteRatebook } from '../../utils/quoteCalculator'
import {
  extruderDisableReasonForSpec,
  extruderRowDisableReason,
  type ExtruderDisableReason,
} from '../../utils/suggestExtruderFromSpec'

export type ProductionExtruderSelectProps = {
  labelId: string
  value: string
  onChange: (code: string) => void
  onUserTouched?: () => void
  spec: SpecPayload
  ratebook: QuoteRatebook | null | undefined
  hintLine?: string
}

type RatebookExtruderRow = {
  extruder_code?: string | null
  model?: string | null
  die_size_mm?: number | null
  decision_width_mm?: number | null
  average_kg_hr?: number | null
}

function extruderMenuLabel(ex: RatebookExtruderRow, disableReason: ExtruderDisableReason | null): string {
  const code = String(ex.extruder_code || '').trim()
  const model = ex?.model != null && String(ex.model).trim() ? String(ex.model).trim() : ''
  const dieMm = ex?.die_size_mm != null ? Number(ex.die_size_mm) : null
  const dw = ex?.decision_width_mm != null ? Number(ex.decision_width_mm) : null
  const avg = ex?.average_kg_hr != null ? Number(ex.average_kg_hr) : null
  const bits = [code]
  if (model) bits.push(`— ${model}`)
  if (dieMm != null && Number.isFinite(dieMm)) bits.push(`die ${Math.round(dieMm)} mm`)
  if (dw != null && Number.isFinite(dw)) bits.push(`${Math.round(dw)} mm`)
  if (avg != null && Number.isFinite(avg)) bits.push(`~${avg} kg/h`)
  if (disableReason) bits.push(`(${disableReason})`)
  return bits.join(' · ')
}

export function ProductionExtruderSelect(props: ProductionExtruderSelectProps): ReactElement {
  const { labelId, value, onChange, onUserTouched, spec, ratebook, hintLine = '' } = props
  const trimmed = value.trim()

  const selectedDisableReason = useMemo(
    () => (trimmed ? extruderDisableReasonForSpec(trimmed, spec, ratebook) : null),
    [trimmed, spec, ratebook],
  )

  const extruders = Array.isArray(ratebook?.extruders) ? ratebook.extruders : []

  return (
    <Stack spacing={2}>
      <FormControl
        fullWidth
        size="small"
        sx={{
          maxWidth: 520,
          ...(selectedDisableReason
            ? {
                bgcolor: 'grey.200',
                borderRadius: 1,
                px: 1,
                py: 0.5,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'grey.500' },
              }
            : {}),
        }}
      >
        <InputLabel id={labelId}>Extruder</InputLabel>
        <Select
          labelId={labelId}
          label="Extruder"
          value={trimmed !== '' ? trimmed : ''}
          onChange={(e) => {
            const next = String(e.target.value || '').trim()
            if (next && extruderDisableReasonForSpec(next, spec, ratebook)) return
            onUserTouched?.()
            onChange(next)
          }}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {extruders
            .filter((ex) => ex && String(ex.extruder_code || '').trim())
            .map((ex) => {
              const code = String(ex.extruder_code || '').trim()
              const disableReason = extruderRowDisableReason(ex, spec, ratebook)
              return (
                <MenuItem
                  key={code}
                  value={code}
                  disabled={!!disableReason}
                  sx={
                    disableReason
                      ? {
                          color: 'text.disabled',
                          opacity: 0.85,
                          '&.Mui-disabled': { opacity: 0.85 },
                        }
                      : undefined
                  }
                >
                  {extruderMenuLabel(ex, disableReason)}
                </MenuItem>
              )
            })}
        </Select>
      </FormControl>
      {selectedDisableReason ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Selected extruder is {selectedDisableReason.toLowerCase()} for this product spec. Choose another extruder.
        </Typography>
      ) : null}
      {hintLine ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {hintLine}
        </Typography>
      ) : null}
    </Stack>
  )
}

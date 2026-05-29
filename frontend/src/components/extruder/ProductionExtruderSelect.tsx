import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import type { SpecPayload } from '../SpecPayloadForm'
import { ReadonlyDisplayField } from '../ReadonlyDisplayField'
import type { QuoteRatebook } from '../../utils/quoteCalculator'
import {
  extruderDisableReasonForSpec,
  extruderDecisionWidthMmFromSpec,
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
  const selectedUnavailable = selectedDisableReason === 'Unavailable'

  const extruders = Array.isArray(ratebook?.extruders) ? ratebook.extruders : []
  const selectedExtruder = useMemo(
    () => extruders.find((ex) => String(ex?.extruder_code || '').trim() === trimmed) ?? null,
    [extruders, trimmed],
  )
  const blowUpRatioNumber = useMemo(() => {
    if (!selectedExtruder) return null
    const layflatMm = extruderDecisionWidthMmFromSpec(spec)
    const dieMm = selectedExtruder.die_size_mm != null ? Number(selectedExtruder.die_size_mm) : NaN
    if (layflatMm == null || !Number.isFinite(layflatMm) || layflatMm <= 0) return null
    if (!Number.isFinite(dieMm) || dieMm <= 0) return null
    return layflatMm / dieMm
  }, [selectedExtruder, spec])
  const blowUpRatio = blowUpRatioNumber == null ? '' : blowUpRatioNumber.toFixed(2)
  const blowUpRatioOutOfRange =
    blowUpRatioNumber != null && (blowUpRatioNumber < 2.8 || blowUpRatioNumber > 4.2)

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 520px) minmax(120px, 180px)' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <FormControl
          fullWidth
          sx={{
            ...(selectedUnavailable
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
              if (next && extruderDisableReasonForSpec(next, spec, ratebook) === 'Unavailable') return
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
                const unavailable = disableReason === 'Unavailable'
                return (
                  <MenuItem
                    key={code}
                    value={code}
                    disabled={unavailable}
                    sx={
                      unavailable
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
        <ReadonlyDisplayField
          label="Blow-up ratio"
          value={blowUpRatio}
          error={blowUpRatioOutOfRange}
          helperText={blowUpRatioOutOfRange ? 'outside of typical range' : ''}
        />
      </Box>
      {selectedUnavailable ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Selected extruder is unavailable. Choose another extruder.
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

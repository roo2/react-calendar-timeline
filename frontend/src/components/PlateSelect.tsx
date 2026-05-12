import { Autocomplete, TextField } from '@mui/material'

export type PlateOption = { plate_code: string; description?: string | null }

function optionLabel(o: PlateOption): string {
  return o.description ? `${o.plate_code} — ${o.description}` : o.plate_code
}

export function PlateSelect(props: {
  options: PlateOption[]
  valueCode: string
  label?: string
  error?: boolean
  helperText?: string
  onChangeCode: (nextCode: string) => void
  /** When true, allow any free-text plate code in addition to catalog options (stored in `plate_code`). */
  freeSolo?: boolean
}) {
  const { options, valueCode, label, error, helperText, onChangeCode, freeSolo } = props
  const trimmed = String(valueCode ?? '').trim()
  const selectedFromCatalog = options.find((o) => o.plate_code === trimmed) ?? null
  const value: PlateOption | string | null = freeSolo
    ? selectedFromCatalog ?? (trimmed ? trimmed : null)
    : selectedFromCatalog

  return (
    <Autocomplete
      size="small"
      freeSolo={!!freeSolo}
      options={options}
      value={value}
      getOptionLabel={(o) => (typeof o === 'string' ? o : optionLabel(o))}
      isOptionEqualToValue={(a, b) => {
        const codeA = typeof a === 'string' ? a : a.plate_code
        const codeB = typeof b === 'string' ? b : b.plate_code
        return codeA === codeB
      }}
      onChange={(_e, v) => {
        if (v == null) {
          onChangeCode('')
          return
        }
        if (typeof v === 'string') {
          onChangeCode(v.trim())
          return
        }
        onChangeCode(v?.plate_code || '')
      }}
      renderInput={(params) => (
        <TextField {...params} label={label || 'Plate'} error={error} helperText={helperText} />
      )}
    />
  )
}

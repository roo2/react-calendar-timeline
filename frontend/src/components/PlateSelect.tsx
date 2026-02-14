import { Autocomplete, TextField } from '@mui/material'

export type PlateOption = { plate_code: string; description?: string | null }

export function PlateSelect(props: {
  options: PlateOption[]
  valueCode: string
  label?: string
  error?: boolean
  helperText?: string
  onChangeCode: (nextCode: string) => void
}) {
  const { options, valueCode, label, error, helperText, onChangeCode } = props
  return (
    <Autocomplete
      size="small"
      options={options}
      value={options.find((o) => o.plate_code === valueCode) || null}
      getOptionLabel={(o) => (o.description ? `${o.plate_code} — ${o.description}` : o.plate_code)}
      isOptionEqualToValue={(a, b) => a.plate_code === b.plate_code}
      onChange={(_e, v) => onChangeCode(v?.plate_code || '')}
      renderInput={(params) => <TextField {...params} label={label || 'Plate'} error={error} helperText={helperText} />}
    />
  )
}


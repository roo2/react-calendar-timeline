import { Autocomplete, TextField } from '@mui/material'

export type ColourOption = { colour_code: string; name: string }

export function ColourSelect(props: {
  options: ColourOption[]
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
      value={options.find((o) => o.colour_code === valueCode) || null}
      getOptionLabel={(o) => `${o.colour_code} — ${o.name}`}
      isOptionEqualToValue={(a, b) => a.colour_code === b.colour_code}
      onChange={(_e, v) => onChangeCode(v?.colour_code || '')}
      renderInput={(params) => <TextField {...params} label={label || 'Colour'} error={error} helperText={helperText} />}
    />
  )
}


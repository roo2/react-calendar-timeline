import { Autocomplete, TextField } from '@mui/material'

export type InkOption = { ink_code: string; name: string }

export function InkSelect(props: {
  options: InkOption[]
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
      value={options.find((o) => o.ink_code === valueCode) || null}
      getOptionLabel={(o) => `${o.ink_code} — ${o.name}`}
      isOptionEqualToValue={(a, b) => a.ink_code === b.ink_code}
      onChange={(_e, v) => onChangeCode(v?.ink_code || '')}
      renderInput={(params) => <TextField {...params} label={label || 'Ink'} error={error} helperText={helperText} />}
    />
  )
}


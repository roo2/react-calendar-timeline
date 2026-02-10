import { Autocomplete, TextField } from '@mui/material'

export type AdditiveOption = { additive_code: string; name: string }

export function AdditiveSelect(props: {
  options: AdditiveOption[]
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
      value={options.find((o) => o.additive_code === valueCode) || null}
      getOptionLabel={(o) => `${o.additive_code} — ${o.name}`}
      isOptionEqualToValue={(a, b) => a.additive_code === b.additive_code}
      onChange={(_e, v) => onChangeCode(v?.additive_code || '')}
      renderInput={(params) => <TextField {...params} label={label || 'Additive'} error={error} helperText={helperText} />}
    />
  )
}


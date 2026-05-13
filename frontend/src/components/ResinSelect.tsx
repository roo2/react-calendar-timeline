import { Autocomplete, TextField, type SxProps, type Theme } from '@mui/material'

export type ResinOption = { resin_code: string; name: string }

export function ResinSelect(props: {
  options: ResinOption[]
  valueCode: string
  label?: string
  error?: boolean
  helperText?: string
  reserveHelperTextSpace?: boolean
  fullWidth?: boolean
  sx?: SxProps<Theme>
  /** When true, the outlined input uses a solid white background (e.g. materials custom blend table). */
  outlinedInputWhiteBg?: boolean
  onChangeCode: (nextCode: string) => void
}) {
  const {
    options,
    valueCode,
    label,
    error,
    helperText,
    reserveHelperTextSpace = true,
    fullWidth = true,
    sx,
    outlinedInputWhiteBg,
    onChangeCode,
  } = props
  return (
    <Autocomplete
      size="small"
      options={options}
      value={options.find((o) => o.resin_code === valueCode) || null}
      getOptionLabel={(o) => `${o.resin_code} — ${o.name}`}
      isOptionEqualToValue={(a, b) => a.resin_code === b.resin_code}
      onChange={(_e, v) => onChangeCode(v?.resin_code || '')}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth={fullWidth}
          label={label || 'Resin'}
          error={error}
          helperText={helperText !== undefined ? helperText : reserveHelperTextSpace ? ' ' : undefined}
          FormHelperTextProps={reserveHelperTextSpace ? { sx: { minHeight: 20 } } : undefined}
          sx={[
            ...(outlinedInputWhiteBg ? [{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }] : []),
          ]}
        />
      )}
    />
  )
}


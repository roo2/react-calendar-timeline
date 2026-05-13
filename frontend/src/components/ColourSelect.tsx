import { Autocomplete, Box, TextField, type SxProps, type Theme } from '@mui/material'

export type ColourOption = { colour_code: string; name: string; hex_code?: string | null }

export function ColourSelect(props: {
  options: ColourOption[]
  valueCode: string
  label?: string
  error?: boolean
  helperText?: string
  /** When true, the outlined input uses a solid white background (e.g. materials tables on tinted rows). */
  outlinedInputWhiteBg?: boolean
  textFieldSx?: SxProps<Theme>
  onChangeCode: (nextCode: string) => void
}) {
  const { options, valueCode, label, error, helperText, outlinedInputWhiteBg, textFieldSx, onChangeCode } = props
  return (
    <Autocomplete
      size="small"
      options={options}
      value={options.find((o) => o.colour_code === valueCode) || null}
      getOptionLabel={(o) => `${o.colour_code} — ${o.name}`}
      isOptionEqualToValue={(a, b) => a.colour_code === b.colour_code}
      onChange={(_e, v) => onChangeCode(v?.colour_code || '')}
      renderOption={(props, option) => (
        <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 16,
              height: 16,
              borderRadius: '4px',
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: option.hex_code || 'transparent',
              flexShrink: 0,
            }}
          />
          <span>{`${option.colour_code} — ${option.name}`}</span>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label || 'Colour'}
          error={error}
          helperText={helperText}
          sx={[
            ...(outlinedInputWhiteBg ? [{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }] : []),
            ...(Array.isArray(textFieldSx) ? textFieldSx : textFieldSx != null ? [textFieldSx] : []),
          ]}
        />
      )}
    />
  )
}


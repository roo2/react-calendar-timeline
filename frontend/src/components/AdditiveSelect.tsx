import { Autocomplete, Box, TextField } from '@mui/material'

export type AdditiveOption = { additive_code: string; name: string; highlight_hex_code?: string | null }

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
      renderOption={(props, option) => (
        <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 16,
              height: 16,
              borderRadius: '4px',
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: option.highlight_hex_code || 'transparent',
              flexShrink: 0,
            }}
          />
          <span>{`${option.additive_code} — ${option.name}`}</span>
        </Box>
      )}
      renderInput={(params) => <TextField {...params} label={label || 'Additive'} error={error} helperText={helperText} />}
    />
  )
}


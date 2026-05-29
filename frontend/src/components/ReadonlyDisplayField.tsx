import { TextField, type SxProps, type Theme } from '@mui/material'

export function ReadonlyDisplayField(props: {
  label: string
  value: string
  helperText?: string
  error?: boolean
  sx?: SxProps<Theme>
}) {
  const { label, value, helperText = '', error = false, sx } = props
  return (
    <TextField
      label={label}
      value={value || '-'}
      helperText={helperText}
      error={error}
      disabled
      fullWidth
      sx={[
        {
          '& .MuiInputBase-root': {
            bgcolor: 'grey.50',
          },
          '& .MuiInputBase-input.Mui-disabled': {
            WebkitTextFillColor: 'inherit',
            color: 'text.primary',
            fontWeight: 400,
          },
          '& .MuiInputLabel-root.Mui-disabled': {
            color: error ? 'error.main' : 'text.secondary',
          },
          '& .MuiFormHelperText-root.Mui-disabled': {
            color: error ? 'error.main' : 'text.secondary',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}

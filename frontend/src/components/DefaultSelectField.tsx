import { TextField, type TextFieldProps } from '@mui/material'

function norm(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

export function isDefaultValue(value: unknown, defaultValue: unknown): boolean {
  return norm(value) === norm(defaultValue)
}

export function defaultFieldSx(isDefault: boolean) {
  if (isDefault) return {}
  return {
    // Very light yellow tint when the value differs from the template default.
    // !important so parent panels (e.g. perforated tint) can set a default input surface without hiding this highlight.
    '& .MuiInputBase-root': { bgcolor: '#FFFDE7 !important' },
  }
}

type DefaultSelectFieldProps = Omit<TextFieldProps, 'select'> & {
  defaultValue: unknown
}

/**
 * TextField(select) with a subtle yellow tint when the value differs from `defaultValue`.
 * Intended as a reusable pattern across quote/job sheet forms.
 */
export function DefaultSelectField(props: DefaultSelectFieldProps) {
  const { defaultValue, value, sx, ...rest } = props
  const isDefault = isDefaultValue(value, defaultValue)
  return <TextField {...rest} select value={value} sx={[defaultFieldSx(isDefault), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]} />
}


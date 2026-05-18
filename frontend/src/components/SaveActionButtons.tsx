import SaveIcon from '@mui/icons-material/Save'
import SaveAsIcon from '@mui/icons-material/SaveAs'
import { Button, type ButtonProps } from '@mui/material'

type SaveButtonProps = Omit<ButtonProps, 'children'> & {
  saving?: boolean
  savingLabel?: string
  label: string
}

/** Primary save action (floppy-disk icon). */
export function SaveFormButton({
  saving,
  savingLabel = 'Saving…',
  label,
  disabled,
  startIcon,
  variant = 'contained',
  color = 'primary',
  ...rest
}: SaveButtonProps) {
  return (
    <Button
      variant={variant}
      color={color}
      disabled={Boolean(disabled) || saving}
      startIcon={startIcon ?? <SaveIcon />}
      {...rest}
    >
      {saving ? savingLabel : label}
    </Button>
  )
}

/** Outlined save (draft / secondary save flows). */
export function SaveOutlinedButton({
  saving,
  savingLabel = 'Saving…',
  label,
  disabled,
  startIcon,
  ...rest
}: SaveButtonProps) {
  return (
    <Button
      variant="outlined"
      color="primary"
      disabled={Boolean(disabled) || saving}
      startIcon={startIcon ?? <SaveIcon />}
      {...rest}
    >
      {saving ? savingLabel : label}
    </Button>
  )
}

/** Fork spec onto a new product (save-as icon, distinct outline colour). */
export function SaveAsNewProductButton({
  saving,
  savingLabel = 'Saving as new product…',
  label = 'Save As New Product',
  disabled,
  sx,
  ...rest
}: Omit<ButtonProps, 'children'> & {
  saving?: boolean
  savingLabel?: string
  label?: string
}) {
  return (
    <Button
      variant="outlined"
      color="secondary"
      type="button"
      disabled={Boolean(disabled) || saving}
      startIcon={<SaveAsIcon />}
      sx={{
        borderWidth: 2,
        '&:hover': { borderWidth: 2 },
        ...sx,
      }}
      {...rest}
    >
      {saving ? savingLabel : label}
    </Button>
  )
}

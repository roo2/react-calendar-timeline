import PrintIcon from '@mui/icons-material/Print'
import { Button, type ButtonProps } from '@mui/material'
import { useEffect, useRef } from 'react'

type JobSheetPrintActionButtonProps = Omit<ButtonProps, 'children' | 'onClick'> & {
  disabled?: boolean
  printing?: boolean
  label?: string
  onPrint: () => void | Promise<void>
}

export function useJobSheetPrintShortcut(enabled: boolean, onPrint: () => void | Promise<void>) {
  const onPrintRef = useRef(onPrint)
  onPrintRef.current = onPrint

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      void onPrintRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}

export function JobSheetPrintActionButton({
  disabled,
  printing,
  label = 'Print',
  onPrint,
  variant = 'contained',
  color = 'primary',
  type = 'button',
  ...rest
}: JobSheetPrintActionButtonProps) {
  return (
    <Button
      variant={variant}
      color={color}
      type={type}
      onClick={() => void onPrint()}
      disabled={Boolean(disabled) || printing}
      startIcon={<PrintIcon />}
      {...rest}
    >
      {printing ? 'Preparing print…' : label}
    </Button>
  )
}

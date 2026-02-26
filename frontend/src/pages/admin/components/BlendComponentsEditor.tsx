import { Button, Stack, TextField, Typography } from '@mui/material'
import { ResinSelect, type ResinOption } from '../../../components/ResinSelect'

export type BlendComponentDraft = { resin_code: string; pct: number | '' }

export function BlendComponentsEditor(props: {
  resinOptions: ResinOption[]
  components: BlendComponentDraft[]
  onChange: (next: BlendComponentDraft[]) => void
}) {
  const { resinOptions, components, onChange } = props

  const sum = components.reduce((acc, c) => acc + Number(c.pct || 0), 0)
  const sumOk = Math.abs(sum - 100) < 0.01

  return (
    <Stack spacing={1}>
      {components.map((c, idx) => (
        <Stack key={idx} direction="row" spacing={1} alignItems="center">
          <ResinSelect
            options={resinOptions}
            valueCode={c.resin_code}
            label="Resin"
            onChangeCode={(nextCode) => {
              const copy = components.slice()
              copy[idx] = { ...copy[idx], resin_code: nextCode }
              onChange(copy)
            }}
            reserveHelperTextSpace={false}
          />
          <TextField
            size="small"
            label="%"
            sx={{ width: 120 }}
            inputProps={{ inputMode: 'decimal' }}
            value={c.pct}
            onChange={(e) => {
              const v = e.target.value
              const copy = components.slice()
              copy[idx] = { ...copy[idx], pct: v ? parseFloat(v) : '' }
              onChange(copy)
            }}
          />
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={() => onChange(components.filter((_, i) => i !== idx))}
            disabled={components.length <= 1}
          >
            Remove
          </Button>
        </Stack>
      ))}

      <Stack direction="row" spacing={2} alignItems="center">
        <Button size="small" variant="outlined" onClick={() => onChange([...components, { resin_code: '', pct: '' }])}>
          Add component
        </Button>
        <Typography variant="body2" color={sumOk ? 'text.secondary' : 'error.main'}>
          Total: {sum.toFixed(2)}%{sumOk ? '' : ' (must be 100%)'}
        </Typography>
      </Stack>
    </Stack>
  )
}


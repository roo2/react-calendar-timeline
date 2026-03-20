import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material'
import { defaultRowSx, isDefaultRow } from './DefaultRowTable'
import { ColourSelect, type ColourOption } from './ColourSelect'
import { AdditiveSelect, type AdditiveOption } from './AdditiveSelect'

export type ColourRow = { colour_code: string; strength_pct: string }
export type AdditiveRow = { additive_code: string; pct: string }

const COLOUR_DEFAULTS: ColourRow = { colour_code: '', strength_pct: '' }
const ADDITIVE_DEFAULTS: AdditiveRow = { additive_code: '', pct: '' }

/** Pad array to at least `min` rows; reused for materials and printing tables. */
export function ensureMinRows<T extends Record<string, unknown>>(rows: T[], defaults: T, min: number): T[] {
  if (rows.length >= min) return rows
  const pad = Array(min - rows.length)
    .fill(null)
    .map(() => ({ ...defaults }) as T)
  return [...rows, ...pad]
}

export type MaterialsColoursAndAdditivesProps = {
  colourOptions: ColourOption[]
  additiveOptions: AdditiveOption[]
  colourRows: ColourRow[]
  onColourRowsChange: (rows: ColourRow[]) => void
  additiveRows: AdditiveRow[]
  onAdditiveRowsChange: (rows: AdditiveRow[]) => void
}

/**
 * Shared colours and additives tables: two rows always visible, same selectors and Add/Remove behaviour.
 * Used on both Quote and Product spec pages so behaviour is identical.
 */
export function MaterialsColoursAndAdditives(props: MaterialsColoursAndAdditivesProps) {
  const {
    colourOptions,
    additiveOptions,
    colourRows,
    onColourRowsChange,
    additiveRows,
    onAdditiveRowsChange,
  } = props

  const colours = ensureMinRows(colourRows, COLOUR_DEFAULTS, 2)
  const additives = ensureMinRows(additiveRows, ADDITIVE_DEFAULTS, 2)

  function setColourRow(idx: number, patch: Partial<ColourRow>) {
    const next = [...colours]
    next[idx] = { ...(next[idx] || COLOUR_DEFAULTS), ...patch }
    onColourRowsChange(next)
  }

  function setAdditiveRow(idx: number, patch: Partial<AdditiveRow>) {
    const next = [...additives]
    next[idx] = { ...(next[idx] || ADDITIVE_DEFAULTS), ...patch }
    onAdditiveRowsChange(next)
  }

  function handleRemoveColour(idx: number) {
    if (colours.length > 2) {
      onColourRowsChange(colours.filter((_, i) => i !== idx))
    } else {
      setColourRow(idx, COLOUR_DEFAULTS)
    }
  }

  function handleRemoveAdditive(idx: number) {
    if (additives.length > 2) {
      onAdditiveRowsChange(additives.filter((_, i) => i !== idx))
    } else {
      setAdditiveRow(idx, ADDITIVE_DEFAULTS)
    }
  }

  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Colour</TableCell>
            <TableCell>Percentage (%)</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {colours.map((row, idx) => {
            const isDefault = isDefaultRow(row, COLOUR_DEFAULTS)
            return (
              <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                <TableCell sx={{ width: '55%' }}>
                  <ColourSelect
                    options={colourOptions}
                    valueCode={row.colour_code}
                    label={idx === 0 ? 'Colour 1' : `Colour ${idx + 1}`}
                    onChangeCode={(nextCode) => setColourRow(idx, { colour_code: nextCode })}
                  />
                </TableCell>
                <TableCell sx={{ width: '35%' }}>
                  <TextField
                    size="small"
                    label="%"
                    type="number"
                    inputProps={{ min: 0, step: 0.1 }}
                    value={row.strength_pct}
                    onChange={(e) => setColourRow(idx, { strength_pct: e.target.value })}
                    fullWidth
                  />
                </TableCell>
                <TableCell sx={{ width: '10%' }}>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => handleRemoveColour(idx)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <Box sx={{ mt: 1 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => onColourRowsChange([...colours, { colour_code: '', strength_pct: '' }])}
        >
          Add colour
        </Button>
      </Box>

      <Box sx={{ mt: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Additive</TableCell>
              <TableCell>Percentage (%)</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {additives.map((row, idx) => {
              const isDefault = isDefaultRow(row, ADDITIVE_DEFAULTS)
              return (
                <TableRow key={idx} hover sx={defaultRowSx(isDefault)}>
                  <TableCell sx={{ width: '55%' }}>
                    <AdditiveSelect
                      options={additiveOptions}
                      valueCode={row.additive_code}
                      label={`Additive ${idx + 1}`}
                      onChangeCode={(nextCode) => setAdditiveRow(idx, { additive_code: nextCode })}
                    />
                  </TableCell>
                  <TableCell sx={{ width: '35%' }}>
                    <TextField
                      size="small"
                      label="%"
                      type="number"
                      inputProps={{ min: 0, step: 0.1 }}
                      value={row.pct}
                      onChange={(e) => setAdditiveRow(idx, { pct: e.target.value })}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell sx={{ width: '10%' }}>
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => handleRemoveAdditive(idx)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <Box sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => onAdditiveRowsChange([...additives, { additive_code: '', pct: '' }])}
          >
            Add additive
          </Button>
        </Box>
      </Box>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  clearProductionCalendarSaveError,
  createCalendarException,
  deleteCalendarException,
  fetchCalendarExceptions,
  fetchProductionCalendarSettings,
  saveProductionCalendarSettings,
  WEEKDAYS,
  type ProductionCalendarSettings,
  type WeekdayHours,
} from '../../store/slices/productionCalendarSlice'
import { AdminPageHeader } from './components/AdminPageHeader'
import { PRODUCTION_CALENDAR_TIMEZONE } from './productionCalendarConstants'

const DAY_LABEL: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

function emptyWeekdays(): Record<string, WeekdayHours> {
  const o: Record<string, WeekdayHours> = {}
  for (const d of WEEKDAYS) {
    o[d] = { enabled: false, start: '00:00', end: '24:00' }
  }
  return o
}

export function ProductionCalendarAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const { data: loaded, status, error: loadErr } = useAppSelector((s) => s.productionCalendar.settings)
  const { list: exceptions, error: exErr } = useAppSelector((s) => s.productionCalendar.exceptions)
  const save = useAppSelector((s) => s.productionCalendar.save)

  const [previewWeeks, setPreviewWeeks] = useState<number | ''>(4)
  const [weekdays, setWeekdays] = useState<Record<string, WeekdayHours>>(emptyWeekdays)

  const [exDate, setExDate] = useState('')
  const [exClosed, setExClosed] = useState(true)
  const [exOpen, setExOpen] = useState('')
  const [exClose, setExClose] = useState('')
  const [exNote, setExNote] = useState('')
  const [exBusy, setExBusy] = useState(false)

  useEffect(() => {
    void dispatch(fetchProductionCalendarSettings())
    void dispatch(fetchCalendarExceptions())
  }, [dispatch])

  useEffect(() => {
    if (!loaded) return
    setPreviewWeeks(loaded.gantt_preview_weeks)
    const next = emptyWeekdays()
    for (const d of WEEKDAYS) {
      next[d] = loaded.weekdays[d] ?? next[d]
    }
    setWeekdays(next)
  }, [loaded])

  const dirty = useMemo(() => {
    if (!loaded) return false
    if (Number(previewWeeks) !== loaded.gantt_preview_weeks) return true
    for (const d of WEEKDAYS) {
      const a = weekdays[d]
      const b = loaded.weekdays[d]
      if (!b || a.enabled !== b.enabled || a.start !== b.start || a.end !== b.end) return true
    }
    return false
  }, [loaded, previewWeeks, weekdays])

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  async function handleSave() {
    if (!loaded) return
    const w = Number(previewWeeks)
    if (!Number.isFinite(w) || w < 1 || w > 52) return
    dispatch(clearProductionCalendarSaveError())
    const payload: ProductionCalendarSettings = {
      timezone: PRODUCTION_CALENDAR_TIMEZONE,
      gantt_preview_weeks: w,
      weekdays: { ...weekdays },
    }
    await dispatch(saveProductionCalendarSettings(payload)).unwrap()
    setDirty(false)
  }

  async function handleAddException() {
    if (!exDate) return
    setExBusy(true)
    try {
      await dispatch(
        createCalendarException({
          exception_date: exDate,
          closed: exClosed,
          open_time: exOpen || undefined,
          close_time: exClose || undefined,
          note: exNote || undefined,
        }),
      ).unwrap()
      setExDate('')
      setExNote('')
      setExOpen('')
      setExClose('')
    } finally {
      setExBusy(false)
    }
  }

  const displayErr = loadErr || save.error || exErr

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Production operating hours"
        subtitle={`Weekly open hours and date exceptions (holidays, early close). All times are ${PRODUCTION_CALENDAR_TIMEZONE} (Queensland). The schedule Gantt uses these times so long jobs skip nights, weekends, and closed days.`}
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }}>
        {status === 'loading' && !loaded ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Timezone is fixed to <strong>{PRODUCTION_CALENDAR_TIMEZONE}</strong>.
            </Typography>
            <TextField
              size="small"
              label="Gantt preview (weeks)"
              type="number"
              inputProps={{ min: 1, max: 52 }}
              value={previewWeeks}
              onChange={(e) => setPreviewWeeks(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <Typography variant="subtitle2">Weekly pattern</Typography>
            <Typography variant="caption" color="text.secondary">
              Use 24:00 for end of day. Disabled days are fully closed.
            </Typography>
            <Stack spacing={1}>
              {WEEKDAYS.map((d) => (
                <Box key={d} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={weekdays[d]?.enabled ?? false}
                        onChange={(e) =>
                          setWeekdays((prev) => ({
                            ...prev,
                            [d]: { ...prev[d], enabled: e.target.checked },
                          }))
                        }
                      />
                    }
                    label={DAY_LABEL[d]}
                    sx={{ minWidth: 120 }}
                  />
                  <TextField
                    size="small"
                    label="Open"
                    value={weekdays[d]?.start ?? '00:00'}
                    onChange={(e) =>
                      setWeekdays((prev) => ({ ...prev, [d]: { ...prev[d], start: e.target.value } }))
                    }
                    sx={{ width: 100 }}
                  />
                  <TextField
                    size="small"
                    label="Close"
                    value={weekdays[d]?.end ?? '24:00'}
                    onChange={(e) =>
                      setWeekdays((prev) => ({ ...prev, [d]: { ...prev[d], end: e.target.value } }))
                    }
                    sx={{ width: 100 }}
                  />
                </Box>
              ))}
            </Stack>
            <Button variant="contained" disabled={!dirty || save.status === 'loading'} onClick={() => void handleSave()}>
              {save.status === 'loading' ? 'Saving…' : 'Save weekly hours'}
            </Button>
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 900 }}>
        <Typography variant="subtitle1" gutterBottom>
          Exceptions (holidays, early close)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          <strong>Closed</strong> = no production that day. Otherwise use optional open/close overrides (HH:MM) for
          late start or early finish.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            type="date"
            label="Date"
            InputLabelProps={{ shrink: true }}
            value={exDate}
            onChange={(e) => setExDate(e.target.value)}
            sx={{ minWidth: 160 }}
          />
          <FormControlLabel control={<Checkbox checked={exClosed} onChange={(e) => setExClosed(e.target.checked)} />} label="Closed (holiday)" />
          <TextField size="small" label="Open override" placeholder="optional" value={exOpen} onChange={(e) => setExOpen(e.target.value)} sx={{ width: 120 }} />
          <TextField size="small" label="Close override" placeholder="optional" value={exClose} onChange={(e) => setExClose(e.target.value)} sx={{ width: 120 }} />
          <TextField size="small" label="Note" value={exNote} onChange={(e) => setExNote(e.target.value)} sx={{ minWidth: 160 }} />
          <Button variant="outlined" disabled={!exDate || exBusy} onClick={() => void handleAddException()}>
            Add
          </Button>
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Closed</TableCell>
              <TableCell>Open</TableCell>
              <TableCell>Close</TableCell>
              <TableCell>Note</TableCell>
              <TableCell align="right"> </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {exceptions.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.exception_date}</TableCell>
                <TableCell>{r.closed ? 'Yes' : '—'}</TableCell>
                <TableCell>{r.open_time ?? '—'}</TableCell>
                <TableCell>{r.close_time ?? '—'}</TableCell>
                <TableCell>{r.note ?? '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" onClick={() => void dispatch(deleteCalendarException(r.id))}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {exceptions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">
                    No exceptions yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  )
}

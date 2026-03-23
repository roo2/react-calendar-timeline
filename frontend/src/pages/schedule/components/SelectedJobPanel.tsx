import { Box, Divider, Paper, Stack, Typography } from '@mui/material'
import type { GanttBar, GanttLane, UnqueuedScheduleJob } from '../../../store/slices/scheduleSlice'

type Props = {
  jobId: string | null
  lanes: GanttLane[]
  unqueuedJobs: UnqueuedScheduleJob[]
  onClear: () => void
}

function findBar(lanes: GanttLane[], jobId: string): { bar: GanttBar; lane: GanttLane } | null {
  for (const lane of lanes) {
    const bar = lane.bars.find((b) => String(b.job_id) === String(jobId))
    if (bar) return { bar, lane }
  }
  return null
}

export function SelectedJobPanel({ jobId, lanes, unqueuedJobs, onClear }: Props) {
  const fromLane = jobId ? findBar(lanes, jobId) : null
  const fromPool = jobId ? unqueuedJobs.find((j) => String(j.job_id) === String(jobId)) : null

  return (
    <Paper
      variant="outlined"
      sx={{
        width: '100%',
        minWidth: 0,
        flexShrink: 0,
        p: 1.5,
        alignSelf: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Selected job</Typography>
        {jobId ? (
          <Typography
            component="button"
            type="button"
            variant="caption"
            onClick={onClear}
            sx={{
              cursor: 'pointer',
              border: 'none',
              bgcolor: 'transparent',
              color: 'primary.main',
              textDecoration: 'underline',
              p: 0,
            }}
          >
            Clear
          </Typography>
        ) : null}
      </Stack>

      {!jobId ? (
        <Typography variant="body2" color="text.secondary">
          Click a job on the timeline or in the unqueued list to see details.
        </Typography>
      ) : fromLane ? (
        <Stack spacing={1}>
          <Typography variant="subtitle1" noWrap title={fromLane.bar.job_code}>
            {fromLane.bar.job_code}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fromLane.lane.machine_code} · {fromLane.bar.operation_type.replace(/_/g, ' ')}
          </Typography>
          {fromLane.lane.machine_type === 'extruder' &&
          fromLane.lane.film_width_min_mm != null &&
          fromLane.lane.film_width_max_mm != null ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Extruder film width: {fromLane.lane.film_width_min_mm}–{fromLane.lane.film_width_max_mm} mm
            </Typography>
          ) : null}
          {fromLane.bar.job_layflat_width_mm != null && Number.isFinite(fromLane.bar.job_layflat_width_mm) ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Job layflat (from spec): {fromLane.bar.job_layflat_width_mm.toFixed(1)} mm
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" display="block">
              Job layflat: not set in product spec (width check may not apply)
            </Typography>
          )}
          {fromLane.bar.job_sheet_job_no ? (
            <Typography variant="body2">Sheet {fromLane.bar.job_sheet_job_no}</Typography>
          ) : null}
          <Divider />
          <Typography variant="body2">{fromLane.bar.customer}</Typography>
          <Typography variant="body2" color="text.secondary">
            {fromLane.bar.product_code} · qty {fromLane.bar.planned_qty}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ~{fromLane.bar.estimated_duration_hours.toFixed(1)} h · {fromLane.bar.roll_count ?? 1} roll
            {(fromLane.bar.roll_count ?? 1) === 1 ? '' : 's'}
          </Typography>
          {fromLane.bar.tentative_start ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Tentative: {new Date(fromLane.bar.tentative_start).toLocaleString()} →{' '}
              {fromLane.bar.tentative_finish
                ? new Date(fromLane.bar.tentative_finish).toLocaleString()
                : '—'}
            </Typography>
          ) : null}
          {fromLane.bar.warnings?.length ? (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {fromLane.bar.warnings.map((w) => (
                <li key={w}>
                  <Typography variant="caption" color="warning.main">
                    {w}
                  </Typography>
                </li>
              ))}
            </Box>
          ) : null}
        </Stack>
      ) : fromPool ? (
        <Stack spacing={1}>
          <Typography variant="subtitle1" noWrap title={fromPool.job_code}>
            {fromPool.job_code}
          </Typography>
          {fromPool.job_sheet_job_no ? (
            <Typography variant="body2">Sheet {fromPool.job_sheet_job_no}</Typography>
          ) : null}
          <Divider />
          <Typography variant="body2">{fromPool.customer}</Typography>
          <Typography variant="body2" color="text.secondary">
            {fromPool.product_code} · qty {fromPool.planned_qty} · {fromPool.roll_count} roll
            {fromPool.roll_count === 1 ? '' : 's'}
          </Typography>
          {fromPool.job_layflat_width_mm != null && Number.isFinite(fromPool.job_layflat_width_mm) ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Job layflat (from spec): {fromPool.job_layflat_width_mm.toFixed(1)} mm
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" display="block">
              Job layflat: not set in product spec
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Unqueued — drag to an extruder hour column to schedule (gaps allowed). Extruder labels show allowed film
            width (mm).
          </Typography>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Job not found in the current view.
        </Typography>
      )}
    </Paper>
  )
}

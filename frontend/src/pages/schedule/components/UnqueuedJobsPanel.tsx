import { memo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { UnqueuedScheduleJob } from '../../../store/slices/scheduleSlice'
import { poolJobId, SCHEDULE_UNQUEUED_ZONE_ID } from '../ganttIds'

const DraggableUnqueuedRow = memo(function DraggableUnqueuedRow({
  job,
  onSelect,
}: {
  job: UnqueuedScheduleJob
  onSelect?: (jobId: string) => void
}) {
  const id = poolJobId(job.job_id)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.45 : 1,
  } as const

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        ...style,
        p: 1,
        cursor: 'grab',
        touchAction: 'none',
        maxWidth: '100%',
        '&:active': { cursor: 'grabbing' },
      }}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (isDragging) return
        e.stopPropagation()
        onSelect?.(job.job_id)
      }}
    >
      <Typography variant="subtitle2" noWrap title={job.job_code}>
        {job.job_code}
      </Typography>
      {job.job_sheet_job_no ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          Sheet {job.job_sheet_job_no}
        </Typography>
      ) : null}
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {job.customer}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {job.product_code} · qty {job.planned_qty} · {job.roll_count} roll{job.roll_count === 1 ? '' : 's'}
      </Typography>
    </Paper>
  )
})

type Props = {
  jobs: UnqueuedScheduleJob[]
  onSelectJob?: (jobId: string) => void
  /** Grow in a flex column and scroll the job list (selected job pinned below). */
  fillColumn?: boolean
}

export const UnqueuedJobsPanel = memo(function UnqueuedJobsPanel({
  jobs,
  onSelectJob,
  fillColumn = false,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: SCHEDULE_UNQUEUED_ZONE_ID,
    data: { type: 'unqueued-zone' },
  })

  return (
    <Box
      ref={setNodeRef}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        ...(fillColumn
          ? {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }
          : {
              flexShrink: 0,
              height: 'auto',
              overflowX: 'hidden',
              overflowY: 'visible',
            }),
        bgcolor: isOver ? 'action.hover' : 'transparent',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        p: 1,
        transition: 'background-color 0.15s',
        boxSizing: 'border-box',
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, flexShrink: 0 }}>
        Unqueued (extrusion)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, flexShrink: 0 }}>
        Drag onto an <strong>extruder</strong> hour column to schedule (gaps allowed). Drag a queued job back here to
        unqueue.
      </Typography>
      <Box
        sx={{
          ...(fillColumn ? { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } : {}),
        }}
      >
        {jobs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No jobs waiting for extrusion.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ minWidth: 0 }}>
            {jobs.map((job) => (
              <DraggableUnqueuedRow key={job.job_id} job={job} onSelect={onSelectJob} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  )
})

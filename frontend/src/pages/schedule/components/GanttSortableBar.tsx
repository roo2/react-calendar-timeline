import { memo, type MouseEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type { GanttBar as GanttBarModel } from '../../../store/slices/scheduleSlice'
import { ganttBarId } from '../ganttIds'

/** Faint vertical lines on the bar background: `n` rolls → `n` equal-width segments (repeating divider). */
function RollVerticalBackground({ rollCount }: { rollCount: number }) {
  const n = Math.max(1, Math.min(rollCount, 500))
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        borderRadius: 'inherit',
        overflow: 'hidden',
        // One vertical line per segment boundary (n segments for n rolls)
        backgroundImage: `repeating-linear-gradient(
          90deg,
          transparent 0,
          transparent calc(100% / ${n} - 1px),
          rgba(0, 0, 0, 0.07) calc(100% / ${n} - 1px),
          rgba(0, 0, 0, 0.07) calc(100% / ${n})
        )`,
      }}
    />
  )
}

type BarContentProps = {
  bar: GanttBarModel
  /** When set, bar width follows timeline (px); otherwise minWidth heuristic for overlay/flex. */
  widthPx?: number
  /** Lane machine type; extruder bars show tool colour strips at the bottom. */
  machineType?: string
  onClick?: (e: MouseEvent) => void
}

export const GanttBarContent = memo(function GanttBarContent({ bar, widthPx, machineType, onClick }: BarContentProps) {
  const running = bar.status === 'running'
  const blocked = bar.readiness === 'blocked' || (bar.warnings?.length ?? 0) > 0
  const rollCount = bar.roll_count ?? 1
  const hoursPerRoll =
    rollCount > 0 ? bar.estimated_duration_hours / rollCount : bar.estimated_duration_hours
  const minW = widthPx ?? Math.max(100, 32 + bar.estimated_duration_hours * 20)
  const showToolStrips = machineType === 'extruder' && (bar.tool_strips?.length ?? 0) > 0
  const toolConflict = (bar.tool_conflicts?.length ?? 0) > 0

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        position: 'relative',
        width: widthPx != null ? widthPx : undefined,
        minWidth: widthPx != null ? Math.min(widthPx, 40) : minW,
        maxWidth: widthPx != null ? widthPx : 320,
        boxSizing: 'border-box',
        p: 0.75,
        pb: showToolStrips ? 1.5 : 0.75,
        cursor: running ? 'default' : 'grab',
        borderColor: toolConflict ? 'error.light' : blocked ? 'warning.main' : running ? 'success.main' : 'divider',
        bgcolor: running ? 'action.selected' : 'background.paper',
        overflow: 'hidden',
      }}
    >
      <RollVerticalBackground rollCount={rollCount} />
      <Stack spacing={0.25} sx={{ position: 'relative', zIndex: 1 }}>
        <Typography variant="subtitle2" noWrap title={bar.job_code}>
          {bar.job_code}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={bar.customer}>
          {bar.customer}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={`${rollCount} rolls · ~${hoursPerRoll.toFixed(2)}h per roll`}>
          {bar.product_code} · {bar.planned_qty} · {bar.estimated_duration_hours.toFixed(1)}h · {rollCount} rolls
        </Typography>
        <Stack direction="row" gap={0.5} flexWrap="wrap" useFlexGap>
          {running ? <Chip size="small" color="success" label="Running" /> : null}
          {blocked ? <Chip size="small" color="warning" label="Advisory" /> : null}
          {toolConflict ? <Chip size="small" color="error" variant="outlined" label="Tool conflict" /> : null}
          {bar.requires_uteco ? <Chip size="small" variant="outlined" label="Uteco" /> : null}
          {bar.num_colours > 0 ? (
            <Chip size="small" variant="outlined" label={`${bar.num_colours} col`} />
          ) : null}
        </Stack>
        {bar.warnings?.length ? (
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {bar.warnings.slice(0, 2).map((w) => (
              <li key={w}>
                <Typography variant="caption" color="warning.main">
                  {w}
                </Typography>
              </li>
            ))}
          </Box>
        ) : null}
      </Stack>
      {showToolStrips ? (
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            display: 'flex',
            zIndex: 2,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
            overflow: 'hidden',
          }}
          aria-label="Required extrusion tools"
        >
          {bar.tool_strips!.map((s) => (
            <Box
              key={s.tool_type_code}
              title={`${s.name}${s.tool_serial ? ` · ${s.tool_serial}` : ''}`}
              sx={{
                flex: 1,
                minWidth: 6,
                bgcolor: s.color,
                opacity: 0.95,
              }}
            />
          ))}
        </Box>
      ) : null}
    </Paper>
  )
})

type SortableProps = {
  laneMachineId: string
  bar: GanttBarModel
  calendarStartMs: number
  pxPerHour: number
  machineType?: string
  onSelectJob?: (jobId: string) => void
}

export const GanttSortableBar = memo(function GanttSortableBar({
  laneMachineId,
  bar,
  calendarStartMs,
  pxPerHour,
  machineType,
  onSelectJob,
}: SortableProps) {
  const id = ganttBarId(laneMachineId, bar.job_id)
  const running = bar.status === 'running'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: running,
    animateLayoutChanges: () => false,
  })

  const startMs = bar.tentative_start ? new Date(bar.tentative_start).getTime() : calendarStartMs
  const left = Math.max(0, ((startMs - calendarStartMs) / 3600000) * pxPerHour)
  const widthPx = Math.max(40, bar.estimated_duration_hours * pxPerHour)

  const style = {
    position: 'absolute' as const,
    left,
    top: 8,
    width: widthPx,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 1,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Box ref={setNodeRef} sx={style} {...attributes} {...listeners}>
      <GanttBarContent
        bar={bar}
        widthPx={widthPx}
        machineType={machineType}
        onClick={(e) => {
          if (isDragging) return
          e.stopPropagation()
          onSelectJob?.(bar.job_id)
        }}
      />
    </Box>
  )
})

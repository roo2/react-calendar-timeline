import { useDroppable } from '@dnd-kit/core'
import { Box, Typography } from '@mui/material'
import { memo } from 'react'
import type { GanttLane } from '../../../store/slices/scheduleSlice'
import { ganttBarId, laneEmptyId } from '../ganttIds'
import { useExtrusionHourDropActive } from '../useExtrusionHourDropActive'
import { ExtrusionHourDropLayer } from './ExtrusionHourDropLayer'

/** Must match GanttBoard machine label column width for sticky alignment. */
const MACHINE_LABEL_COL_PX = 140

type Props = {
  lane: GanttLane
  itemIds: string[]
  calendarStartMs: number
  pxPerHour: number
  timelineWidthPx: number
  /** Set of extruder `machine_id` values; stable reference from parent. */
  extruderMachineIds: ReadonlySet<string>
  onSelectJob?: (jobId: string) => void
}

function HourGrid({
  calendarStartMs,
  totalHours,
  pxPerHour,
  widthPx,
}: {
  calendarStartMs: number
  totalHours: number
  pxPerHour: number
  widthPx: number
}) {
  const h = Math.ceil(totalHours)
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        width: widthPx,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {Array.from({ length: h + 1 }, (_, i) => {
        const x = i * pxPerHour
        const cur = new Date(calendarStartMs + i * 3600000)
        const prev = i > 0 ? new Date(calendarStartMs + (i - 1) * 3600000) : null
        const isDayBoundary = prev != null && cur.getDate() !== prev.getDate()
        const isSixHour = i > 0 && i % 6 === 0 && !isDayBoundary
        return (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              left: x,
              top: 0,
              bottom: 0,
              borderLeft: isDayBoundary ? '2px solid' : isSixHour ? '1px solid' : '1px dashed',
              borderColor: isDayBoundary ? 'divider' : 'action.hover',
              opacity: isDayBoundary ? 0.55 : isSixHour ? 0.35 : 0.2,
            }}
          />
        )
      })}
    </Box>
  )
}

export const GanttLaneRow = memo(function GanttLaneRow({
  lane,
  itemIds,
  calendarStartMs,
  pxPerHour,
  timelineWidthPx,
  extruderMachineIds,
  onSelectJob,
}: Props) {
  const hourDropActive = useExtrusionHourDropActive(extruderMachineIds)
  const useHourGrid = lane.machine_type === 'extruder' && hourDropActive
  const { setNodeRef, isOver } = useDroppable({
    id: laneEmptyId(lane.machine_id),
    data: { type: 'lane-empty', machineId: lane.machine_id },
    disabled: useHourGrid,
  })

  const totalHours = timelineWidthPx / pxPerHour

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'stretch',
        gap: 1,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        minWidth: { xs: '100%', sm: `${MACHINE_LABEL_COL_PX + timelineWidthPx}px` },
      }}
    >
      <Box
        sx={{
          py: 0.5,
          width: { xs: '100%', sm: MACHINE_LABEL_COL_PX },
          flexShrink: 0,
          position: { sm: 'sticky' },
          left: { sm: 0 },
          zIndex: { sm: 3 },
          bgcolor: 'background.paper',
          borderRight: { sm: 1 },
          borderColor: 'divider',
          pr: { sm: 1 },
          boxSizing: 'border-box',
        }}
      >
        <Typography variant="subtitle2">{lane.machine_code}</Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {lane.machine_type.replace(/_/g, ' ')}
        </Typography>
        {lane.machine_type === 'extruder' &&
        lane.film_width_min_mm != null &&
        lane.film_width_max_mm != null ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            Film width: {lane.film_width_min_mm}–{lane.film_width_max_mm} mm
          </Typography>
        ) : null}
      </Box>

      {/* <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}> */}
        <Box
          ref={setNodeRef}
          sx={{
            position: 'relative',
            width: timelineWidthPx,
            minWidth: timelineWidthPx,
            minHeight: 112,
            flexShrink: 0,
            borderRadius: 1,
            border: '1px dashed',
            borderColor: isOver ? 'primary.main' : 'action.hover',
            bgcolor: isOver ? 'action.hover' : 'background.default',
            transition: 'border-color 0.15s, background-color 0.15s',
            overflow: 'hidden',
          }}
        >
          <HourGrid
            calendarStartMs={calendarStartMs}
            totalHours={totalHours}
            pxPerHour={pxPerHour}
            widthPx={timelineWidthPx}
          />
          {lane.machine_type === 'extruder' ? (
            <ExtrusionHourDropLayer
              machineId={lane.machine_id}
              timelineWidthPx={timelineWidthPx}
              pxPerHour={pxPerHour}
              extruderMachineIds={extruderMachineIds}
            />
          ) : null}
          {lane.bars.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                position: 'relative',
                zIndex: 1,
                p: 2,
                pointerEvents: useHourGrid ? 'none' : 'auto',
              }}
            >
              Drop unqueued jobs here (extruders) or reorder queued work along the timeline.
            </Typography>
          ) : null}
          {/* {lane.bars.map((bar) => (
            <GanttSortableBar
              key={ganttBarId(lane.machine_id, bar.job_id)}
              laneMachineId={lane.machine_id}
              bar={bar}
              calendarStartMs={calendarStartMs}
              pxPerHour={pxPerHour}
              machineType={lane.machine_type}
              onSelectJob={onSelectJob}
            />
          ))} */}
        </Box>
      {/* </SortableContext> */}
    </Box>
  )
})

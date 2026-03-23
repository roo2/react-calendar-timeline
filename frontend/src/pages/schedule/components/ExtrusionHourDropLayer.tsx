import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Box } from '@mui/material'
import { laneSlotId } from '../ganttIds'
import { useExtrusionHourDropActive } from '../useExtrusionHourDropActive'

const HourCell = memo(function HourCell({
  machineId,
  hourIndex,
  widthPx,
  enabled,
}: {
  machineId: string
  hourIndex: number
  widthPx: number
  enabled: boolean
}) {
  const id = laneSlotId(machineId, hourIndex)
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'lane-slot', machineId, hourIndex },
    disabled: !enabled,
  })

  return (
    <Box
      ref={setNodeRef}
      sx={{
        width: widthPx,
        minWidth: widthPx,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: isOver && enabled ? 'primary.light' : 'transparent',
        opacity: enabled ? 0.14 : 0,
        transition: 'background-color 0.12s',
      }}
    />
  )
})

type Props = {
  machineId: string
  timelineWidthPx: number
  pxPerHour: number
  /** Extruder `machine_id`s; used with DndContext to enable hour slots only while dragging pool/extruder bars. */
  extruderMachineIds: ReadonlySet<string>
}

/** One droppable column per wall-clock hour on the advisory timeline (extruders only). */
export const ExtrusionHourDropLayer = memo(function ExtrusionHourDropLayer({
  machineId,
  timelineWidthPx,
  pxPerHour,
  extruderMachineIds,
}: Props) {
  const hourDropEnabled = useExtrusionHourDropActive(extruderMachineIds)
  const n = Math.max(1, Math.ceil(timelineWidthPx / pxPerHour))
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        zIndex: 0,
        pointerEvents: hourDropEnabled ? 'auto' : 'none',
      }}
    >
      {hourDropEnabled
        ? Array.from({ length: n }, (_, h) => (
            <HourCell
              key={h}
              machineId={machineId}
              hourIndex={h}
              widthPx={pxPerHour}
              enabled
            />
          ))
        : null}
    </Box>
  )
})

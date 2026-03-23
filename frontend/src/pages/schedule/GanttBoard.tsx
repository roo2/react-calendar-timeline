import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  addJobToScheduleQueue,
  clearScheduleMutationError,
  fetchScheduleGantt,
  fetchUnqueuedScheduleJobs,
  moveScheduleBar,
  removeJobFromScheduleQueue,
  reorderScheduleLane,
  type GanttBar,
  type GanttLane,
} from '../../store/slices/scheduleSlice'
import {
  ganttBarId,
  parseGanttBarId,
  parseLaneEmptyId,
  parseLaneSlotId,
  parsePoolJobId,
  SCHEDULE_UNQUEUED_ZONE_ID,
} from './ganttIds'
import { ExtrusionToolboxRow } from './components/ExtrusionToolboxRow'
import { GanttLaneRow } from './components/GanttLaneRow'
import { GanttBarContent } from './components/GanttSortableBar'
import { GanttTimeRuler } from './components/GanttTimeRuler'
import { SelectedJobPanel } from './components/SelectedJobPanel'
import { UnqueuedJobsPanel } from './components/UnqueuedJobsPanel'
import { createScheduleCollisionDetection } from './scheduleCollisionDetection'

const MACHINE_LABEL_COL_PX = 140
const PX_PER_HOUR = 40
/** Limit hour columns / droppables; full advisory dates still shown above. Increase to debug wider windows. */
const MAX_VISIBLE_TIMELINE_DAYS = 1
const ZOOM_MIN = 0.12
const ZOOM_MAX = 3.5
const ZOOM_STEP = 1.12

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

function containerOfItem(itemsByLane: Record<string, string[]>, itemId: string): string | null {
  for (const [mid, ids] of Object.entries(itemsByLane)) {
    if (ids.includes(itemId)) return mid
  }
  return null
}

function machineType(lanes: GanttLane[], machineId: string): string | undefined {
  return lanes.find((l) => l.machine_id === machineId)?.machine_type
}

function canMoveBetweenLanes(lanes: GanttLane[], fromId: string, toId: string): boolean {
  const a = machineType(lanes, fromId)
  const b = machineType(lanes, toId)
  return a === 'extruder' && b === 'extruder'
}

function orderedLaneState(lane: GanttLane, itemsByLane: Record<string, string[]>) {
  const ids =
    itemsByLane[lane.machine_id] ?? lane.bars.map((b) => ganttBarId(lane.machine_id, b.job_id))
  const jobOrder = new Map(lane.bars.map((b, i) => [b.job_id, i]))
  const orderedBars = [...lane.bars].sort((a, b) => {
    const ia = ids.indexOf(ganttBarId(lane.machine_id, a.job_id))
    const ib = ids.indexOf(ganttBarId(lane.machine_id, b.job_id))
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0) return -1
    if (ib >= 0) return 1
    return (jobOrder.get(a.job_id) ?? 0) - (jobOrder.get(b.job_id) ?? 0)
  })
  return { laneOrdered: { ...lane, bars: orderedBars } as GanttLane, itemIds: ids }
}

export function GanttBoard() {
  const dispatch = useAppDispatch()
  const gantt = useAppSelector((s) => s.schedule.gantt)
  const unqueued = useAppSelector((s) => s.schedule.unqueued)
  const mutation = useAppSelector((s) => s.schedule.mutation)
  const lanes = gantt.data?.lanes ?? []
  const calendar = gantt.data?.calendar

  const [itemsByLane, setItemsByLane] = useState<Record<string, string[]>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const ganttScrollRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ px: number; py: number; sl: number; st: number } | null>(null)

  const pxPerHour = PX_PER_HOUR * zoom

  const barByKey = useMemo(() => {
    const m = new Map<string, GanttBar>()
    for (const lane of lanes) {
      for (const b of lane.bars) {
        m.set(ganttBarId(lane.machine_id, b.job_id), b)
      }
    }
    return m
  }, [lanes])

  const { extruderLanes, otherLanes } = useMemo(() => {
    const ex: GanttLane[] = []
    const o: GanttLane[] = []
    for (const l of lanes) {
      if (l.machine_type === 'extruder') ex.push(l)
      else o.push(l)
    }
    return { extruderLanes: ex, otherLanes: o }
  }, [lanes])

  const activeDragMachineType = useMemo(() => {
    if (!activeId) return undefined
    const p = parseGanttBarId(activeId)
    if (!p) return undefined
    return lanes.find((l) => l.machine_id === p.machineId)?.machine_type
  }, [activeId, lanes])

  const extruderMachineIdSet = useMemo(
    () => new Set(extruderLanes.map((l) => l.machine_id)),
    [extruderLanes],
  )

  const scheduleCollisionDetection = useMemo(
    () => createScheduleCollisionDetection(extruderMachineIdSet),
    [extruderMachineIdSet],
  )

  const extruderLaneSnapshots = useMemo(
    () => extruderLanes.map((lane) => ({ key: lane.machine_id, ...orderedLaneState(lane, itemsByLane) })),
    [extruderLanes, itemsByLane],
  )

  const otherLaneSnapshots = useMemo(
    () => otherLanes.map((lane) => ({ key: lane.machine_id, ...orderedLaneState(lane, itemsByLane) })),
    [otherLanes, itemsByLane],
  )

  const calendarStartMs = useMemo(() => {
    if (calendar?.start) return new Date(calendar.start).getTime()
    return Date.now()
  }, [calendar?.start])

  const calendarEndMs = useMemo(() => {
    if (calendar?.end) return new Date(calendar.end).getTime()
    return calendarStartMs + 96 * 3600000
  }, [calendar?.end, calendarStartMs])

  const fullRangeHours = Math.max(1, (calendarEndMs - calendarStartMs) / 3600000)
  const maxVisibleHours = MAX_VISIBLE_TIMELINE_DAYS * 24
  const totalHours = Math.min(fullRangeHours, maxVisibleHours)
  const timelineWidthPx = Math.max(Math.ceil(totalHours * pxPerHour), 320)

  useEffect(() => {
    if (!lanes.length) {
      setItemsByLane({})
      return
    }
    const next: Record<string, string[]> = {}
    for (const l of lanes) {
      next[l.machine_id] = l.bars.map((b) => ganttBarId(l.machine_id, b.job_id))
    }
    setItemsByLane(next)
  }, [lanes])

  useEffect(() => {
    void dispatch(fetchScheduleGantt())
    void dispatch(fetchUnqueuedScheduleJobs())
  }, [dispatch])

  /** Prevent page-level vertical scroll / scrollbar while dragging schedule items. */
  useEffect(() => {
    if (!activeId) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeId])

  /** Ctrl/Cmd + wheel: zoom. Shift + wheel: horizontal scroll. Must be non-passive to allow preventDefault. */
  useEffect(() => {
    const el = ganttScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
        setZoom((z) => clampZoom(z * factor))
        return
      }
      if (e.shiftKey) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gantt.data, lanes.length])

  /** Keep horizontal scroll position proportional when zoom changes (buttons / programmatic). */
  useEffect(() => {
    const el = ganttScrollRef.current
    if (!el) return
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    if (maxScroll <= 0) return
    const ratio = el.scrollLeft / maxScroll
    requestAnimationFrame(() => {
      const nextMax = Math.max(0, el.scrollWidth - el.clientWidth)
      el.scrollLeft = ratio * nextMax
    })
  }, [zoom, timelineWidthPx])

  const onGanttPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.altKey || e.button === 1)) return
    const el = ganttScrollRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    panRef.current = { px: e.clientX, py: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    el.setPointerCapture(e.pointerId)
    setIsPanning(true)
  }, [])

  const onGanttPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return
    const el = ganttScrollRef.current
    if (!el) return
    const { px, py, sl, st } = panRef.current
    el.scrollLeft = sl - (e.clientX - px)
    el.scrollTop = st - (e.clientY - py)
  }, [])

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return
    const el = ganttScrollRef.current
    try {
      el?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    panRef.current = null
    setIsPanning(false)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeBar = activeId ? barByKey.get(activeId) ?? null : null
  const activePoolJob = useMemo(() => {
    if (!activeId) return null
    const jid = parsePoolJobId(activeId)
    if (!jid) return null
    return unqueued.jobs.find((j) => j.job_id === jid) ?? null
  }, [activeId, unqueued.jobs])

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      setActiveId(String(e.active.id))
      dispatch(clearScheduleMutationError())
    },
    [dispatch],
  )

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e
      const activeKey = String(active.id)
      setActiveId(null)
      if (!over) return

      const overKey = String(over.id)
      const slot = parseLaneSlotId(overKey)
      const poolJobId = parsePoolJobId(activeKey)
      const activeBarParsed = parseGanttBarId(activeKey)
      const activeBarLocal = activeBarParsed ? (barByKey.get(activeKey) ?? null) : null

      const targetIsoForSlotHour = (hourIndex: number) =>
        new Date(calendarStartMs + hourIndex * 3600000).toISOString()

      if (overKey === SCHEDULE_UNQUEUED_ZONE_ID && activeBarParsed && activeBarLocal) {
        if (activeBarLocal.status === 'running') return
        if (machineType(lanes, activeBarParsed.machineId) !== 'extruder') {
          window.alert('Only extrusion jobs can be moved back to unqueued.')
          return
        }
        try {
          await dispatch(
            removeJobFromScheduleQueue({
              machine_id: activeBarParsed.machineId,
              job_id: activeBarParsed.jobId,
            }),
          ).unwrap()
        } catch {
          /* mutation.error */
        }
        return
      }

      if (slot && poolJobId) {
        if (machineType(lanes, slot.machineId) !== 'extruder') {
          window.alert('Drag unqueued jobs onto an extruder only.')
          return
        }
        try {
          await dispatch(
            addJobToScheduleQueue({
              machine_id: slot.machineId,
              job_id: poolJobId,
              target_start: targetIsoForSlotHour(slot.hourIndex),
            }),
          ).unwrap()
        } catch {
          /* mutation.error */
        }
        return
      }

      if (slot && activeBarParsed && activeBarLocal) {
        if (activeBarLocal.status === 'running') return
        if (machineType(lanes, activeBarParsed.machineId) !== 'extruder') return
        if (machineType(lanes, slot.machineId) !== 'extruder') return
        if (
          activeBarParsed.machineId !== slot.machineId &&
          !canMoveBetweenLanes(lanes, activeBarParsed.machineId, slot.machineId)
        ) {
          window.alert('Only extrusion jobs can be moved between extruder lanes (per scheduling rules).')
          return
        }
        try {
          await dispatch(
            moveScheduleBar({
              job_id: activeBarParsed.jobId,
              operation_type: activeBarLocal.operation_type,
              target_machine_id: slot.machineId,
              target_position: 1,
              target_start: targetIsoForSlotHour(slot.hourIndex),
            }),
          ).unwrap()
        } catch {
          /* mutation.error */
        }
        return
      }

      if (poolJobId) {
        const emptyMid = parseLaneEmptyId(overKey)
        const overBar = parseGanttBarId(overKey)
        let targetMachineId: string | null = null
        let position = 1

        if (emptyMid) {
          targetMachineId = emptyMid
          const n = itemsByLane[emptyMid]?.length ?? 0
          position = n + 1
        } else if (overBar) {
          targetMachineId = overBar.machineId
          const laneIds = itemsByLane[targetMachineId] ?? []
          const overIdx = laneIds.indexOf(overKey)
          position = overIdx >= 0 ? overIdx + 1 : laneIds.length + 1
        }

        if (!targetMachineId || machineType(lanes, targetMachineId) !== 'extruder') {
          window.alert('Drag unqueued jobs onto an extruder lane only.')
          return
        }

        try {
          await dispatch(
            addJobToScheduleQueue({
              machine_id: targetMachineId,
              job_id: poolJobId,
              position,
            }),
          ).unwrap()
        } catch {
          /* mutation.error */
        }
        return
      }

      const activeContainer = containerOfItem(itemsByLane, activeKey)
      if (!activeContainer) return

      if (!activeBarLocal || !activeBarParsed) return

      if (activeBarLocal.status === 'running') return

      let overContainer: string | null = null
      let overIndex = 0

      const emptyMid = parseLaneEmptyId(overKey)
      if (emptyMid) {
        overContainer = emptyMid
        overIndex = 0
      } else {
        overContainer = containerOfItem(itemsByLane, overKey)
        if (!overContainer) return
        overIndex = itemsByLane[overContainer].indexOf(overKey)
        if (overIndex < 0) return
      }

      if (activeContainer === overContainer) {
        const laneIds = [...itemsByLane[activeContainer]]
        const oldIndex = laneIds.indexOf(activeKey)
        if (oldIndex < 0) return

        let reordered: string[]
        if (emptyMid === activeContainer) {
          if (oldIndex === 0) return
          reordered = arrayMove(laneIds, oldIndex, 0)
        } else {
          const newIndex = laneIds.indexOf(overKey)
          if (oldIndex === newIndex) return
          reordered = arrayMove(laneIds, oldIndex, newIndex)
        }

        const newPosition = reordered.indexOf(activeKey) + 1
        const prev = { ...itemsByLane }
        setItemsByLane((s) => ({ ...s, [activeContainer]: reordered }))
        try {
          await dispatch(
            reorderScheduleLane({
              machine_id: activeContainer,
              job_id: activeBarParsed.jobId,
              new_position: newPosition,
            }),
          ).unwrap()
        } catch {
          setItemsByLane(prev)
        }
        return
      }

      if (!canMoveBetweenLanes(lanes, activeContainer, overContainer)) {
        window.alert('Only extrusion jobs can be moved between extruder lanes (per scheduling rules).')
        return
      }

      const sourceIds = itemsByLane[activeContainer].filter((id) => id !== activeKey)
      const targetIds = [...itemsByLane[overContainer]]
      targetIds.splice(overIndex, 0, activeKey)
      const newPosition = targetIds.indexOf(activeKey) + 1

      const prev = { ...itemsByLane }
      setItemsByLane({
        ...itemsByLane,
        [activeContainer]: sourceIds,
        [overContainer]: targetIds,
      })

      try {
        await dispatch(
          moveScheduleBar({
            job_id: activeBarParsed.jobId,
            operation_type: activeBarLocal.operation_type,
            target_machine_id: overContainer,
            target_position: newPosition,
          }),
        ).unwrap()
      } catch {
        setItemsByLane(prev)
      }
    },
    [barByKey, calendarStartMs, dispatch, itemsByLane, lanes],
  )

  if (gantt.status === 'loading' && !gantt.data) {
    return (
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (gantt.status === 'failed' && !gantt.data) {
    return (
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Alert severity="error">{gantt.error || 'Failed to load schedule'}</Alert>
      </Box>
    )
  }

  return (
    <Stack
      spacing={1.5}
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {unqueued.status === 'failed' && unqueued.error ? (
        <Alert severity="warning" sx={{ flexShrink: 0 }}>
          {unqueued.error}
        </Alert>
      ) : null}

      {mutation.error ? (
        <Alert severity="error" sx={{ flexShrink: 0 }}>
          {mutation.error}
        </Alert>
      ) : null}
      {mutation.status === 'loading' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">Saving…</Typography>
        </Box>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={scheduleCollisionDetection}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={(ev) => {
          void onDragEnd(ev)
        }}
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: { xs: 'column', lg: 'row' },
            alignItems: 'stretch',
            gap: 2,
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <Box
            sx={{
              width: { xs: '100%', lg: 300 },
              minWidth: 0,
              flex: { xs: '0 0 auto', lg: '0 0 auto' },
              height: { xs: 'min(42dvh, 380px)', lg: '100%' },
              maxHeight: { xs: 'min(42dvh, 380px)', lg: 'none' },
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              alignSelf: 'stretch',
              borderRight: { lg: 1 },
              borderColor: 'divider',
              pr: { lg: 1.5 },
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            <UnqueuedJobsPanel fillColumn jobs={unqueued.jobs} onSelectJob={setSelectedJobId} />
            <Box
              sx={{
                flexShrink: 0,
                mt: { lg: 'auto' },
                maxHeight: { xs: '42%', lg: '48%' },
                minHeight: 0,
                overflow: 'auto',
              }}
            >
              <SelectedJobPanel
                jobId={selectedJobId}
                lanes={lanes}
                unqueuedJobs={unqueued.jobs}
                onClear={() => setSelectedJobId(null)}
              />
            </Box>
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
                columnGap: 2,
              }}
            >
              <Typography variant="subtitle2" sx={{ mr: 1 }}>
                Timeline
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}
                aria-label="Zoom out"
              >
                −
              </Button>
              <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}
                aria-label="Zoom in"
              >
                +
              </Button>
              <Button size="small" variant="text" onClick={() => setZoom(1)}>
                Reset zoom
              </Button>
            </Box>

            <Box
              ref={ganttScrollRef}
              // onPointerDownCapture={onGanttPointerDownCapture}
              // onPointerMove={onGanttPointerMove}
              // onPointerUp={endPan}
              // onPointerCancel={endPan}
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.default',
                cursor: isPanning ? 'grabbing' : 'default',
              }}
            >
              <Box
                sx={{
                  minWidth: { xs: timelineWidthPx, sm: MACHINE_LABEL_COL_PX + timelineWidthPx + 16 },
                  pb: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: 'flex-start',
                    columnGap: 1,
                    position: 'sticky',
                    top: 0,
                    zIndex: 5,
                    bgcolor: 'background.paper',
                    boxShadow: (theme) => `0 2px 6px -1px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)'}`,
                  }}
                >
                  <Box
                    sx={{
                      width: { xs: 0, sm: MACHINE_LABEL_COL_PX },
                      flexShrink: 0,
                      display: { xs: 'none', sm: 'block' },
                      alignSelf: 'stretch',
                      minHeight: 44,
                      bgcolor: 'background.paper',
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  />
                  <GanttTimeRuler
                    calendarStartMs={calendarStartMs}
                    totalHours={totalHours}
                    pxPerHour={pxPerHour}
                    widthPx={timelineWidthPx}
                  />
                </Box>

                <Box>
                  {extruderLaneSnapshots.map(({ key, laneOrdered, itemIds }) => (
                    <GanttLaneRow
                      key={key}
                      lane={laneOrdered}
                      itemIds={itemIds}
                      calendarStartMs={calendarStartMs}
                      pxPerHour={pxPerHour}
                      timelineWidthPx={timelineWidthPx}
                      extruderMachineIds={extruderMachineIdSet}
                      // onSelectJob={setSelectedJobId}
                    />
                  ))}
                  <ExtrusionToolboxRow toolbox={gantt.data?.extrusion_toolbox} timelineWidthPx={timelineWidthPx} />
                  {/* {otherLaneSnapshots.map(({ key, laneOrdered, itemIds }) => (
                    <GanttLaneRow
                      key={key}
                      lane={laneOrdered}
                      itemIds={itemIds}
                      calendarStartMs={calendarStartMs}
                      pxPerHour={pxPerHour}
                      timelineWidthPx={timelineWidthPx}
                      extruderMachineIds={extruderMachineIdSet}
                      onSelectJob={setSelectedJobId}
                    />
                  ))} */}
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        <DragOverlay dropAnimation={null}>
          {activeBar ? (
            <Box sx={{ opacity: 0.95, pointerEvents: 'none', boxShadow: 3 }}>
              <GanttBarContent bar={activeBar} machineType={activeDragMachineType} />
            </Box>
          ) : activePoolJob ? (
            <Box sx={{ opacity: 0.95, pointerEvents: 'none', boxShadow: 3, width: 220 }}>
              <Paper variant="outlined" sx={{ p: 1 }}>
                <Typography variant="subtitle2" noWrap>
                  {activePoolJob.job_code}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {activePoolJob.customer}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activePoolJob.roll_count} roll{activePoolJob.roll_count === 1 ? '' : 's'}
                </Typography>
              </Paper>
            </Box>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Stack>
  )
}

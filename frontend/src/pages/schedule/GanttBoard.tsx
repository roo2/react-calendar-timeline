import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import Timeline, { CustomMarker, TimelineMarkers, TodayMarker, calendarUtils } from 'react-calendar-timeline'
import 'react-calendar-timeline/style.css'
import './ganttTimeline.css'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  addJobToScheduleQueue,
  clearScheduleMutationError,
  clearScheduleUnqueuedError,
  fetchScheduleGantt,
  fetchUnqueuedScheduleJobs,
  moveScheduleBar,
  removeJobFromScheduleQueue,
  type GanttLane,
  type UnqueuedScheduleJob,
} from '../../store/slices/scheduleSlice'
import { SelectedJobPanel } from './components/SelectedJobPanel'

const SIDEBAR_WIDTH = 160
const HOUR_MS = 3600000
/** Must match `buffer` on `<Timeline />` (library canvas width = viewport × buffer). */
const TIMELINE_BUFFER = 2
/** Synthetic row id so the unqueued drop ghost is not treated as a real job. */
const UNQUEUED_DROP_PREVIEW_ITEM_ID = '__unqueued_drop_preview__'

function previewDurationMsForUnqueuedJob(job: UnqueuedScheduleJob): number {
  const rolls = Math.max(1, job.roll_count || 1)
  return Math.max(HOUR_MS, rolls * HOUR_MS)
}

/**
 * Match react-calendar-timeline’s internal drag math (offsetParent chain + cumulative parent scroll)
 * so HTML5 drops call `calculateDropCoordinatesToTimeAndGroup` with the same Y the library uses for items.
 */
function offsetParentOffset(el: HTMLElement): { left: number; top: number } {
  if (el === document.body || !el.offsetParent) return { left: 0, top: 0 }
  const p = offsetParentOffset(el.offsetParent as HTMLElement)
  return { left: el.offsetLeft + p.left, top: el.offsetTop + p.top }
}

function cumulativeScrollOffset(el: Node | null): { left: number; top: number } {
  if (!el || el === document.body) return { left: 0, top: 0 }
  const p = cumulativeScrollOffset(el.parentNode)
  if (el instanceof HTMLElement) {
    return { left: el.scrollLeft + p.left, top: el.scrollTop + p.top }
  }
  return p
}

type MsInterval = { start: number; end: number }

/** Fallback canvas before first `getTimelineContext()` (same buffer math as Timeline). */
function canvasBoundsFromDefaultRange(visibleStartMs: number, visibleEndMs: number, buffer: number) {
  const span = visibleEndMs - visibleStartMs
  const canvasStart = visibleStartMs - (span * (buffer - 1)) / 2
  const canvasEnd = canvasStart + span * buffer
  return { canvasTimeStart: canvasStart, canvasTimeEnd: canvasEnd }
}

/**
 * Closed-hours band: CustomMarker only mounts when `date` lies on the canvas; we pass the first ms of the
 * overlap. Width/left come from live `getTimelineContext` + calculateXPositionForTime so scroll/zoom stay aligned.
 */
function InactiveClosedBandMarker({
  interval: inv,
  anchorMs,
  timelineRef,
}: {
  interval: MsInterval
  anchorMs: number
  timelineRef: RefObject<any>
}) {
  return (
    <CustomMarker date={anchorMs}>
      {({ styles }) => {
        const inst = timelineRef.current
        const ctx = inst?.getTimelineContext?.()
        if (!ctx || ctx.canvasWidth <= 0) {
          return <div style={{ ...styles, visibility: 'hidden', width: 0, pointerEvents: 'none' }} aria-hidden />
        }
        const { canvasTimeStart: cs, canvasTimeEnd: ce, canvasWidth: cw } = ctx
        const lo = Math.max(inv.start, cs)
        const hi = Math.min(inv.end, ce)
        if (hi <= lo) {
          return <div style={{ ...styles, visibility: 'hidden', width: 0, pointerEvents: 'none' }} aria-hidden />
        }
        const x0 = calendarUtils.calculateXPositionForTime(cs, ce, cw, lo)
        const x1 = calendarUtils.calculateXPositionForTime(cs, ce, cw, hi)
        const w = Math.max(1, x1 - x0)
        return (
          <div
            style={{
              ...styles,
              left: x0,
              width: w,
              backgroundColor: 'rgba(100, 100, 120, 0.22)',
              pointerEvents: 'none',
              zIndex: 15,
            }}
            aria-hidden
          />
        )
      }}
    </CustomMarker>
  )
}

type TimelineGroup = {
  id: string
  title: string
  machineType: string
}

type TimelineItem = {
  id: string
  group: string
  title: string
  start_time: number
  end_time: number
  canMove: boolean
  canResize: false
  itemProps?: {
    style?: React.CSSProperties
  }
}

export function GanttBoard() {
  const dispatch = useAppDispatch()
  const gantt = useAppSelector((s) => s.schedule.gantt)
  const unqueued = useAppSelector((s) => s.schedule.unqueued)
  const mutation = useAppSelector((s) => s.schedule.mutation)
  const lanes = gantt.data?.lanes ?? []
  const calendar = gantt.data?.calendar

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  /** HTML5 drag from unqueued list — `getData` is unavailable during `dragOver`, so we track id in state. */
  const [externalDragUnqueuedJobId, setExternalDragUnqueuedJobId] = useState<string | null>(null)
  const [unqueuedDropPreview, setUnqueuedDropPreview] = useState<{
    startMs: number
    endMs: number
    groupIndex: number
    invalidLane: boolean
  } | null>(null)
  const timelineRef = useRef<any>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollViewportWidth, setScrollViewportWidth] = useState(0)
  /** Live canvas metrics: drives inactive CustomMarker anchor dates + scroll/zoom sync. */
  const [overlayMetrics, setOverlayMetrics] = useState<{
    canvasTimeStart: number
    canvasTimeEnd: number
    canvasWidth: number
  } | null>(null)

  const barByJobId = useMemo(() => {
    const m = new Map<string, { bar: GanttLane['bars'][number]; lane: GanttLane }>()
    for (const lane of lanes) {
      for (const bar of lane.bars) m.set(String(bar.job_id), { bar, lane })
    }
    return m
  }, [lanes])

  const groups = useMemo<TimelineGroup[]>(() => {
    return lanes.map((lane) => ({
      id: lane.machine_id,
      title: lane.machine_code,
      machineType: lane.machine_type,
    }))
  }, [lanes])

  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = []
    const now = Date.now()
    for (const lane of lanes) {
      for (const bar of lane.bars) {
        const startMs = bar.tentative_start ? new Date(bar.tentative_start).getTime() : now
        const durationMs = Math.max(HOUR_MS, Math.round((bar.estimated_duration_hours || 1) * HOUR_MS))
        const endMs = bar.tentative_finish ? new Date(bar.tentative_finish).getTime() : startMs + durationMs
        out.push({
          id: String(bar.job_id),
          group: lane.machine_id,
          title: `${bar.job_code} · ${bar.customer}`,
          start_time: startMs,
          end_time: Math.max(startMs + HOUR_MS, endMs),
          canMove: bar.status !== 'running',
          canResize: false,
          itemProps: {
            style: {
              background: bar.status === 'running' ? '#e8f5e9' : '#e3f2fd',
              border: `1px solid ${bar.readiness === 'blocked' ? '#f57c00' : '#90caf9'}`,
              color: '#0d1b2a',
              borderRadius: '6px',
              fontSize: '0.8rem',
            },
          },
        })
      }
    }
    return out
  }, [lanes])

  const externalDragUnqueuedJob = useMemo(
    () => unqueued.jobs.find((j) => String(j.job_id) === externalDragUnqueuedJobId) ?? null,
    [unqueued.jobs, externalDragUnqueuedJobId],
  )

  const itemsWithUnqueuedPreview = useMemo(() => {
    if (
      !externalDragUnqueuedJob ||
      !unqueuedDropPreview ||
      unqueuedDropPreview.groupIndex < 0 ||
      unqueuedDropPreview.groupIndex >= groups.length
    ) {
      return items
    }
    const g = groups[unqueuedDropPreview.groupIndex]
    if (!g) return items
    const invalid = unqueuedDropPreview.invalidLane
    const ghost: TimelineItem = {
      id: UNQUEUED_DROP_PREVIEW_ITEM_ID,
      group: g.id,
      title: `${externalDragUnqueuedJob.job_code} · drop here`,
      start_time: unqueuedDropPreview.startMs,
      end_time: unqueuedDropPreview.endMs,
      canMove: false,
      canResize: false,
      itemProps: {
        style: {
          opacity: 0.5,
          background: invalid ? 'rgba(211, 47, 47, 0.2)' : 'rgba(25, 118, 210, 0.22)',
          border: invalid ? '2px dashed #c62828' : '2px dashed #1976d2',
          color: '#0d1b2a',
          borderRadius: '6px',
          fontSize: '0.75rem',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.4) inset',
          pointerEvents: 'none',
        },
      },
    }
    return [...items, ghost]
  }, [items, externalDragUnqueuedJob, unqueuedDropPreview, groups])

  const endExternalUnqueuedDrag = useCallback(() => {
    setExternalDragUnqueuedJobId(null)
    setUnqueuedDropPreview(null)
  }, [])

  /**
   * Uncontrolled Timeline defaults: local midnight today → Unix epoch ms, end from API window / fallback span.
   * Locked after the first successful gantt payload so refetches do not change defaults: the API moves
   * `calendar.end` with `now` every time, which would otherwise change this every save and remount the
   * Timeline (resetting zoom/scroll).
   */
  const [lockedTimelineDefaults, setLockedTimelineDefaults] = useState<{
    defaultTimeStartMs: number
    defaultTimeEndMs: number
  } | null>(null)

  const computedTimelineDefaults = useMemo(() => {
    const start = dayjs().startOf('day').valueOf()
    let end = start + 96 * HOUR_MS
    if (calendar?.end) {
      const apiEnd = new Date(calendar.end).getTime()
      if (apiEnd > start) end = Math.max(end, apiEnd)
    }
    return { defaultTimeStartMs: start, defaultTimeEndMs: end }
  }, [calendar?.end])

  useLayoutEffect(() => {
    if (!gantt.data) return
    setLockedTimelineDefaults((prev) => prev ?? computedTimelineDefaults)
  }, [gantt.data, computedTimelineDefaults])

  const defaultTimeStartMs = lockedTimelineDefaults?.defaultTimeStartMs ?? computedTimelineDefaults.defaultTimeStartMs
  const defaultTimeEndMs = lockedTimelineDefaults?.defaultTimeEndMs ?? computedTimelineDefaults.defaultTimeEndMs

  /** Factory inactive wall spans (UTC) → ms for overlay shading */
  const inactiveIntervalsMs = useMemo(() => {
    const raw = calendar?.inactive_intervals ?? []
    return raw
      .map(({ start, end }) => ({
        start: new Date(start).getTime(),
        end: new Date(end).getTime(),
      }))
      .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
      .sort((a, b) => a.start - b.start)
  }, [calendar?.inactive_intervals])

  const fallbackCanvasMetrics = useMemo(() => {
    const { canvasTimeStart, canvasTimeEnd } = canvasBoundsFromDefaultRange(
      defaultTimeStartMs,
      defaultTimeEndMs,
      TIMELINE_BUFFER,
    )
    return {
      canvasTimeStart,
      canvasTimeEnd,
      canvasWidth: Math.max(0, scrollViewportWidth * TIMELINE_BUFFER),
    }
  }, [defaultTimeStartMs, defaultTimeEndMs, scrollViewportWidth])

  const canvasForInactiveMarkers = overlayMetrics ?? fallbackCanvasMetrics

  /** CustomMarker only renders when `date` is on-canvas; anchor = first ms of [inv] ∩ canvas. */
  const inactiveBandMarkerEntries = useMemo(() => {
    const { canvasTimeStart: cs, canvasTimeEnd: ce } = canvasForInactiveMarkers
    if (ce <= cs) return []
    const out: { key: string; inv: MsInterval; anchorMs: number }[] = []
    for (const inv of inactiveIntervalsMs) {
      const anchor = Math.max(inv.start, cs)
      if (anchor >= inv.end || anchor > ce) continue
      out.push({ key: `${inv.start}-${inv.end}`, inv, anchorMs: anchor })
    }
    return out
  }, [inactiveIntervalsMs, canvasForInactiveMarkers])

  const syncOverlayFromTimeline = useCallback(() => {
    const inst = timelineRef.current as
      | { getTimelineContext?: () => { canvasTimeStart: number; canvasTimeEnd: number; canvasWidth: number } }
      | null
      | undefined
    if (!inst?.getTimelineContext) return
    const c = inst.getTimelineContext()
    setOverlayMetrics((prev) => {
      const next = {
        canvasTimeStart: c.canvasTimeStart,
        canvasTimeEnd: c.canvasTimeEnd,
        canvasWidth: c.canvasWidth,
      }
      if (
        prev &&
        prev.canvasTimeStart === next.canvasTimeStart &&
        prev.canvasTimeEnd === next.canvasTimeEnd &&
        prev.canvasWidth === next.canvasWidth
      ) {
        return prev
      }
      return next
    })
  }, [])

  const handleTimelineScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      timelineScrollRef.current = el
      setScrollViewportWidth(el?.clientWidth ?? 0)
      requestAnimationFrame(() => syncOverlayFromTimeline())
    },
    [syncOverlayFromTimeline],
  )

  /** Keep inactive bands aligned: timeline rebuffers canvas on scroll without always updating React visible props. */
  useLayoutEffect(() => {
    const el = timelineScrollRef.current
    if (!el) return
    const sync = () => {
      setScrollViewportWidth(el.clientWidth)
      syncOverlayFromTimeline()
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [syncOverlayFromTimeline])

  useLayoutEffect(() => {
    requestAnimationFrame(() => syncOverlayFromTimeline())
  }, [defaultTimeStartMs, defaultTimeEndMs, syncOverlayFromTimeline])

  useEffect(() => {
    void dispatch(fetchScheduleGantt())
    void dispatch(fetchUnqueuedScheduleJobs())
  }, [dispatch])

  /** Updates ghost bar position; returns whether the lane is invalid for drop (non-extruder / OOB). */
  const syncUnqueuedDropPreviewFromEvent = useCallback(
    (e: React.DragEvent<HTMLDivElement>): boolean => {
      if (!externalDragUnqueuedJobId || !externalDragUnqueuedJob) {
        setUnqueuedDropPreview(null)
        return true
      }
      const scrollEl = timelineScrollRef.current
      const inst = timelineRef.current
      if (!scrollEl || !inst?.calculateDropCoordinatesToTimeAndGroup) {
        setUnqueuedDropPreview(null)
        return true
      }
      const op = offsetParentOffset(scrollEl)
      const cs = cumulativeScrollOffset(scrollEl)
      const { time, groupIndex } = inst.calculateDropCoordinatesToTimeAndGroup(
        e.pageX,
        e.pageY - op.top + cs.top,
      )
      const targetGroup = groups[groupIndex]
      if (!targetGroup) {
        setUnqueuedDropPreview(null)
        return true
      }
      const invalidLane = targetGroup.machineType !== 'extruder'
      const startMs = new Date(time).getTime()
      const dur = previewDurationMsForUnqueuedJob(externalDragUnqueuedJob)
      setUnqueuedDropPreview({
        startMs,
        endMs: Math.max(startMs + HOUR_MS, startMs + dur),
        groupIndex,
        invalidLane,
      })
      return invalidLane
    },
    [externalDragUnqueuedJob, externalDragUnqueuedJobId, groups],
  )

  const onExternalDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const jobId = e.dataTransfer.getData('text/plain')
      endExternalUnqueuedDrag()
      const scrollEl = timelineScrollRef.current
      if (!jobId || !timelineRef.current || !scrollEl) return
      const op = offsetParentOffset(scrollEl)
      const cs = cumulativeScrollOffset(scrollEl)
      const { time, groupIndex } = timelineRef.current.calculateDropCoordinatesToTimeAndGroup(
        e.pageX,
        e.pageY - op.top + cs.top,
      )
      const targetGroup = groups[groupIndex]
      if (!targetGroup) return
      if (targetGroup.machineType !== 'extruder') {
        window.alert('Drag unqueued jobs onto an extruder lane only.')
        return
      }
      try {
        dispatch(clearScheduleMutationError())
        await dispatch(
          addJobToScheduleQueue({
            machine_id: targetGroup.id,
            job_id: String(jobId),
            target_start: new Date(time).toISOString(),
          }),
        ).unwrap()
      } catch {
        /* mutation.error */
      }
    },
    [dispatch, endExternalUnqueuedDrag, groups],
  )

  const onItemMove = useCallback(
    async (itemId: string | number, dragTime: number, newGroupOrder: number) => {
      const jobId = String(itemId)
      const found = barByJobId.get(jobId)
      const targetGroup = groups[newGroupOrder]
      if (!found || !targetGroup) return
      if (found.bar.status === 'running') return

      try {
        dispatch(clearScheduleMutationError())
        await dispatch(
          moveScheduleBar({
            job_id: jobId,
            operation_type: found.bar.operation_type,
            target_machine_id: String(targetGroup.id),
            target_start: new Date(dragTime).toISOString(),
          }),
        ).unwrap()
      } catch {
        /* mutation.error */
      }
    },
    [barByJobId, dispatch, groups],
  )

  const selectedQueued = selectedJobId ? barByJobId.get(String(selectedJobId)) ?? null : null
  const canUnqueueSelected =
    !!selectedQueued &&
    selectedQueued.lane.machine_type === 'extruder' &&
    selectedQueued.bar.status !== 'running'

  const onUnqueueSelected = useCallback(async () => {
    if (!selectedQueued) return
    try {
      dispatch(clearScheduleMutationError())
      await dispatch(
        removeJobFromScheduleQueue({
          machine_id: selectedQueued.lane.machine_id,
          job_id: String(selectedQueued.bar.job_id),
        }),
      ).unwrap()
      setSelectedJobId(null)
    } catch {
      /* mutation.error */
    }
  }, [dispatch, selectedQueued])

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

  const scheduleToast = mutation.error
    ? { message: mutation.error, severity: 'error' as const, clear: () => dispatch(clearScheduleMutationError()) }
    : unqueued.error
      ? { message: unqueued.error, severity: 'warning' as const, clear: () => dispatch(clearScheduleUnqueuedError()) }
      : null

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, height: '100%', width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <Snackbar
        open={Boolean(scheduleToast)}
        autoHideDuration={scheduleToast?.severity === 'error' ? 12_000 : 8000}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return
          scheduleToast?.clear()
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          zIndex: (theme) => theme.zIndex.modal + 1,
          '& .MuiSnackbarContent-root, & .MuiPaper-root': { minWidth: { xs: '90vw', sm: 360 }, maxWidth: 560 },
        }}
      >
        {scheduleToast ? (
          <Alert
            severity={scheduleToast.severity}
            variant="filled"
            onClose={scheduleToast.clear}
            elevation={6}
            sx={{ width: '100%', alignItems: 'center' }}
          >
            {scheduleToast.message}
          </Alert>
        ) : undefined}
      </Snackbar>

      {/* Fixed height so Saving… does not shift layout when toggling */}
      <Box
        aria-busy={mutation.status === 'loading'}
        sx={{ flexShrink: 0, height: 32, display: 'flex', alignItems: 'center', gap: 1 }}
      >
        {mutation.status === 'loading' ? (
          <>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Saving…
            </Typography>
          </>
        ) : null}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 2, overflow: 'hidden' }}>
        <Box
          sx={{
            width: { xs: '100%', lg: 320 },
            minWidth: 0,
            height: { xs: '40dvh', lg: '100%' },
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            borderRight: { lg: 1 },
            borderColor: 'divider',
            pr: { lg: 1.5 },
            overflow: 'hidden',
          }}
        >
          <Paper variant="outlined" sx={{ p: 1, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Unqueued (extrusion)
            </Typography>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              <Stack spacing={1}>
                {unqueued.jobs.map((job) => (
                  <Paper
                    key={job.job_id}
                    draggable
                    variant="outlined"
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(job.job_id))
                      e.dataTransfer.effectAllowed = 'move'
                      setExternalDragUnqueuedJobId(String(job.job_id))
                    }}
                    onDragEnd={() => {
                      endExternalUnqueuedDrag()
                    }}
                    onClick={() => setSelectedJobId(String(job.job_id))}
                    sx={{ p: 1, cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none' }}
                  >
                    <Typography variant="subtitle2" noWrap title={job.job_code}>
                      {job.job_code}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {job.customer}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {job.product_code} · qty {job.planned_qty} · {job.roll_count} roll{job.roll_count === 1 ? '' : 's'}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </Box>
          </Paper>

          <Box sx={{ mt: { lg: 'auto' }, maxHeight: { xs: '45%', lg: '48%' }, minHeight: 0, overflow: 'auto' }}>
            <SelectedJobPanel jobId={selectedJobId} lanes={lanes} unqueuedJobs={unqueued.jobs} onClear={() => setSelectedJobId(null)} />
            {canUnqueueSelected ? (
              <Button size="small" color="warning" onClick={() => void onUnqueueSelected()} sx={{ mt: 1 }}>
                Unqueue selected job
              </Button>
            ) : null}
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              mb: 1,
              flexShrink: 0,
              rowGap: 1,
            }}
          >
            <Typography variant="subtitle2">Timeline</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
              Default view: {dayjs(defaultTimeStartMs).format('ddd D MMM')} (local) — scroll / zoom to navigate
            </Typography>
          </Box>

          <Box
            onDragOver={(e) => {
              if (!externalDragUnqueuedJobId) return
              e.preventDefault()
              const invalid = syncUnqueuedDropPreviewFromEvent(e)
              e.dataTransfer.dropEffect = invalid ? 'none' : 'move'
            }}
            onDragLeave={(e) => {
              if (!externalDragUnqueuedJobId) return
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setUnqueuedDropPreview(null)
              }
            }}
            onDrop={(e) => {
              void onExternalDrop(e)
            }}
            sx={{ flex: 1, minHeight: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
          >
            {/* Stable key: refetch must not remount or zoom/scroll reset (calendar.end shifts with each API `now`). */}
            <Timeline<TimelineItem, TimelineGroup>
              key="schedule-gantt-timeline"
              ref={timelineRef}
              groups={groups}
              items={itemsWithUnqueuedPreview}
              defaultTimeStart={defaultTimeStartMs}
              defaultTimeEnd={defaultTimeEndMs}
              onZoom={() => requestAnimationFrame(() => syncOverlayFromTimeline())}
              scrollRef={handleTimelineScrollRef}
              sidebarWidth={SIDEBAR_WIDTH}
              canMove
              canChangeGroup
              canResize={false}
              canSelect
              dragSnap={HOUR_MS}
              minZoom={24 * HOUR_MS}
              maxZoom={45 * 24 * HOUR_MS}
              stackItems
              lineHeight={54}
              itemHeightRatio={0.75}
              buffer={TIMELINE_BUFFER}
              selected={selectedJobId ? [selectedJobId] : []}
              onItemSelect={(itemId) => setSelectedJobId(String(itemId))}
              onCanvasClick={() => setSelectedJobId(null)}
              onItemMove={(itemId, dragTime, newGroupOrder) =>
                void onItemMove(itemId as string | number, dragTime, newGroupOrder)
              }
            >
              <TimelineMarkers>
                {inactiveBandMarkerEntries.map((e) => (
                  <InactiveClosedBandMarker
                    key={e.key}
                    interval={e.inv}
                    anchorMs={e.anchorMs}
                    timelineRef={timelineRef}
                  />
                ))}
                <TodayMarker interval={10_000}>
                  {({ styles }) => (
                    <div
                      style={{
                        ...styles,
                        width: 2,
                        backgroundColor: '#c62828',
                        zIndex: 55,
                        boxShadow: '0 0 0 1px rgba(198, 40, 40, 0.25)',
                        pointerEvents: 'none',
                      }}
                      aria-hidden
                      title="Now"
                    />
                  )}
                </TodayMarker>
              </TimelineMarkers>
            </Timeline>
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}

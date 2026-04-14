import type { CSSProperties, ReactNode, Ref, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import Timeline, {
  CustomMarker,
  TimelineMarkers,
  TodayMarker,
  calendarUtils,
} from 'react-calendar-timeline'
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
import { apiFetch } from '../../api/client'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  addJobToScheduleQueue,
  clearScheduleMutationError,
  clearScheduleUnqueuedError,
  fetchScheduleGantt,
  fetchUnqueuedScheduleJobs,
  moveScheduleBar,
  removeJobFromScheduleQueue,
  type GanttBar,
  type GanttLane,
  type UnqueuedScheduleJob,
} from '../../store/slices/scheduleSlice'
import { SelectedJobPanel } from './components/SelectedJobPanel'

/** Machine / lane labels column (px). */
const SIDEBAR_WIDTH = 150
const HOUR_MS = 3600000
/** Initial time-axis zoom: ~1 month visible (do not tie to `calendar.end`, which spans the full horizon). */
const DEFAULT_GANTT_VISIBLE_SPAN_MS = 31 * 24 * HOUR_MS
/** Default row / bar baseline (px) for `lineHeight` and non-extrusion tasks on `<Timeline />`. */
const DEFAULT_LANE_ROW_PX = 54
/** Passed to `<Timeline />`; when `itemVerticalGap` is set, bar pixel height uses `item.height` directly (no × ratio). */
const GANTT_ITEM_HEIGHT_RATIO = 0.75
/**
 * Vertical inset inside each lane row. Passed as `itemVerticalGap` so tall job bars stay
 * aligned when `lineHeight` is smaller than the rendered bar height.
 */
const GANTT_LANE_ITEM_VERTICAL_GAP_PX = 2
/**
 * Extruder lane row height and extrusion bar row height share the same px/mm scale (job layflat vs machine
 * max film width). Values are kept modest so many extruders fit on screen; bars sit slightly inside the
 * lane row via `GANTT_LANE_ITEM_VERTICAL_GAP_PX` and `timelineItemHeightProp`.
 */
const EXTRUDER_ROW_PX_PER_MM = 0.112
const EXTRUDER_ROW_HEIGHT_MIN_PX = 32
const EXTRUDER_ROW_HEIGHT_MAX_PX = 118
/** When min/max are missing, assume a wide line for lane sizing (mm). */
const EXTRUDER_LANE_FALLBACK_MAX_MM = 1000
const EXTRUSION_BAR_FALLBACK_LAYFLAT_MM = 320
/** Must match `buffer` on `<Timeline />` (library canvas width = viewport × buffer). */
const TIMELINE_BUFFER = 2
/** Synthetic row id so the unqueued drop ghost is not treated as a real job. */
const UNQUEUED_DROP_PREVIEW_ITEM_ID = '__unqueued_drop_preview__'

function clampNumber(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/** Maximum extrusion / film width (mm) for lane height: prefer `film_width_max_mm`, else min, else fallback. */
function maxExtrusionFilmWidthMmForLane(lane: GanttLane): number {
  const min = lane.film_width_min_mm
  const max = lane.film_width_max_mm
  const minN = min != null && Number.isFinite(Number(min)) ? Number(min) : null
  const maxN = max != null && Number.isFinite(Number(max)) ? Number(max) : null
  if (maxN != null && maxN > 0) return maxN
  if (minN != null && minN > 0) return minN
  return EXTRUDER_LANE_FALLBACK_MAX_MM
}

/** Row height (px) from film / layflat width (mm); shared by extruder lanes and extrusion bars. */
function extrusionGeometryRowPxFromMm(mm: number): number {
  return clampNumber(EXTRUDER_ROW_PX_PER_MM * mm, EXTRUDER_ROW_HEIGHT_MIN_PX, EXTRUDER_ROW_HEIGHT_MAX_PX)
}

/** Fixed row height (px) for a machine lane — extruders scale with max on-machine film width; others default. */
function extruderLaneRowHeightPx(lane: GanttLane): number {
  if (lane.machine_type !== 'extruder') return DEFAULT_LANE_ROW_PX
  return extrusionGeometryRowPxFromMm(maxExtrusionFilmWidthMmForLane(lane))
}

/** Extruder-only: allowed width range from rate-card film min/max (mm), for sidebar next to the machine code. */
function extruderLaneMmRangeLabel(lane: GanttLane): string | null {
  if (lane.machine_type !== 'extruder') return null
  const min = lane.film_width_min_mm
  const max = lane.film_width_max_mm
  const minN = min != null && Number.isFinite(Number(min)) && Number(min) > 0 ? Number(min) : null
  const maxN = max != null && Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : null
  const fmt = (mm: number) => (Math.abs(mm - Math.round(mm)) < 0.05 ? String(Math.round(mm)) : mm.toFixed(1))
  if (minN != null && maxN != null) {
    if (Math.abs(minN - maxN) < 0.5) return `${fmt(minN)} mm`
    return `${fmt(minN)}–${fmt(maxN)} mm`
  }
  if (maxN != null) return `max ${fmt(maxN)} mm`
  if (minN != null) return `min ${fmt(minN)} mm`
  return null
}

function layflatMmFromJobFields(layflat: number | null | undefined): number {
  if (layflat != null && Number.isFinite(Number(layflat)) && Number(layflat) > 0) return Number(layflat)
  return EXTRUSION_BAR_FALLBACK_LAYFLAT_MM
}

/** Vertical space (px) for an extrusion bar from job layflat; other operations use the default lane size. */
function extrusionTaskBarRowPxFromBar(bar: GanttBar): number {
  if (bar.operation_type !== 'extrusion') return DEFAULT_LANE_ROW_PX
  return extrusionGeometryRowPxFromMm(layflatMmFromJobFields(bar.job_layflat_width_mm))
}

function extrusionTaskBarRowPxFromUnqueuedJob(job: UnqueuedScheduleJob): number {
  return extrusionGeometryRowPxFromMm(layflatMmFromJobFields(job.job_layflat_width_mm))
}

/**
 * `item.height` for react-calendar-timeline when `itemVerticalGap` is set: the library uses this as the
 * item’s pixel height directly (see `getItemDimensions` — no `itemHeightRatio` multiply). Match lane `rowPx`
 * from layflat / film width but inset by twice `itemVerticalGap` so the bar fits inside the extruder row.
 */
function timelineItemHeightProp(rowPx: number): number {
  return Math.max(20, rowPx - 2 * GANTT_LANE_ITEM_VERTICAL_GAP_PX)
}

const GANTT_ITEM_ID_SEP = '|'

/** Timeline item id: one bar per (job, operation); avoids collisions when a job spans extrusion + Uteco + bagging. */
function ganttTimelineItemId(jobId: string, operationType: string) {
  return `${jobId}${GANTT_ITEM_ID_SEP}${operationType}`
}

function parseGanttTimelineItemId(id: string): { jobId: string; operationType: string } | null {
  const i = id.indexOf(GANTT_ITEM_ID_SEP)
  if (i <= 0) return null
  return { jobId: id.slice(0, i), operationType: id.slice(i + 1) }
}

function previewDurationMsForUnqueuedJob(job: UnqueuedScheduleJob): number {
  const rolls = Math.max(1, job.roll_count || 1)
  return Math.max(HOUR_MS, rolls * HOUR_MS)
}

/** Minimum horizontal gap between roll dividers (px); below this we subsample boundaries. */
const ROLL_DIVIDER_MIN_GAP_PX = 2.5
/** Cap DOM nodes for very wide bars / huge roll counts. */
const ROLL_DIVIDER_MAX_LINES = 500

/**
 * X positions (px from left edge of the bar) for vertical roll-segment dividers.
 * For R rolls, ideal boundaries sit at i/R * width for i = 1..R-1. When the bar is too narrow,
 * we keep at most floor(width / minGap) dividers, spread across real roll boundaries.
 */
function rollDividerPositionsPx(widthPx: number, rollCount: number): number[] {
  if (rollCount <= 1 || widthPx < 4) return []
  const idealInternal = rollCount - 1
  const maxByWidth = Math.max(0, Math.floor(widthPx / ROLL_DIVIDER_MIN_GAP_PX) - 1)
  const maxLines = Math.min(idealInternal, maxByWidth, ROLL_DIVIDER_MAX_LINES)
  if (maxLines <= 0) return []

  let xs: number[]
  if (idealInternal <= maxLines) {
    xs = Array.from({ length: idealInternal }, (_, i) => ((i + 1) / rollCount) * widthPx)
  } else {
    const tmp: number[] = []
    for (let k = 1; k <= maxLines; k++) {
      const rollBoundary = Math.round((k * idealInternal) / (maxLines + 1))
      const b = Math.max(1, Math.min(idealInternal, rollBoundary))
      tmp.push((b / rollCount) * widthPx)
    }
    xs = tmp
    xs.sort((a, b) => a - b)
    const deduped: number[] = []
    let prev = -Infinity
    for (const x of xs) {
      if (deduped.length === 0 || x - prev >= ROLL_DIVIDER_MIN_GAP_PX * 0.85) {
        deduped.push(x)
        prev = x
      }
    }
    xs = deduped
  }

  const inset = 0.5
  return xs.map((x) => Math.round(x * 10) / 10).filter((x) => x > inset && x < widthPx - inset)
}

/**
 * Mirrors react-calendar-timeline’s default item shell, plus a subtle roll grid overlay.
 * See `dist/react-calendar-timeline.es.js` default `Li` renderer.
 */
function ganttTimelineItemRenderer(props: {
  item: TimelineItem
  itemContext: {
    dimensions: { width: number; height: number }
    useResizeHandle: boolean
    title: ReactNode
  }
  getItemProps: (params?: TimelineItem['itemProps']) => Record<string, unknown> & {
    key: string | number
    ref: unknown
  }
  getResizeProps: () => { left: Record<string, unknown>; right: Record<string, unknown> }
}) {
  const { item, itemContext, getItemProps, getResizeProps } = props
  const { left, right } = getResizeProps()
  const { key, ref, ...itemDivProps } = getItemProps(item.itemProps ?? {})
  const { useResizeHandle } = itemContext
  const w = itemContext.dimensions.width
  const rolls = item.roll_count != null && item.roll_count >= 1 ? Math.floor(item.roll_count) : 1
  const dividerXs = rollDividerPositionsPx(w, rolls)

  const contentMaxH: CSSProperties = { maxHeight: `${itemContext.dimensions.height}px` }

  return (
    <div
      {...itemDivProps}
      ref={ref as Ref<HTMLDivElement>}
      key={`${String(key)}-outer`}
      data-gantt-item-id={String(item.id)}
    >
      {useResizeHandle ? <div {...left} key={`${String(key)}-lr`} /> : null}
      <div className="rct-item-content" style={contentMaxH} key={`${String(key)}-content`}>
        {itemContext.title}
      </div>
      {useResizeHandle ? <div {...right} key={`${String(key)}-rr`} /> : null}
      {dividerXs.length > 0 ? (
        <div
          className="gantt-roll-dividers"
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            borderRadius: 'inherit',
            overflow: 'hidden',
            zIndex: 1,
          }}
        >
          {dividerXs.map((leftPx, i) => (
            <div
              key={i}
              className="gantt-roll-dividers__line"
              style={{
                position: 'absolute',
                left: leftPx,
                top: 1,
                bottom: 1,
                width: 1,
                transform: 'translateX(-0.5px)',
                backgroundColor: 'rgba(13, 27, 42, 0.14)',
                boxShadow: '0.5px 0 0 rgba(255, 255, 255, 0.22)',
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
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
type MarkerRenderProps = { styles: CSSProperties; date: number }

/** Merge overlapping / adjacent inactive spans (UTC ms) for operating-time walks. */
function mergeInactiveIntervals(intervals: MsInterval[]): MsInterval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const out: MsInterval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1]
    const n = sorted[i]
    if (n.start <= cur.end) {
      cur.end = Math.max(cur.end, n.end)
    } else {
      out.push({ ...n })
    }
  }
  return out
}

function snapForwardPastInactiveUtc(tMs: number, inactive: MsInterval[]): number {
  let t = tMs
  for (let g = 0; g < 5000; g++) {
    let hit = false
    for (const inv of inactive) {
      if (t >= inv.start && t < inv.end) {
        t = inv.end
        hit = true
        break
      }
    }
    if (!hit) return t
  }
  return t
}

function nextInactiveStartAfterUtc(tMs: number, inactive: MsInterval[]): number | null {
  let best: number | null = null
  for (const inv of inactive) {
    if (inv.start > tMs && (best === null || inv.start < best)) {
      best = inv.start
    }
  }
  return best
}

/**
 * Advance `startMs` by `durationHours` of *operating* time: wall clock only counts outside `inactive`
 * (matches server `inactive_intervals` / closed-factory shading on the Gantt).
 */
function addOperatingHoursWallMs(startMs: number, durationHours: number, inactive: MsInterval[]): number {
  if (durationHours <= 0) return snapForwardPastInactiveUtc(startMs, inactive)
  let t = snapForwardPastInactiveUtc(startMs, inactive)
  let remainingSec = durationHours * 3600
  const epsilon = 1e-3
  let iter = 0
  while (remainingSec > epsilon && iter++ < 500_000) {
    if (inactive.length === 0) {
      t += remainingSec * 1000
      break
    }
    let stuckInClosed = false
    for (const inv of inactive) {
      if (t >= inv.start && t < inv.end) {
        t = inv.end
        stuckInClosed = true
        break
      }
    }
    if (stuckInClosed) continue

    const nextClosed = nextInactiveStartAfterUtc(t, inactive)
    if (nextClosed == null) {
      t += remainingSec * 1000
      break
    }
    const openRunSec = (nextClosed - t) / 1000
    if (openRunSec <= 0) {
      t = snapForwardPastInactiveUtc(nextClosed, inactive)
      continue
    }
    if (openRunSec >= remainingSec) {
      t += remainingSec * 1000
      remainingSec = 0
      break
    }
    remainingSec -= openRunSec
    t = nextClosed
    t = snapForwardPastInactiveUtc(t, inactive)
  }
  return t
}

const DRAG_CHAIN_EPS_MS = 2

/**
 * Latest extrusion start (not after `currentExStartMs`) such that downstream start
 * `addOperatingHoursWallMs(ex, offsetHours, inactive) <= childTargetStartMs`.
 * Used when a chained child is dragged earlier than its minimum relative to the current extrusion start.
 */
function extrusionStartForMaxChildStart(
  childTargetStartMs: number,
  offsetOperatingHours: number,
  inactive: MsInterval[],
  currentExStartMs: number,
): number {
  const f = (exMs: number) => addOperatingHoursWallMs(exMs, offsetOperatingHours, inactive)
  if (f(currentExStartMs) <= childTargetStartMs + DRAG_CHAIN_EPS_MS) {
    return currentExStartMs
  }
  let lo = childTargetStartMs - 500 * 24 * HOUR_MS
  let hi = currentExStartMs
  if (f(lo) > childTargetStartMs) {
    return lo
  }
  for (let i = 0; i < 100 && hi - lo > DRAG_CHAIN_EPS_MS; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) <= childTargetStartMs) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return lo
}

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
      {({ styles }: MarkerRenderProps) => {
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
  /** Fixed lane row height (px); extruder = film-width curve, other machines = default. */
  height?: number
  /** Left sidebar: machine code (shown bold when `sidebarWidthRange` is set). */
  sidebarMachineCode: string
  /** Extruder: e.g. `200–400 mm`; non-extruder / unknown range: `null`. */
  sidebarWidthRange: string | null
}

type TimelineItem = {
  id: string
  parentItem?: {
    id: string
    completionFractionRequired?: number
  }
  group: string
  title: string
  start_time: number
  end_time: number
  canMove: boolean
  canResize: false
  /** Passed to timeline as `item.height` (extrusion: from job layflat only). */
  height?: number
  /** Segments shown as vertical dividers inside the bar (from API `roll_count`). */
  roll_count?: number
  itemProps?: {
    style?: CSSProperties
  }
}

function firstRollCompletionFraction(rollCount?: number | null): number {
  const resolvedRollCount = Math.max(1, Math.floor(rollCount ?? 1))
  return 1 / resolvedRollCount
}

function ganttBarDurationMs(bar: GanttBar): number {
  return Math.max(HOUR_MS, Math.round((bar.estimated_duration_hours || 1) * HOUR_MS))
}

/** Finish time for a bar placed at `startMs` using scheduled duration only (ignores absolute `tentative_finish`). */
function ganttBarEndMsFromEstimatedDuration(bar: GanttBar, startMs: number): number {
  return startMs + ganttBarDurationMs(bar)
}

/** Matches static item `rawEndMs` in `buildGanttTimelineItems` (absolute `tentative_finish` when set). */
function ganttBarRawEndMs(bar: GanttBar, startMs: number): number {
  if (bar.tentative_finish) {
    return new Date(bar.tentative_finish).getTime()
  }
  return ganttBarEndMsFromEstimatedDuration(bar, startMs)
}

type GanttBarLane = { bar: GanttBar; lane: GanttLane }

function ganttBarTentativeStartMs(bar: GanttBar, fallbackMs: number): number {
  return bar.tentative_start ? new Date(bar.tentative_start).getTime() : fallbackMs
}

/**
 * Recompute start/end for every bar in a job while one bar is dragged so chain min-finish constraints
 * update every frame. react-calendar-timeline keeps drag width as `(end-start)` from props, so props must
 * include the constrained span during drag.
 */
function computeJobTimelineSpansDuringDrag(
  jobBarsWithLanes: GanttBarLane[],
  activeDrag: { itemId: string; time: number; newGroupOrder: number },
  groups: TimelineGroup[],
  now: number,
  inactiveMerged: MsInterval[],
  extrusionDurationHoursOverride: number | null,
): Map<string, { startMs: number; endMs: number; groupId: string }> {
  const result = new Map<string, { startMs: number; endMs: number; groupId: string }>()

  const extrusionEntry = jobBarsWithLanes.find((x) => x.bar.operation_type === 'extrusion')
  const utecoEntry = jobBarsWithLanes.find((x) => x.bar.operation_type === 'printing_uteco')
  const conversionEntry = jobBarsWithLanes.find((x) => x.bar.operation_type === 'conversion')
  const extrusionBar = extrusionEntry?.bar
  const utecoBar = utecoEntry?.bar
  const conversionBar = conversionEntry?.bar

  const draggedParsed = parseGanttTimelineItemId(activeDrag.itemId)
  const extrusionDrag =
    draggedParsed?.operationType === 'extrusion' &&
    !!extrusionBar &&
    ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type) === activeDrag.itemId

  const utecoDrag =
    !!utecoBar &&
    draggedParsed?.operationType === 'printing_uteco' &&
    ganttTimelineItemId(String(utecoBar.job_id), utecoBar.operation_type) === activeDrag.itemId &&
    extrusionBar?.chain_uteco_offset_operating_hours != null

  const conversionDrag =
    !!conversionBar &&
    draggedParsed?.operationType === 'conversion' &&
    ganttTimelineItemId(String(conversionBar.job_id), conversionBar.operation_type) === activeDrag.itemId &&
    extrusionBar?.chain_bagging_offset_operating_hours != null

  const exNew = extrusionDrag ? activeDrag.time : null
  const exDurHForChain =
    extrusionBar != null
      ? Math.max(
          0.25,
          extrusionDurationHoursOverride ?? extrusionBar.estimated_duration_hours ?? 1,
        )
      : 1
  const exRolls = Math.max(1, Math.floor(extrusionBar?.roll_count ?? 1))
  const firstRollOpH = extrusionBar != null ? exDurHForChain / exRolls : 1

  const exStartFromRedux = extrusionBar ? ganttBarTentativeStartMs(extrusionBar, now) : now

  let exAnchorMs: number | null = null
  if (extrusionDrag && exNew != null) {
    exAnchorMs = exNew
  } else if (extrusionBar && utecoDrag) {
    // Pull extrusion only once the child crosses *before* first-roll completion (matches drop behaviour).
    // Stored chain_uteco can exceed first roll if the run was nudged later; do not use it for this threshold.
    const minChildAfterFirstRoll = addOperatingHoursWallMs(exStartFromRedux, firstRollOpH, inactiveMerged)
    if (activeDrag.time + DRAG_CHAIN_EPS_MS < minChildAfterFirstRoll) {
      exAnchorMs = extrusionStartForMaxChildStart(
        activeDrag.time,
        firstRollOpH,
        inactiveMerged,
        exStartFromRedux,
      )
    }
  } else if (extrusionBar && conversionDrag) {
    const minChildAfterFirstRoll = addOperatingHoursWallMs(exStartFromRedux, firstRollOpH, inactiveMerged)
    if (activeDrag.time + DRAG_CHAIN_EPS_MS < minChildAfterFirstRoll) {
      exAnchorMs = extrusionStartForMaxChildStart(
        activeDrag.time,
        firstRollOpH,
        inactiveMerged,
        exStartFromRedux,
      )
    }
  }

  for (const { bar, lane } of jobBarsWithLanes) {
    const id = ganttTimelineItemId(String(bar.job_id), bar.operation_type)
    const dragged = id === activeDrag.itemId

    let startMs: number
    if (dragged) {
      startMs = activeDrag.time
    } else if (
      extrusionBar &&
      bar.operation_type === 'extrusion' &&
      exAnchorMs != null &&
      !extrusionDrag
    ) {
      startMs = exAnchorMs
    } else if (
      extrusionDrag &&
      exAnchorMs != null &&
      extrusionBar &&
      bar.operation_type === 'printing_uteco' &&
      extrusionBar.chain_uteco_offset_operating_hours != null
    ) {
      const off = Number(utecoBar!.chain_uteco_offset_operating_hours)
      startMs = Number.isFinite(off)
        ? addOperatingHoursWallMs(exAnchorMs, off, inactiveMerged)
        : addOperatingHoursWallMs(exAnchorMs, firstRollOpH, inactiveMerged)
    } else if (
      extrusionDrag &&
      exAnchorMs != null &&
      extrusionBar &&
      bar.operation_type === 'conversion' &&
      extrusionBar.chain_bagging_offset_operating_hours != null
    ) {
      const off = Number(extrusionBar.chain_bagging_offset_operating_hours)
      startMs = Number.isFinite(off)
        ? addOperatingHoursWallMs(exAnchorMs, off, inactiveMerged)
        : addOperatingHoursWallMs(exAnchorMs, firstRollOpH, inactiveMerged)
    } else if (
      !extrusionDrag &&
      exAnchorMs != null &&
      extrusionBar &&
      bar.operation_type === 'printing_uteco' &&
      extrusionBar.chain_uteco_offset_operating_hours != null
    ) {
      const off = Number(utecoBar!.chain_uteco_offset_operating_hours)
      startMs = Number.isFinite(off)
        ? addOperatingHoursWallMs(exAnchorMs, off, inactiveMerged)
        : addOperatingHoursWallMs(exAnchorMs, firstRollOpH, inactiveMerged)
    } else if (
      !extrusionDrag &&
      exAnchorMs != null &&
      extrusionBar &&
      bar.operation_type === 'conversion' &&
      extrusionBar.chain_bagging_offset_operating_hours != null
    ) {
      const off = Number(extrusionBar.chain_bagging_offset_operating_hours)
      startMs = Number.isFinite(off)
        ? addOperatingHoursWallMs(exAnchorMs, off, inactiveMerged)
        : addOperatingHoursWallMs(exAnchorMs, firstRollOpH, inactiveMerged)
    } else {
      startMs = ganttBarTentativeStartMs(bar, now)
    }

    const groupId =
      dragged && groups[activeDrag.newGroupOrder] ? groups[activeDrag.newGroupOrder].id : lane.machine_id
    result.set(id, { startMs, endMs: 0, groupId })
  }

  const applyEnd = (bar: GanttBar, minFinishMs: number | null) => {
    const id = ganttTimelineItemId(String(bar.job_id), bar.operation_type)
    const row = result.get(id)
    if (!row) return
    const dragged = id === activeDrag.itemId
    const extrusionPulledEarlier =
      !!extrusionBar &&
      bar.operation_type === 'extrusion' &&
      exAnchorMs != null &&
      !extrusionDrag &&
      Math.abs(ganttBarTentativeStartMs(extrusionBar, now) - exAnchorMs) > DRAG_CHAIN_EPS_MS
    const dependentStartShifted =
      exAnchorMs != null &&
      !dragged &&
      ((bar.operation_type === 'printing_uteco' && extrusionBar?.chain_uteco_offset_operating_hours != null) ||
        (bar.operation_type === 'conversion' && extrusionBar?.chain_bagging_offset_operating_hours != null))
    const durationH =
      dragged && bar.operation_type === 'extrusion'
        ? Math.max(0.25, extrusionDurationHoursOverride ?? bar.estimated_duration_hours ?? 1)
        : Math.max(0.25, bar.estimated_duration_hours ?? 1)
    const raw =
      dragged || dependentStartShifted || extrusionPulledEarlier
        ? addOperatingHoursWallMs(row.startMs, durationH, inactiveMerged)
        : ganttBarRawEndMs(bar, row.startMs)
    const withMin = minFinishMs != null ? Math.max(raw, minFinishMs) : raw
    result.set(id, { ...row, endMs: Math.max(row.startMs + HOUR_MS, withMin) })
  }

  if (extrusionBar) {
    applyEnd(extrusionBar, null)
  }
  if (utecoBar) {
    let minFinish: number | null = null
    if (extrusionBar && utecoBar.chain_uteco_offset_operating_hours != null) {
      const exId = ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type)
      const exEnd = result.get(exId)?.endMs
      if (exEnd != null) {
        const childHoursPerRoll = Math.max(0, utecoBar.hours_per_roll ?? 0)
        minFinish =
          childHoursPerRoll > 0
            ? addOperatingHoursWallMs(exEnd, childHoursPerRoll, inactiveMerged)
            : exEnd + HOUR_MS
      }
    }
    applyEnd(utecoBar, minFinish)
  }
  if (conversionBar && extrusionBar?.chain_bagging_offset_operating_hours != null) {
    let minFinish: number | null = null
    if (utecoBar) {
      const utId = ganttTimelineItemId(String(utecoBar.job_id), utecoBar.operation_type)
      const utEnd = result.get(utId)?.endMs
      if (utEnd != null) {
        const childHoursPerRoll = Math.max(0, conversionBar.hours_per_roll ?? 0)
        minFinish =
          childHoursPerRoll > 0
            ? addOperatingHoursWallMs(utEnd, childHoursPerRoll, inactiveMerged)
            : utEnd + HOUR_MS
      }
    } else {
      const exId = ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type)
      const exEnd = result.get(exId)?.endMs
      if (exEnd != null) {
        const childHoursPerRoll = Math.max(0, conversionBar.hours_per_roll ?? 0)
        minFinish =
          childHoursPerRoll > 0
            ? addOperatingHoursWallMs(exEnd, childHoursPerRoll, inactiveMerged)
            : exEnd + HOUR_MS
      }
    }
    applyEnd(conversionBar, minFinish)
  }

  for (const { bar } of jobBarsWithLanes) {
    const id = ganttTimelineItemId(String(bar.job_id), bar.operation_type)
    const row = result.get(id)
    if (row && row.endMs === 0) {
      applyEnd(bar, null)
    }
  }

  return result
}

function buildGanttTimelineItems(
  lanes: GanttLane[],
  groups: TimelineGroup[],
  activeDrag: { itemId: string; time: number; newGroupOrder: number } | null,
  inactiveMerged: MsInterval[],
  extrusionDurationHoursOverride: number | null,
): TimelineItem[] {
  const out: TimelineItem[] = []
  const now = Date.now()
  const barsByJobId = new Map<string, GanttBar[]>()

  for (const lane of lanes) {
    for (const bar of lane.bars) {
      const jobId = String(bar.job_id)
      if (!barsByJobId.has(jobId)) barsByJobId.set(jobId, [])
      barsByJobId.get(jobId)!.push(bar)
    }
  }

  const activeJobId =
    activeDrag != null ? parseGanttTimelineItemId(activeDrag.itemId)?.jobId ?? null : null

  const jobLanesMap = new Map<string, GanttBarLane[]>()
  for (const lane of lanes) {
    for (const bar of lane.bars) {
      const jid = String(bar.job_id)
      if (!jobLanesMap.has(jid)) jobLanesMap.set(jid, [])
      jobLanesMap.get(jid)!.push({ bar, lane })
    }
  }

  let dragSpanByItemId: Map<string, { startMs: number; endMs: number; groupId: string }> | null = null
  if (activeDrag && activeJobId) {
    const entries = jobLanesMap.get(activeJobId)
    if (entries?.length) {
      dragSpanByItemId = computeJobTimelineSpansDuringDrag(
        entries,
        activeDrag,
        groups,
        now,
        inactiveMerged,
        extrusionDurationHoursOverride,
      )
    }
  }

  const getBarEndMs = (targetBar: GanttBar | undefined): number | null => {
    if (!targetBar) return null
    if (targetBar.tentative_finish) return new Date(targetBar.tentative_finish).getTime()
    if (targetBar.tentative_start) {
      const parentStartMs = new Date(targetBar.tentative_start).getTime()
      const parentDurationMs = Math.max(HOUR_MS, Math.round((targetBar.estimated_duration_hours || 1) * HOUR_MS))
      return parentStartMs + parentDurationMs
    }
    return null
  }

  for (const lane of lanes) {
    for (const bar of lane.bars) {
      const itemId = ganttTimelineItemId(String(bar.job_id), bar.operation_type)
      const siblingJobBars = barsByJobId.get(String(bar.job_id)) ?? []
      const extrusionBar = siblingJobBars.find((siblingBar) => siblingBar.operation_type === 'extrusion')
      const utecoBar = siblingJobBars.find((siblingBar) => siblingBar.operation_type === 'printing_uteco')

      const dragSpan = dragSpanByItemId?.get(itemId)
      const startMs = dragSpan?.startMs ?? (bar.tentative_start ? new Date(bar.tentative_start).getTime() : now)
      const groupId = dragSpan?.groupId ?? lane.machine_id

      let parentItem: TimelineItem['parentItem']
      let constrainedEndMs: number
      if (dragSpan) {
        constrainedEndMs = dragSpan.endMs
        if (bar.operation_type === 'printing_uteco' && extrusionBar?.chain_uteco_offset_operating_hours != null) {
          parentItem = {
            id: ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type),
            completionFractionRequired: firstRollCompletionFraction(extrusionBar.roll_count),
          }
        } else if (bar.operation_type === 'conversion' && extrusionBar?.chain_bagging_offset_operating_hours != null) {
          if (utecoBar) {
            parentItem = {
              id: ganttTimelineItemId(String(utecoBar.job_id), utecoBar.operation_type),
              completionFractionRequired: firstRollCompletionFraction(utecoBar.roll_count),
            }
          } else {
            parentItem = {
              id: ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type),
              completionFractionRequired: firstRollCompletionFraction(extrusionBar.roll_count),
            }
          }
        }
      } else {
        const rawEndMs = ganttBarRawEndMs(bar, startMs)
        constrainedEndMs = rawEndMs
        if (bar.operation_type === 'printing_uteco' && extrusionBar?.chain_uteco_offset_operating_hours != null) {
          parentItem = {
            id: ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type),
            completionFractionRequired: firstRollCompletionFraction(extrusionBar.roll_count),
          }
          const extrusionEndMs = getBarEndMs(extrusionBar)
          if (extrusionEndMs != null) {
            const childHoursPerRoll = Math.max(0, bar.hours_per_roll ?? 0)
            const minimumChildFinishMs = extrusionEndMs + childHoursPerRoll * HOUR_MS
            constrainedEndMs = Math.max(constrainedEndMs, minimumChildFinishMs)
          }
        } else if (bar.operation_type === 'conversion' && extrusionBar?.chain_bagging_offset_operating_hours != null) {
          if (utecoBar) {
            parentItem = {
              id: ganttTimelineItemId(String(utecoBar.job_id), utecoBar.operation_type),
              completionFractionRequired: firstRollCompletionFraction(utecoBar.roll_count),
            }
            const utecoEndMs = getBarEndMs(utecoBar)
            if (utecoEndMs != null) {
              const childHoursPerRoll = Math.max(0, bar.hours_per_roll ?? 0)
              const minimumChildFinishMs = utecoEndMs + childHoursPerRoll * HOUR_MS
              constrainedEndMs = Math.max(constrainedEndMs, minimumChildFinishMs)
            }
          } else {
            parentItem = {
              id: ganttTimelineItemId(String(extrusionBar.job_id), extrusionBar.operation_type),
              completionFractionRequired: firstRollCompletionFraction(extrusionBar.roll_count),
            }
            const extrusionEndMs = getBarEndMs(extrusionBar)
            if (extrusionEndMs != null) {
              const childHoursPerRoll = Math.max(0, bar.hours_per_roll ?? 0)
              const minimumChildFinishMs = extrusionEndMs + childHoursPerRoll * HOUR_MS
              constrainedEndMs = Math.max(constrainedEndMs, minimumChildFinishMs)
            }
          }
        }
      }

      const barRowPx = extrusionTaskBarRowPxFromBar(bar)
      out.push({
        id: itemId,
        parentItem,
        group: groupId,
        title: `${bar.job_code} · ${bar.customer}`,
        start_time: startMs,
        end_time: Math.max(startMs + HOUR_MS, constrainedEndMs),
        canMove: bar.status !== 'running',
        canResize: false,
        roll_count: Math.max(1, bar.roll_count ?? 1),
        height: timelineItemHeightProp(barRowPx),
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
}

function ganttTimelineGroupRenderer({ group }: { group: TimelineGroup }) {
  const rowStyle: CSSProperties = {
    paddingLeft: 8,
    paddingRight: 6,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    overflow: 'hidden',
  }
  if (group.machineType === 'extruder') {
    return (
      <div style={rowStyle} title={group.title}>
        <span style={{ fontWeight: 700, flexShrink: 0 }}>{group.sidebarMachineCode}</span>
        {group.sidebarWidthRange ? (
          <span
            style={{
              fontWeight: 400,
              color: 'rgba(13, 27, 42, 0.62)',
              marginLeft: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '0.8125rem',
            }}
          >
            {' · '}
            {group.sidebarWidthRange}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div style={rowStyle} title={group.title}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.sidebarMachineCode}</span>
    </div>
  )
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
  /** When the library attaches `.rct-scroll`, re-run effects that register listeners (ref alone does not trigger re-render). */
  const [timelineScrollEl, setTimelineScrollEl] = useState<HTMLDivElement | null>(null)
  const [scrollViewportWidth, setScrollViewportWidth] = useState(0)
  /** Live drag position from the timeline so item spans (chain min-finish) update every frame, not only on drop. */
  const [activeItemDrag, setActiveItemDrag] = useState<{
    itemId: string
    time: number
    newGroupOrder: number
  } | null>(null)
  /** Extrusion duration (hours) for the lane under the cursor — from `/gantt/estimate` while dragging extrusion. */
  const [dragExtrusionDurationHours, setDragExtrusionDurationHours] = useState<number | null>(null)
  /** Live canvas metrics: drives inactive CustomMarker anchor dates + scroll/zoom sync. */
  const [overlayMetrics, setOverlayMetrics] = useState<{
    canvasTimeStart: number
    canvasTimeEnd: number
    canvasWidth: number
  } | null>(null)

  const barByGanttItemId = useMemo(() => {
    const m = new Map<string, { bar: GanttLane['bars'][number]; lane: GanttLane }>()
    for (const lane of lanes) {
      for (const bar of lane.bars) {
        m.set(ganttTimelineItemId(String(bar.job_id), bar.operation_type), { bar, lane })
      }
    }
    return m
  }, [lanes])

  const selectedTimelineItemIds = useMemo(() => {
    if (!selectedJobId) return []
    const out: string[] = []
    for (const lane of lanes) {
      for (const bar of lane.bars) {
        if (String(bar.job_id) === selectedJobId) {
          out.push(ganttTimelineItemId(String(bar.job_id), bar.operation_type))
        }
      }
    }
    return out
  }, [lanes, selectedJobId])

  const groups = useMemo<TimelineGroup[]>(() => {
    return lanes.map((lane) => {
      const range = extruderLaneMmRangeLabel(lane)
      const title = range != null ? `${lane.machine_code} · ${range}` : lane.machine_code
      return {
        id: lane.machine_id,
        title,
        machineType: lane.machine_type,
        height: extruderLaneRowHeightPx(lane),
        sidebarMachineCode: lane.machine_code,
        sidebarWidthRange: range,
      }
    })
  }, [lanes])

  /** Factory inactive wall spans (UTC) → ms for overlay shading + operating-time drag preview */
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

  const inactiveIntervalsMerged = useMemo(
    () => mergeInactiveIntervals(inactiveIntervalsMs),
    [inactiveIntervalsMs],
  )

  /** Only job + target extruder row — not drag time — so we do not refetch every pointer move. */
  const extrusionEstimateTarget = useMemo(() => {
    if (!activeItemDrag) return null
    const parsed = parseGanttTimelineItemId(activeItemDrag.itemId)
    if (parsed?.operationType !== 'extrusion') return null
    const tg = groups[activeItemDrag.newGroupOrder]
    if (!tg || tg.machineType !== 'extruder') return null
    return { jobId: parsed.jobId, machineId: tg.id }
  }, [activeItemDrag?.itemId, activeItemDrag?.newGroupOrder, groups])

  useEffect(() => {
    if (!extrusionEstimateTarget) {
      setDragExtrusionDurationHours(null)
      return
    }
    const { jobId, machineId } = extrusionEstimateTarget
    setDragExtrusionDurationHours(null)
    const ac = new AbortController()
    const tid = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch<{
            estimates: { operations: { operation_type: string; estimated_duration_hours: number }[] }
          }>(
            `/api/schedule/gantt/estimate?job_id=${encodeURIComponent(jobId)}&target_extruder_machine_id=${encodeURIComponent(machineId)}`,
            { signal: ac.signal },
          )
          const ex = res.estimates?.operations?.find((o) => o.operation_type === 'extrusion')
          if (ex != null && Number.isFinite(ex.estimated_duration_hours)) {
            setDragExtrusionDurationHours(ex.estimated_duration_hours)
          }
        } catch {
          if (!ac.signal.aborted) setDragExtrusionDurationHours(null)
        }
      })()
    }, 180)
    return () => {
      ac.abort()
      window.clearTimeout(tid)
    }
  }, [extrusionEstimateTarget])

  const items = useMemo<TimelineItem[]>(
    () =>
      buildGanttTimelineItems(
        lanes,
        groups,
        activeItemDrag,
        inactiveIntervalsMerged,
        dragExtrusionDurationHours,
      ),
    [lanes, groups, activeItemDrag, inactiveIntervalsMerged, dragExtrusionDurationHours],
  )

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
    const ghostBarRowPx = extrusionTaskBarRowPxFromUnqueuedJob(externalDragUnqueuedJob)
    const ghost: TimelineItem = {
      id: UNQUEUED_DROP_PREVIEW_ITEM_ID,
      group: g.id,
      title: `${externalDragUnqueuedJob.job_code} · drop here`,
      start_time: unqueuedDropPreview.startMs,
      end_time: unqueuedDropPreview.endMs,
      canMove: false,
      canResize: false,
      roll_count: Math.max(1, externalDragUnqueuedJob.roll_count || 1),
      height: timelineItemHeightProp(ghostBarRowPx),
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
   * Uncontrolled Timeline defaults: local midnight today → ~1 month visible. Locked after the first
   * successful gantt payload so refetches do not change defaults (avoids remounting the Timeline when the
   * API shifts `calendar.end` with each `now`).
   */
  const [lockedTimelineDefaults, setLockedTimelineDefaults] = useState<{
    defaultTimeStartMs: number
    defaultTimeEndMs: number
  } | null>(null)

  const computedTimelineDefaults = useMemo(() => {
    const start = dayjs().startOf('day').valueOf()
    const end = start + DEFAULT_GANTT_VISIBLE_SPAN_MS
    return { defaultTimeStartMs: start, defaultTimeEndMs: end }
  }, [])

  useLayoutEffect(() => {
    if (!gantt.data) return
    setLockedTimelineDefaults((prev) => prev ?? computedTimelineDefaults)
  }, [gantt.data, computedTimelineDefaults])

  const defaultTimeStartMs = lockedTimelineDefaults?.defaultTimeStartMs ?? computedTimelineDefaults.defaultTimeStartMs
  const defaultTimeEndMs = lockedTimelineDefaults?.defaultTimeEndMs ?? computedTimelineDefaults.defaultTimeEndMs

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

  /** Horizontal pan / wheel updates the visible window. */
  const handleTimelineTimeChange = useCallback(
    (visibleTimeStart: number, visibleTimeEnd: number, updateScrollCanvas: (a: number, b: number) => void) => {
      updateScrollCanvas(visibleTimeStart, visibleTimeEnd)
      requestAnimationFrame(() => {
        syncOverlayFromTimeline()
      })
    },
    [syncOverlayFromTimeline],
  )

  const handleTimelineScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      timelineScrollRef.current = el
      setTimelineScrollEl(el)
      setScrollViewportWidth(el?.clientWidth ?? 0)
      requestAnimationFrame(() => syncOverlayFromTimeline())
    },
    [syncOverlayFromTimeline],
  )

  /** Keep inactive bands aligned: timeline rebuffers canvas on scroll without always updating React visible props. */
  useLayoutEffect(() => {
    if (!timelineScrollEl) return
    const el = timelineScrollEl
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
  }, [timelineScrollEl, syncOverlayFromTimeline])

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      syncOverlayFromTimeline()
    })
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
      setActiveItemDrag(null)
      const id = String(itemId)
      const found = barByGanttItemId.get(id)
      const targetGroup = groups[newGroupOrder]
      if (!found || !targetGroup) return
      if (found.bar.status === 'running') return

      try {
        dispatch(clearScheduleMutationError())
        await dispatch(
          moveScheduleBar({
            job_id: String(found.bar.job_id),
            operation_type: found.bar.operation_type,
            target_machine_id: String(targetGroup.id),
            target_start: new Date(dragTime).toISOString(),
          }),
        ).unwrap()
      } catch {
        /* mutation.error */
      }
    },
    [barByGanttItemId, dispatch, groups],
  )

  const handleItemDrag = useCallback(
    (obj: { eventType: string; itemId: string | number; time: number; newGroupOrder?: number }) => {
      if (obj.eventType !== 'move' || obj.newGroupOrder == null) return
      setActiveItemDrag({
        itemId: String(obj.itemId),
        time: obj.time,
        newGroupOrder: obj.newGroupOrder,
      })
    },
    [],
  )

  const selectedQueued = useMemo(() => {
    if (!selectedJobId) return null
    const ex = barByGanttItemId.get(ganttTimelineItemId(selectedJobId, 'extrusion'))
    if (ex) return ex
    for (const v of barByGanttItemId.values()) {
      if (String(v.bar.job_id) === selectedJobId) return v
    }
    return null
  }, [barByGanttItemId, selectedJobId])
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

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 2, overflow: 'hidden' }}>
        <Box
          sx={{
            width: { xs: '100%', lg: 320 },
            minWidth: 0,
            flexShrink: { lg: 0 },
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
          <Box
            sx={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              minWidth: 0,
            }}
          >
            <Typography variant="h5" component="h1" sx={{ lineHeight: 1.2, minWidth: 0 }}>
              Schedule
            </Typography>
            {mutation.status === 'loading' ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }} aria-live="polite" aria-busy="true">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  Saving…
                </Typography>
              </Box>
            ) : null}
          </Box>

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
            {/* Stable key: refetch must not remount or zoom/scroll reset (calendar.end shifts with each API `now`).
                stackItems=false: overlapping jobs keep fixed lane height; bars overlap in Z-order (hover raises). */}
            <Timeline<TimelineItem, TimelineGroup>
              key="schedule-gantt-timeline"
              ref={timelineRef}
              groups={groups}
              items={itemsWithUnqueuedPreview}
              defaultTimeStart={defaultTimeStartMs}
              defaultTimeEnd={defaultTimeEndMs}
              onTimeChange={handleTimelineTimeChange}
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
              stackItems={false}
              lineHeight={DEFAULT_LANE_ROW_PX}
              itemHeightRatio={GANTT_ITEM_HEIGHT_RATIO}
              itemVerticalGap={GANTT_LANE_ITEM_VERTICAL_GAP_PX}
              buffer={TIMELINE_BUFFER}
              selected={selectedTimelineItemIds}
              onItemSelect={(itemId: string | number) => {
                const s = String(itemId)
                if (s === UNQUEUED_DROP_PREVIEW_ITEM_ID) return
                const p = parseGanttTimelineItemId(s)
                setSelectedJobId(p?.jobId ?? null)
              }}
              onCanvasClick={() => setSelectedJobId(null)}
              onItemDrag={handleItemDrag}
              onItemMove={(itemId: string | number, dragTime: number, newGroupOrder: number) =>
                void onItemMove(itemId as string | number, dragTime, newGroupOrder)
              }
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- library itemRenderer props not exported from package root */
              itemRenderer={ganttTimelineItemRenderer as any}
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- library groupRenderer props not exported from package root */
              groupRenderer={ganttTimelineGroupRenderer as any}
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
                  {({ styles }: MarkerRenderProps) => (
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

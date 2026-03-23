import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type GanttToolConflict = {
  tool_type_code: string
  from?: string | null
  to?: string | null
  reason: string
}

export type GanttToolStrip = {
  tool_type_code: string
  name: string
  color: string
  tool_serial?: string | null
}

export type GanttBar = {
  job_id: string
  job_code: string
  operation_type: string
  customer: string
  product_code: string
  planned_qty: number
  estimated_duration_hours: number
  roll_count?: number
  hours_per_roll?: number
  job_sheet_job_no?: string | null
  /** Layflat / web width (mm) from product spec — same basis as extruder rate-card width check */
  job_layflat_width_mm?: number | null
  tentative_start: string | null
  tentative_finish: string | null
  status: string
  readiness: string
  requires_uteco: boolean
  requires_inline_print: boolean
  num_colours: number
  warnings: string[]
  tool_conflicts: GanttToolConflict[]
  tool_strips?: GanttToolStrip[]
}

export type GanttLane = {
  machine_id: string
  machine_code: string
  machine_type: string
  /** Extruder rate card film width range (mm); null for non-extrusion lanes */
  film_width_min_mm?: number | null
  film_width_max_mm?: number | null
  bars: GanttBar[]
}

export type GanttCalendar = {
  start?: string
  end?: string
  days?: number
  hours_per_day?: number
  /** IANA timezone for interpreting local operating hours */
  timezone?: string
}

export type ToolboxBalance = {
  tool_type_code: string
  name: string
  color: string
  total_active: number
  reserved: number
  available: number
}

export type GanttOverview = {
  lanes: GanttLane[]
  calendar: GanttCalendar
  extrusion_toolbox?: ToolboxBalance[]
}

export type UnqueuedScheduleJob = {
  job_id: string
  order_code: string
  job_code: string
  customer: string
  product_code: string
  planned_qty: number
  roll_count: number
  job_sheet_job_no?: string | null
  job_layflat_width_mm?: number | null
}

type ScheduleState = {
  gantt: {
    status: Status
    error: string | null
    data: GanttOverview | null
  }
  unqueued: {
    status: Status
    error: string | null
    jobs: UnqueuedScheduleJob[]
  }
  mutation: {
    status: Status
    error: string | null
  }
}

const initialState: ScheduleState = {
  gantt: { status: 'idle', error: null, data: null },
  unqueued: { status: 'idle', error: null, jobs: [] },
  mutation: { status: 'idle', error: null },
}

function toErrorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message || fallback
  // Redux Toolkit serializes thrown errors to a plain object { message, name, ... }
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  return fallback
}

export const fetchScheduleGantt = createAsyncThunk('schedule/gantt', async () => {
  const res = await apiFetch<{ gantt_data: GanttOverview }>('/api/schedule/gantt')
  return res.gantt_data
})

export const fetchUnqueuedScheduleJobs = createAsyncThunk('schedule/unqueued', async () => {
  const res = await apiFetch<{ jobs: UnqueuedScheduleJob[] }>('/api/schedule/unqueued')
  return res.jobs
})

export const addJobToScheduleQueue = createAsyncThunk(
  'schedule/queueAdd',
  async (
    payload: { machine_id: string; job_id: string; position?: number; target_start?: string },
    { dispatch },
  ) => {
    const body: Record<string, unknown> = {
      machine_id: payload.machine_id,
      job_id: payload.job_id,
    }
    if (payload.target_start != null) body.target_start = payload.target_start
    else if (payload.position != null) body.position = payload.position
    await apiFetch('/api/schedule/queue/add', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await dispatch(fetchScheduleGantt()).unwrap()
    await dispatch(fetchUnqueuedScheduleJobs()).unwrap()
    return payload
  },
)

export const reorderScheduleLane = createAsyncThunk(
  'schedule/reorder',
  async (payload: { machine_id: string; job_id: string; new_position: number }, { dispatch }) => {
    await apiFetch('/api/schedule/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({
        machine_id: payload.machine_id,
        job_id: payload.job_id,
        new_position: payload.new_position,
      }),
    })
    await dispatch(fetchScheduleGantt()).unwrap()
    return payload
  },
)

export const moveScheduleBar = createAsyncThunk(
  'schedule/move',
  async (
    payload: {
      job_id: string
      operation_type: string
      target_machine_id: string
      target_position: number
      target_start?: string
    },
    { dispatch },
  ) => {
    const body: Record<string, unknown> = {
      job_id: payload.job_id,
      operation_type: payload.operation_type,
      target_machine_id: payload.target_machine_id,
      target_position: payload.target_position,
    }
    if (payload.target_start != null) body.target_start = payload.target_start
    await apiFetch('/api/schedule/gantt/move', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await dispatch(fetchScheduleGantt()).unwrap()
    return payload
  },
)

export const removeJobFromScheduleQueue = createAsyncThunk(
  'schedule/queueRemove',
  async (payload: { machine_id: string; job_id: string }, { dispatch }) => {
    await apiFetch('/api/schedule/queue/remove', {
      method: 'POST',
      body: JSON.stringify({
        machine_id: payload.machine_id,
        job_id: payload.job_id,
      }),
    })
    await dispatch(fetchScheduleGantt()).unwrap()
    await dispatch(fetchUnqueuedScheduleJobs()).unwrap()
    return payload
  },
)

const slice = createSlice({
  name: 'schedule',
  initialState,
  reducers: {
    clearScheduleMutationError(s) {
      s.mutation.error = null
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchScheduleGantt.pending, (s) => {
      s.gantt.status = 'loading'
      s.gantt.error = null
    })
    b.addCase(fetchScheduleGantt.fulfilled, (s, a) => {
      s.gantt.status = 'succeeded'
      s.gantt.data = a.payload
      s.gantt.error = null
    })
    b.addCase(fetchScheduleGantt.rejected, (s, a) => {
      s.gantt.status = 'failed'
      s.gantt.error = toErrorMessage(a.error, 'Failed to load schedule')
      s.gantt.data = null
    })

    b.addCase(fetchUnqueuedScheduleJobs.pending, (s) => {
      s.unqueued.status = 'loading'
      s.unqueued.error = null
    })
    b.addCase(fetchUnqueuedScheduleJobs.fulfilled, (s, a) => {
      s.unqueued.status = 'succeeded'
      s.unqueued.jobs = a.payload
      s.unqueued.error = null
    })
    b.addCase(fetchUnqueuedScheduleJobs.rejected, (s, a) => {
      s.unqueued.status = 'failed'
      s.unqueued.error = toErrorMessage(a.error, 'Failed to load unqueued jobs')
      s.unqueued.jobs = []
    })

    const mutationPending = (s: ScheduleState) => {
      s.mutation.status = 'loading'
      s.mutation.error = null
    }
    const mutationFulfilled = (s: ScheduleState) => {
      s.mutation.status = 'idle'
      s.mutation.error = null
    }
    const mutationRejected = (s: ScheduleState, a: { error: unknown }) => {
      s.mutation.status = 'failed'
      s.mutation.error = toErrorMessage(a.error, 'Request failed')
    }

    b.addCase(reorderScheduleLane.pending, mutationPending)
    b.addCase(reorderScheduleLane.fulfilled, mutationFulfilled)
    b.addCase(reorderScheduleLane.rejected, mutationRejected)

    b.addCase(moveScheduleBar.pending, mutationPending)
    b.addCase(moveScheduleBar.fulfilled, mutationFulfilled)
    b.addCase(moveScheduleBar.rejected, mutationRejected)

    b.addCase(addJobToScheduleQueue.pending, mutationPending)
    b.addCase(addJobToScheduleQueue.fulfilled, mutationFulfilled)
    b.addCase(addJobToScheduleQueue.rejected, mutationRejected)

    b.addCase(removeJobFromScheduleQueue.pending, mutationPending)
    b.addCase(removeJobFromScheduleQueue.fulfilled, mutationFulfilled)
    b.addCase(removeJobFromScheduleQueue.rejected, mutationRejected)
  },
})

export const scheduleReducer = slice.reducer
export const { clearScheduleMutationError } = slice.actions

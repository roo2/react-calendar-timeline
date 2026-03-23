import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type WeekdayHours = { enabled: boolean; start: string; end: string }

export type ProductionCalendarSettings = {
  timezone: string
  gantt_preview_weeks: number
  weekdays: Record<string, WeekdayHours>
}

export type CalendarExceptionRow = {
  id: string
  exception_date: string
  closed: boolean
  open_time?: string | null
  close_time?: string | null
  note?: string | null
}

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

type State = {
  settings: { status: Status; error: string | null; data: ProductionCalendarSettings | null }
  exceptions: { status: Status; error: string | null; list: CalendarExceptionRow[] }
  save: { status: Status; error: string | null }
}

const initialState: State = {
  settings: { status: 'idle', error: null, data: null },
  exceptions: { status: 'idle', error: null, list: [] },
  save: { status: 'idle', error: null },
}

function toErrorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export const fetchProductionCalendarSettings = createAsyncThunk(
  'productionCalendar/settingsLoad',
  async () => {
    return await apiFetch<ProductionCalendarSettings>('/api/admin/production-calendar/settings')
  },
)

export const saveProductionCalendarSettings = createAsyncThunk(
  'productionCalendar/settingsSave',
  async (payload: ProductionCalendarSettings) => {
    await apiFetch('/api/admin/production-calendar/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    return await apiFetch<ProductionCalendarSettings>('/api/admin/production-calendar/settings')
  },
)

export const fetchCalendarExceptions = createAsyncThunk('productionCalendar/exceptionsLoad', async () => {
  const res = await apiFetch<{ exceptions: CalendarExceptionRow[] }>(
    '/api/admin/production-calendar/exceptions',
  )
  return res.exceptions
})

export const createCalendarException = createAsyncThunk(
  'productionCalendar/exceptionCreate',
  async (payload: {
    exception_date: string
    closed: boolean
    open_time?: string
    close_time?: string
    note?: string
  }) => {
    const res = await apiFetch<{ exception: CalendarExceptionRow }>(
      '/api/admin/production-calendar/exceptions',
      { method: 'POST', body: JSON.stringify(payload) },
    )
    return res.exception
  },
)

export const deleteCalendarException = createAsyncThunk(
  'productionCalendar/exceptionDelete',
  async (id: string) => {
    await apiFetch(`/api/admin/production-calendar/exceptions/${id}`, { method: 'DELETE' })
    return id
  },
)

const slice = createSlice({
  name: 'productionCalendar',
  initialState,
  reducers: {
    clearProductionCalendarSaveError(s) {
      s.save.error = null
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchProductionCalendarSettings.pending, (s) => {
      s.settings.status = 'loading'
      s.settings.error = null
    })
    b.addCase(fetchProductionCalendarSettings.fulfilled, (s, a) => {
      s.settings.status = 'succeeded'
      s.settings.data = a.payload
      s.settings.error = null
    })
    b.addCase(fetchProductionCalendarSettings.rejected, (s, a) => {
      s.settings.status = 'failed'
      s.settings.error = toErrorMessage(a.error, 'Failed to load settings')
    })

    b.addCase(saveProductionCalendarSettings.pending, (s) => {
      s.save.status = 'loading'
      s.save.error = null
    })
    b.addCase(saveProductionCalendarSettings.fulfilled, (s, a) => {
      s.save.status = 'idle'
      s.settings.data = a.payload
      s.save.error = null
    })
    b.addCase(saveProductionCalendarSettings.rejected, (s, a) => {
      s.save.status = 'failed'
      s.save.error = toErrorMessage(a.error, 'Save failed')
    })

    b.addCase(fetchCalendarExceptions.pending, (s) => {
      s.exceptions.status = 'loading'
      s.exceptions.error = null
    })
    b.addCase(fetchCalendarExceptions.fulfilled, (s, a) => {
      s.exceptions.status = 'succeeded'
      s.exceptions.list = a.payload
    })
    b.addCase(fetchCalendarExceptions.rejected, (s, a) => {
      s.exceptions.status = 'failed'
      s.exceptions.error = toErrorMessage(a.error, 'Failed to load exceptions')
    })

    b.addCase(createCalendarException.fulfilled, (s, a) => {
      s.exceptions.list = [...s.exceptions.list, a.payload].sort((x, y) =>
        x.exception_date.localeCompare(y.exception_date),
      )
    })
    b.addCase(deleteCalendarException.fulfilled, (s, a) => {
      s.exceptions.list = s.exceptions.list.filter((x) => x.id !== a.payload)
    })
  },
})

export const productionCalendarReducer = slice.reducer
export const { clearProductionCalendarSaveError } = slice.actions
export { WEEKDAYS }

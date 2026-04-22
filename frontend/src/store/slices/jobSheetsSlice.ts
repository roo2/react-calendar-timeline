import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type JobSheetSummary = {
  id: string
  job_no: string
  customer_id?: string
  product_id?: string
  product_version_id?: string
  customer_name?: string | null
  product_code: string
  product_description?: string | null
  due_date?: string | null
  quantity_value: number
  quantity_unit: string
  qty_type?: string
  num_product_units?: number | null
  weight_per_roll_kg?: number | null
  num_rolls?: number
  created_at?: string | null
  order_id?: string | null
  invoice_no?: string | null
  order_date?: string | null
  order_status?: string | null
  production_status?: string | null
  production_started_at?: string | null
  production_finished_at?: string | null
  status_label?: string | null
  unit_rate?: number | null
  line_total?: number | null
  price_per_kg?: number | null
}

/** Query params for GET /api/job-sheets (match-style filters). */
export type JobSheetListQuery = {
  customer_id?: string
  product_type?: string
  printed?: string
  finish_mode?: string
  width_min_mm?: number
  width_max_mm?: number
  length_min_mm?: number
  length_max_mm?: number
  gauge_min_um?: number
  gauge_max_um?: number
  from_date?: string
  to_date?: string
  order_status?: string
  production_status?: string
  search?: string
  page?: number
  page_size?: number
}

function jobSheetListQueryToSearchParams(q: JobSheetListQuery): URLSearchParams {
  const qs = new URLSearchParams()
  const set = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === null) return
    const s = typeof v === 'number' ? String(v) : String(v).trim()
    if (s !== '') qs.set(k, s)
  }
  set('customer_id', q.customer_id)
  set('product_type', q.product_type)
  set('printed', q.printed)
  set('finish_mode', q.finish_mode)
  set('width_min_mm', q.width_min_mm)
  set('width_max_mm', q.width_max_mm)
  set('length_min_mm', q.length_min_mm)
  set('length_max_mm', q.length_max_mm)
  set('gauge_min_um', q.gauge_min_um)
  set('gauge_max_um', q.gauge_max_um)
  set('from_date', q.from_date)
  set('to_date', q.to_date)
  set('order_status', q.order_status)
  set('production_status', q.production_status)
  set('search', q.search)
  set('page', q.page)
  set('page_size', q.page_size)
  return qs
}

type JobSheetsState = {
  list: {
    status: Status
    error: string | null
    items: JobSheetSummary[]
    total: number
    page: number
    pageSize: number
  }
  detail: {
    byId: Record<
      string,
      {
        status: Status
        error: string | null
        data: any | null
      }
    >
  }
}

const initialState: JobSheetsState = {
  list: { status: 'idle', error: null, items: [], total: 0, page: 1, pageSize: 100 },
  detail: { byId: {} },
}

export const fetchJobSheets = createAsyncThunk(
  'jobSheets/list',
  async (query?: JobSheetListQuery) => {
    const qs = query ? jobSheetListQueryToSearchParams(query) : new URLSearchParams()
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const res = await apiFetch<{ items: JobSheetSummary[]; total?: number; page?: number; page_size?: number }>(
      `/api/job-sheets${suffix}`,
    )
    return {
      items: res.items || [],
      total: Number(res.total) || 0,
      page: Number(res.page) || Number(query?.page) || 1,
      pageSize: Number(res.page_size) || Number(query?.page_size) || 100,
    }
  },
)

export const fetchJobSheet = createAsyncThunk('jobSheets/detail', async (jobSheetId: string) => {
  const data = await apiFetch<any>(`/api/job-sheets/${encodeURIComponent(jobSheetId)}`)
  return { jobSheetId, data }
})

export const createJobSheet = createAsyncThunk('jobSheets/create', async (body: Record<string, unknown>) => {
  return await apiFetch<{ ok: boolean; job_sheet: JobSheetSummary }>('/api/job-sheets', {
    method: 'POST',
    body: JSON.stringify(body),
  })
})

export const updateJobSheet = createAsyncThunk(
  'jobSheets/update',
  async (payload: { jobSheetId: string; body: Record<string, unknown> }) => {
    const { jobSheetId, body } = payload
    return await apiFetch<{ ok: boolean; job_sheet: JobSheetSummary }>(`/api/job-sheets/${encodeURIComponent(jobSheetId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  },
)

const slice = createSlice({
  name: 'jobSheets',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchJobSheets.pending, (s) => {
      s.list.status = 'loading'
      s.list.error = null
    })
    b.addCase(fetchJobSheets.fulfilled, (s, a) => {
      s.list.status = 'succeeded'
      s.list.items = a.payload.items
      s.list.total = a.payload.total
      s.list.page = a.payload.page
      s.list.pageSize = a.payload.pageSize
      s.list.error = null
    })
    b.addCase(fetchJobSheets.rejected, (s, a) => {
      s.list.status = 'failed'
      s.list.error = a.error.message || 'Failed to load job sheets'
    })

    b.addCase(fetchJobSheet.pending, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
      s.detail.byId[id].status = 'loading'
      s.detail.byId[id].error = null
    })
    b.addCase(fetchJobSheet.fulfilled, (s, a) => {
      const { jobSheetId, data } = a.payload
      s.detail.byId[jobSheetId] = { status: 'succeeded', error: null, data }
    })
    b.addCase(fetchJobSheet.rejected, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
      s.detail.byId[id].status = 'failed'
      s.detail.byId[id].error = a.error.message || 'Failed to load job sheet'
      s.detail.byId[id].data = null
    })

    b.addCase(createJobSheet.fulfilled, (s, a) => {
      const id = a.payload?.job_sheet?.id
      if (!id) return
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
    })
    b.addCase(updateJobSheet.fulfilled, (s, a) => {
      const id = a.meta.arg.jobSheetId
      if (!a.payload?.job_sheet?.id) return
      const prev = s.detail.byId[id]
      s.detail.byId[id] = prev || { status: 'succeeded', error: null, data: null }
      s.detail.byId[id].status = 'succeeded'
      s.detail.byId[id].error = null
      const prevData = s.detail.byId[id].data
      if (prevData && typeof prevData === 'object' && prevData !== null) {
        s.detail.byId[id].data = { ...prevData, job_sheet: a.payload.job_sheet }
      }
    })
  },
})

export const jobSheetsReducer = slice.reducer

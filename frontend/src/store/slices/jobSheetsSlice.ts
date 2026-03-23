import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type JobSheetSummary = {
  id: string
  job_no: string
  customer_name?: string | null
  customer_code?: string | null
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
  invoice_no?: string | null
  order_date?: string | null
}

type JobSheetsState = {
  list: {
    status: Status
    error: string | null
    items: JobSheetSummary[]
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
  list: { status: 'idle', error: null, items: [] },
  detail: { byId: {} },
}

export const fetchJobSheets = createAsyncThunk('jobSheets/list', async () => {
  const res = await apiFetch<{ items: JobSheetSummary[] }>('/api/job-sheets')
  return res.items || []
})

export const fetchJobSheet = createAsyncThunk('jobSheets/detail', async (jobSheetId: string) => {
  const data = await apiFetch<any>(`/api/job-sheets/${encodeURIComponent(jobSheetId)}`)
  return { jobSheetId, data }
})

export const createJobSheet = createAsyncThunk('jobSheets/create', async (body: Record<string, unknown>) => {
  return await apiFetch<{ ok: boolean; job_sheet: { id: string; job_no?: string } }>('/api/job-sheets', {
    method: 'POST',
    body: JSON.stringify(body),
  })
})

export const updateJobSheet = createAsyncThunk(
  'jobSheets/update',
  async (payload: { jobSheetId: string; body: Record<string, unknown> }) => {
    const { jobSheetId, body } = payload
    return await apiFetch<{ ok: boolean; job_sheet: { id: string } }>(`/api/job-sheets/${encodeURIComponent(jobSheetId)}`, {
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
      s.list.items = a.payload
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
      if (a.payload?.job_sheet?.id) {
        s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
      }
    })
  },
})

export const jobSheetsReducer = slice.reducer

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

type DashboardState = {
  inventorySnapshot: { status: Status; error: string | null; data: unknown | null }
  throughputWeekly: { status: Status; error: string | null; data: unknown | null }
}

const initialState: DashboardState = {
  inventorySnapshot: { status: 'idle', error: null, data: null },
  throughputWeekly: { status: 'idle', error: null, data: null },
}

export const fetchDashboardPartials = createAsyncThunk('dashboard/partials', async () => {
  const [inventory, throughput] = await Promise.all([
    apiFetch<unknown>('/api/dashboard/partial/inventory_snapshot'),
    apiFetch<unknown>('/api/dashboard/partial/throughput_weekly'),
  ])
  return { inventory, throughput }
})

const slice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchDashboardPartials.pending, (s) => {
      s.inventorySnapshot.status = 'loading'
      s.inventorySnapshot.error = null
      s.throughputWeekly.status = 'loading'
      s.throughputWeekly.error = null
    })
    b.addCase(fetchDashboardPartials.fulfilled, (s, a) => {
      s.inventorySnapshot = { status: 'succeeded', error: null, data: a.payload.inventory }
      s.throughputWeekly = { status: 'succeeded', error: null, data: a.payload.throughput }
    })
    b.addCase(fetchDashboardPartials.rejected, (s, a) => {
      const msg = a.error.message || 'Failed to load dashboard'
      s.inventorySnapshot = { status: 'failed', error: msg, data: null }
      s.throughputWeekly = { status: 'failed', error: msg, data: null }
    })
  },
})

export const dashboardReducer = slice.reducer

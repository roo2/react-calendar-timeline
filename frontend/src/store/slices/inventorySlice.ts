import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

function toErrorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export type ReceiveInventoryPayload = {
  category: 'raw_material'
  item_id: string | null
  quantity: string
  uom: string
}

export type AdjustInventoryPayload = {
  category: string
  item_id: string | null
  quantity: string
  uom: string
  note: string | null
}

export type InventoryDashboardSnapshot = {
  raw_kg: string
  wip_extrusion_kg: string
  wip_printing_kg: string
  fg_units: string
}

type InventoryState = {
  receive: {
    status: Status
    error: string | null
  }
  adjust: {
    status: Status
    error: string | null
  }
  dashboard: {
    status: Status
    error: string | null
    data: InventoryDashboardSnapshot | null
  }
  transactions: {
    status: Status
    error: string | null
    data: unknown | null
    lastQuery: string
  }
}

const initialState: InventoryState = {
  receive: { status: 'idle', error: null },
  adjust: { status: 'idle', error: null },
  dashboard: { status: 'idle', error: null, data: null },
  transactions: { status: 'idle', error: null, data: null, lastQuery: '' },
}

export const receiveInventory = createAsyncThunk('inventory/receive', async (payload: ReceiveInventoryPayload) => {
  await apiFetch('/api/inventory/receive', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return { ok: true }
})

export const adjustInventory = createAsyncThunk('inventory/adjust', async (payload: AdjustInventoryPayload) => {
  await apiFetch('/api/inventory/adjust', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return { ok: true }
})

export const fetchInventoryDashboard = createAsyncThunk('inventory/dashboard', async () => {
  return await apiFetch<InventoryDashboardSnapshot>('/api/inventory/dashboard')
})

export const fetchInventoryTransactions = createAsyncThunk('inventory/transactions', async (queryString: string) => {
  const qs = queryString.startsWith('?') ? queryString.slice(1) : queryString
  const data = await apiFetch<unknown>(`/api/inventory/transactions?${qs}`)
  return { queryString: qs, data }
})

const slice = createSlice({
  name: 'inventory',
  initialState,
  reducers: {
    clearReceiveError(s) {
      s.receive.error = null
    },
    clearAdjustError(s) {
      s.adjust.error = null
    },
  },
  extraReducers: (b) => {
    b.addCase(receiveInventory.pending, (s) => {
      s.receive.status = 'loading'
      s.receive.error = null
    })
    b.addCase(receiveInventory.fulfilled, (s) => {
      s.receive.status = 'succeeded'
      s.receive.error = null
    })
    b.addCase(receiveInventory.rejected, (s, a) => {
      s.receive.status = 'failed'
      s.receive.error = toErrorMessage(a.error, 'Failed to receive inventory')
    })

    b.addCase(adjustInventory.pending, (s) => {
      s.adjust.status = 'loading'
      s.adjust.error = null
    })
    b.addCase(adjustInventory.fulfilled, (s) => {
      s.adjust.status = 'succeeded'
      s.adjust.error = null
    })
    b.addCase(adjustInventory.rejected, (s, a) => {
      s.adjust.status = 'failed'
      s.adjust.error = toErrorMessage(a.error, 'Failed to adjust inventory')
    })

    b.addCase(fetchInventoryDashboard.pending, (s) => {
      s.dashboard.status = 'loading'
      s.dashboard.error = null
    })
    b.addCase(fetchInventoryDashboard.fulfilled, (s, a) => {
      s.dashboard.status = 'succeeded'
      s.dashboard.data = a.payload
      s.dashboard.error = null
    })
    b.addCase(fetchInventoryDashboard.rejected, (s, a) => {
      s.dashboard.status = 'failed'
      s.dashboard.error = toErrorMessage(a.error, 'Failed to load inventory')
      s.dashboard.data = null
    })

    b.addCase(fetchInventoryTransactions.pending, (s, a) => {
      s.transactions.status = 'loading'
      s.transactions.error = null
      const nextQs = a.meta.arg.startsWith('?') ? a.meta.arg.slice(1) : a.meta.arg
      if (s.transactions.lastQuery !== nextQs) {
        s.transactions.data = null
      }
    })
    b.addCase(fetchInventoryTransactions.fulfilled, (s, a) => {
      s.transactions.status = 'succeeded'
      s.transactions.data = a.payload.data
      s.transactions.lastQuery = a.payload.queryString
      s.transactions.error = null
    })
    b.addCase(fetchInventoryTransactions.rejected, (s, a) => {
      s.transactions.status = 'failed'
      s.transactions.error = toErrorMessage(a.error, 'Failed to load transactions')
      s.transactions.data = null
    })
  },
})

export const inventoryReducer = slice.reducer
export const { clearReceiveError, clearAdjustError } = slice.actions


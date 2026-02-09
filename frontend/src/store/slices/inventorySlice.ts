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

type InventoryState = {
  receive: {
    status: Status
    error: string | null
  }
  adjust: {
    status: Status
    error: string | null
  }
}

const initialState: InventoryState = {
  receive: { status: 'idle', error: null },
  adjust: { status: 'idle', error: null },
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
  },
})

export const inventoryReducer = slice.reducer
export const { clearReceiveError, clearAdjustError } = slice.actions


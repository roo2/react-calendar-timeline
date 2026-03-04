import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

export type QuotesBootstrap = {
  product_versions?: Array<{ version_id: string; display_name: string; product_code: string; version_number: number }>
  customers: Array<{ id: string; code?: string | null; name: string }>
  resins?: Array<{ code: string; name: string }>
  colours?: Array<{ code: string; name: string }>
  additives?: Array<{ code: string; name: string }>
  cores?: Array<{ type: string; description: string }>
  extruders?: Array<{ code: string; width_range_mm?: unknown; gauge_range_um?: unknown }>
  product_types?: string[]
  geometries?: string[]
  print_methods?: string[]
  finish_modes?: string[]
}

export type SavedQuoteResponse = {
  id: string
  customer_id: string
  customer_name?: string | null
  payload: Record<string, unknown>
  /** Strings from API to preserve exact decimals (avoids JSON number rounding on reload) */
  cost_per_kg?: string | null
  price_per_kg?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

type QuotesState = {
  bootstrap: {
    status: Status
    error: string | null
    data: QuotesBootstrap | null
  }
  detail: {
    byId: Record<
      string,
      {
        status: Status
        error: string | null
        quote: SavedQuoteResponse | null
      }
    >
  }
  upsert: {
    status: Status
    error: string | null
  }
}

const initialState: QuotesState = {
  bootstrap: { status: 'idle', error: null, data: null },
  detail: { byId: {} },
  upsert: { status: 'idle', error: null },
}

export const fetchQuotesBootstrap = createAsyncThunk(
  'quotes/bootstrap',
  async () => {
    const data = await apiFetch<QuotesBootstrap>('/api/quotes/bootstrap')
    return data
  },
)

export const fetchSavedQuote = createAsyncThunk(
  'quotes/detail',
  async (quoteId: string) => {
    const quote = await apiFetch<SavedQuoteResponse>(
      `/api/quotes/saved/${encodeURIComponent(quoteId)}`,
    )
    return { quoteId, quote }
  },
)

export const createSavedQuote = createAsyncThunk(
  'quotes/create',
  async (payload: {
    customer_id: string
    payload: Record<string, unknown>
    cost_per_kg: number | null
    price_per_kg: number | null
  }) => {
    const quote = await apiFetch<SavedQuoteResponse>('/api/quotes/saved', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return quote
  },
)

export const updateSavedQuote = createAsyncThunk(
  'quotes/update',
  async (payload: {
    quoteId: string
    payload?: Record<string, unknown>
    cost_per_kg?: number | null
    price_per_kg?: number | null
  }) => {
    const { quoteId, ...body } = payload
    const quote = await apiFetch<SavedQuoteResponse>(
      `/api/quotes/saved/${encodeURIComponent(quoteId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    )
    return quote
  },
)

const slice = createSlice({
  name: 'quotes',
  initialState,
  reducers: {
    clearUpsertErrors(s) {
      s.upsert.error = null
    },
    clearDetail(s, a: { payload: string }) {
      const id = a.payload
      if (s.detail.byId[id]) delete s.detail.byId[id]
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchQuotesBootstrap.pending, (s) => {
      s.bootstrap.status = 'loading'
      s.bootstrap.error = null
    })
    b.addCase(fetchQuotesBootstrap.fulfilled, (s, a) => {
      s.bootstrap.status = 'succeeded'
      s.bootstrap.data = a.payload
      s.bootstrap.error = null
    })
    b.addCase(fetchQuotesBootstrap.rejected, (s, a) => {
      s.bootstrap.status = 'failed'
      s.bootstrap.error = a.error.message || 'Failed to load quote data'
    })

    b.addCase(fetchSavedQuote.pending, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, quote: null }
      s.detail.byId[id].status = 'loading'
      s.detail.byId[id].error = null
    })
    b.addCase(fetchSavedQuote.fulfilled, (s, a) => {
      const { quoteId, quote } = a.payload
      s.detail.byId[quoteId] = { status: 'succeeded', error: null, quote }
    })
    b.addCase(fetchSavedQuote.rejected, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, quote: null }
      s.detail.byId[id].status = 'failed'
      s.detail.byId[id].error = a.error.message || 'Failed to load quote'
    })

    b.addCase(createSavedQuote.pending, (s) => {
      s.upsert.status = 'loading'
      s.upsert.error = null
    })
    b.addCase(createSavedQuote.fulfilled, (s) => {
      s.upsert.status = 'succeeded'
      s.upsert.error = null
    })
    b.addCase(createSavedQuote.rejected, (s, a) => {
      s.upsert.status = 'failed'
      s.upsert.error = a.error.message || 'Failed to save quote'
    })

    b.addCase(updateSavedQuote.pending, (s) => {
      s.upsert.status = 'loading'
      s.upsert.error = null
    })
    b.addCase(updateSavedQuote.fulfilled, (s) => {
      s.upsert.status = 'succeeded'
      s.upsert.error = null
    })
    b.addCase(updateSavedQuote.rejected, (s, a) => {
      s.upsert.status = 'failed'
      s.upsert.error = a.error.message || 'Failed to update quote'
    })
  },
})

export const quotesReducer = slice.reducer
export const { clearUpsertErrors, clearDetail } = slice.actions

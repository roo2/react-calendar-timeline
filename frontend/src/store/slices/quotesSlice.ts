import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'
import type { QuoteRatebook } from '../../utils/quoteCalculator'

export type QuotesBootstrap = {
  product_versions?: Array<{ version_id: string; display_name: string; product_code: string; version_number: number }>
  customers: Array<{ id: string; code?: string | null; name: string }>
  resins?: Array<{ code: string; name: string }>
  colours?: Array<{ code: string; name: string }>
  additives?: Array<{ code: string; name: string }>
  cores?: Array<{ type: string; description: string }>
  extruders?: Array<{ code: string; width_range_mm?: unknown; gauge_range_um?: unknown }>
  /** Default margin % for new quotes (from admin Defaults / DB). */
  default_margin_pct?: number
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

/** GET /api/rate-cards/resin-blends row (used by quick quote UI). */
export type ResinBlendPresetRow = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
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
  savedList: {
    status: Status
    error: string | null
    items: SavedQuoteResponse[]
    lastCustomerId: string | null
  }
  quoteRatebook: {
    status: Status
    error: string | null
    data: QuoteRatebook | null
  }
  quoteResinBlends: {
    status: Status
    error: string | null
    items: ResinBlendPresetRow[]
  }
}

const initialState: QuotesState = {
  bootstrap: { status: 'idle', error: null, data: null },
  detail: { byId: {} },
  upsert: { status: 'idle', error: null },
  savedList: { status: 'idle', error: null, items: [], lastCustomerId: null },
  quoteRatebook: { status: 'idle', error: null, data: null },
  quoteResinBlends: { status: 'idle', error: null, items: [] },
}

export const fetchQuotesBootstrap = createAsyncThunk(
  'quotes/bootstrap',
  async () => {
    const data = await apiFetch<QuotesBootstrap>('/api/quotes/bootstrap')
    return data
  },
)

export const fetchSavedQuotesList = createAsyncThunk(
  'quotes/savedList',
  async (params: { customer_id?: string } | undefined) => {
    const cid = params?.customer_id?.trim()
    const url = cid ? `/api/quotes/saved?customer_id=${encodeURIComponent(cid)}` : '/api/quotes/saved'
    const rows = await apiFetch<SavedQuoteResponse[]>(url)
    return { customer_id: cid ?? null, items: Array.isArray(rows) ? rows : [] }
  },
)

export const fetchQuoteRatebook = createAsyncThunk('quotes/ratebook', async () => {
  return await apiFetch<QuoteRatebook>('/api/rate-cards/ratebook')
})

export const fetchQuoteResinBlends = createAsyncThunk('quotes/resinBlends', async () => {
  const rows = await apiFetch<ResinBlendPresetRow[]>('/api/rate-cards/resin-blends')
  return Array.isArray(rows) ? rows : []
})

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

    b.addCase(fetchSavedQuotesList.pending, (s) => {
      s.savedList.status = 'loading'
      s.savedList.error = null
    })
    b.addCase(fetchSavedQuotesList.fulfilled, (s, a) => {
      s.savedList.status = 'succeeded'
      s.savedList.items = a.payload.items
      s.savedList.lastCustomerId = a.payload.customer_id
      s.savedList.error = null
    })
    b.addCase(fetchSavedQuotesList.rejected, (s, a) => {
      s.savedList.status = 'failed'
      s.savedList.error = a.error.message || 'Failed to load quotes'
      s.savedList.lastCustomerId = a.meta.arg?.customer_id?.trim() ?? null
    })

    b.addCase(fetchQuoteRatebook.pending, (s) => {
      s.quoteRatebook.status = 'loading'
      s.quoteRatebook.error = null
    })
    b.addCase(fetchQuoteRatebook.fulfilled, (s, a) => {
      s.quoteRatebook.status = 'succeeded'
      s.quoteRatebook.data = a.payload
      s.quoteRatebook.error = null
    })
    b.addCase(fetchQuoteRatebook.rejected, (s, a) => {
      s.quoteRatebook.status = 'failed'
      s.quoteRatebook.error = a.error.message || 'Failed to load pricing rates'
      s.quoteRatebook.data = null
    })

    b.addCase(fetchQuoteResinBlends.pending, (s) => {
      s.quoteResinBlends.status = 'loading'
      s.quoteResinBlends.error = null
    })
    b.addCase(fetchQuoteResinBlends.fulfilled, (s, a) => {
      s.quoteResinBlends.status = 'succeeded'
      s.quoteResinBlends.items = a.payload
      s.quoteResinBlends.error = null
    })
    b.addCase(fetchQuoteResinBlends.rejected, (s, a) => {
      s.quoteResinBlends.status = 'failed'
      s.quoteResinBlends.error = a.error.message || 'Failed to load resin blends'
      s.quoteResinBlends.items = []
    })
  },
})

export const quotesReducer = slice.reducer
export const { clearUpsertErrors, clearDetail } = slice.actions

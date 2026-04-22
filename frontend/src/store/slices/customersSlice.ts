import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'
import { parseFastApiValidationDetail } from '../../api/validation'

export type CustomerSummary = {
  id: string
  name: string
  status: string
  brand_id?: string | null
  brand_code?: string | null
  brand_name?: string | null
  priority_rank?: number | null
  orders_count?: number
  quotes_count?: number
}

export type CustomerDetail = {
  id: string
  name: string
  status: string
  brand_id?: string | null
  brand_code?: string | null
  brand_name?: string | null
  priority_rank?: number | null
  abn?: string | null
  contact_phone?: string | null
  payment_terms?: Record<string, unknown> | null
  payment_terms_summary?: string | null
  notes?: string | null
  myob_customer_uid?: string | null
  myob_display_id?: string | null
  myob_last_modified?: string | null
  myob_synced_at?: string | null
  myob_notes?: string | null
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
  products_count?: number
  orders_count?: number
  quotes_count?: number
}

export type CustomerUpsertPayload = {
  name: string
  brand_id: string | null
  priority_rank: number | null
  abn: string | null
  contact_phone: string | null
  status: string
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
  payment_terms: Record<string, unknown> | null
  notes: string | null
}

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

type UpsertError = {
  message: string
  fieldErrors: Record<string, string>
  messages: string[]
}

type CustomersState = {
  list: {
    status: Status
    error: string | null
    items: CustomerSummary[]
    lastQuery: string
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
        customer: CustomerDetail | null
      }
    >
  }
  upsert: {
    status: Status
    error: string | null
    fieldErrors: Record<string, string>
    messages: string[]
  }
}

const initialState: CustomersState = {
  list: { status: 'idle', error: null, items: [], lastQuery: '', total: 0, page: 1, pageSize: 100 },
  detail: { byId: {} },
  upsert: { status: 'idle', error: null, fieldErrors: {}, messages: [] },
}

function toUpsertError(e: unknown): UpsertError | null {
  if (!(e instanceof ApiError)) return null
  let { fieldErrors, messages } = parseFastApiValidationDetail(e.body?.detail)
  if (e.status === 409 && Object.keys(fieldErrors).length === 0 && typeof e.body?.detail === 'string') {
    messages = [e.body.detail]
  }
  const hasFieldErrors = Object.keys(fieldErrors).length > 0
  return {
    message: hasFieldErrors ? 'Please fix the highlighted fields and try again.' : e.message || 'Request failed',
    fieldErrors,
    messages,
  }
}

/** Default page size for customer pickers (dropdowns); list view uses 25 via CustomersPage. */
export const CUSTOMER_PICKER_PAGE_SIZE = 500

export const fetchCustomers = createAsyncThunk(
  'customers/list',
  async (payload: { q?: string; page?: number; page_size?: number } | undefined) => {
    const q = payload?.q?.trim() || ''
    const page = payload?.page ?? 1
    const page_size = payload?.page_size ?? 100
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    qs.set('page', String(page))
    qs.set('page_size', String(page_size))
    const res = await apiFetch<{
      items: CustomerSummary[]
      total: number
      page: number
      page_size: number
    }>(`/api/customers?${qs.toString()}`)
    return {
      q,
      items: res.items,
      total: res.total,
      page: res.page,
      page_size: res.page_size,
    }
  },
)

export const fetchCustomer = createAsyncThunk('customers/detail', async (customerId: string) => {
  const res = await apiFetch<{ customer: CustomerDetail }>(`/api/customers/${customerId}`)
  return { customerId, customer: res.customer }
})

export const createCustomer = createAsyncThunk(
  'customers/create',
  async (
    payload: { data: CustomerUpsertPayload },
    { rejectWithValue },
  ) => {
    try {
      const res = await apiFetch<{ ok: boolean; customer: { id: string } }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(payload.data),
      })
      return res.customer
    } catch (e) {
      const err = toUpsertError(e)
      if (err) return rejectWithValue(err)
      throw e
    }
  },
)

export const updateCustomer = createAsyncThunk(
  'customers/update',
  async (
    payload: { customerId: string; data: CustomerUpsertPayload },
    { rejectWithValue },
  ) => {
    try {
      await apiFetch(`/api/customers/${payload.customerId}`, {
        method: 'PUT',
        body: JSON.stringify(payload.data),
      })
      return { customerId: payload.customerId }
    } catch (e) {
      const err = toUpsertError(e)
      if (err) return rejectWithValue(err)
      throw e
    }
  },
)

const slice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    clearUpsertErrors(s) {
      s.upsert.error = null
      s.upsert.fieldErrors = {}
      s.upsert.messages = []
    },
    clearUpsertFieldError(s, a: { payload: string }) {
      const key = a.payload
      if (s.upsert.fieldErrors[key]) {
        const next = { ...s.upsert.fieldErrors }
        delete next[key]
        s.upsert.fieldErrors = next
      }
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchCustomers.pending, (s, a) => {
      s.list.status = 'loading'
      s.list.error = null
      s.list.lastQuery = a.meta.arg?.q?.trim() || ''
    })
    b.addCase(fetchCustomers.fulfilled, (s, a) => {
      s.list.status = 'succeeded'
      s.list.items = a.payload.items
      s.list.lastQuery = a.payload.q
      s.list.total = a.payload.total
      s.list.page = a.payload.page
      s.list.pageSize = a.payload.page_size
    })
    b.addCase(fetchCustomers.rejected, (s, a) => {
      s.list.status = 'failed'
      s.list.error = a.error.message || 'Failed to load customers'
    })

    b.addCase(fetchCustomer.pending, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, customer: null }
      s.detail.byId[id].status = 'loading'
      s.detail.byId[id].error = null
    })
    b.addCase(fetchCustomer.fulfilled, (s, a) => {
      const { customerId, customer } = a.payload
      s.detail.byId[customerId] = { status: 'succeeded', error: null, customer }
    })
    b.addCase(fetchCustomer.rejected, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, customer: null }
      s.detail.byId[id].status = 'failed'
      s.detail.byId[id].error = a.error.message || 'Failed to load customer'
    })

    b.addCase(createCustomer.pending, (s) => {
      s.upsert.status = 'loading'
      s.upsert.error = null
      s.upsert.fieldErrors = {}
      s.upsert.messages = []
    })
    b.addCase(createCustomer.fulfilled, (s) => {
      s.upsert.status = 'succeeded'
      s.upsert.error = null
      s.upsert.fieldErrors = {}
      s.upsert.messages = []
    })
    b.addCase(createCustomer.rejected, (s, a) => {
      s.upsert.status = 'failed'
      const v = a.payload as UpsertError | undefined
      s.upsert.error = v?.message || a.error.message || 'Failed to create customer'
      s.upsert.fieldErrors = v?.fieldErrors || {}
      s.upsert.messages = v?.messages || []
    })

    b.addCase(updateCustomer.pending, (s) => {
      s.upsert.status = 'loading'
      s.upsert.error = null
      s.upsert.fieldErrors = {}
      s.upsert.messages = []
    })
    b.addCase(updateCustomer.fulfilled, (s) => {
      s.upsert.status = 'succeeded'
      s.upsert.error = null
      s.upsert.fieldErrors = {}
      s.upsert.messages = []
    })
    b.addCase(updateCustomer.rejected, (s, a) => {
      s.upsert.status = 'failed'
      const v = a.payload as UpsertError | undefined
      s.upsert.error = v?.message || a.error.message || 'Failed to update customer'
      s.upsert.fieldErrors = v?.fieldErrors || {}
      s.upsert.messages = v?.messages || []
    })
  },
})

export const customersReducer = slice.reducer
export const { clearUpsertErrors, clearUpsertFieldError } = slice.actions


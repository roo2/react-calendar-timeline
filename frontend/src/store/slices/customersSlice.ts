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
  contact_first_name?: string | null
  priority_rank?: number | null
  orders_count?: number
  quotes_count?: number
}

export type CustomersListQuery = {
  search?: string
  q?: string
  brand_code?: string
  status?: string
  contact?: string
  email?: string
  phone?: string
  abn?: string
  myob_display_id?: string
  sort_by?: string
  sort_dir?: string
  page?: number
  page_size?: number
}

export type CustomerPricingTierBrief = {
  id: string
  name: string
  discount_percent: number
}

export type XeroSaveSyncResult = {
  status: 'created' | 'synced' | 'skipped' | 'failed'
  reason?: string
  error?: string
  contact_id?: string
  customer_id?: string
  customer_name?: string
}

export type CustomerDetail = {
  id: string
  name: string
  status: string
  pricing_tier_id?: string | null
  pricing_tier?: CustomerPricingTierBrief | null
  brand_id?: string | null
  brand_code?: string | null
  brand_name?: string | null
  priority_rank?: number | null
  abn?: string | null
  contact_phone?: string | null
  contact_first_name?: string | null
  contact_last_name?: string | null
  email_address?: string | null
  phones?: Array<{
    phone_type?: string
    phone_country_code?: string | null
    phone_area_code?: string | null
    phone_number?: string
    display?: string
  }>
  payment_terms?: Record<string, unknown> | null
  payment_terms_summary?: string | null
  notes?: string | null
  myob_customer_uid?: string | null
  myob_display_id?: string | null
  myob_last_modified?: string | null
  myob_synced_at?: string | null
  myob_notes?: string | null
  xero_contact_id?: string | null
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
  products_count?: number
  orders_count?: number
  quotes_count?: number
  can_delete?: boolean
}

export type CustomerUpsertPayload = {
  name: string
  pricing_tier_id: string | null
  brand_id: string | null
  priority_rank: number | null
  abn: string | null
  contact_phone?: string | null
  phones: any[]
  status: string
  contacts: any[]
  delivery_addresses: any[]
  delivery_preferences: any
  payment_terms: Record<string, unknown> | null
  notes: string | null
  xero_contact_id: string | null
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
  async (payload: CustomersListQuery | undefined) => {
    const page = payload?.page ?? 1
    const page_size = payload?.page_size ?? 100
    const qs = new URLSearchParams()
    const search = payload?.search?.trim() || payload?.q?.trim() || ''
    if (search) qs.set('search', search)
    if (payload?.brand_code?.trim()) qs.set('brand_code', payload.brand_code.trim())
    if (payload?.status?.trim()) qs.set('status', payload.status.trim())
    if (payload?.contact?.trim()) qs.set('contact', payload.contact.trim())
    if (payload?.email?.trim()) qs.set('email', payload.email.trim())
    if (payload?.phone?.trim()) qs.set('phone', payload.phone.trim())
    if (payload?.abn?.trim()) qs.set('abn', payload.abn.trim())
    if (payload?.myob_display_id?.trim()) qs.set('myob_display_id', payload.myob_display_id.trim())
    if (payload?.sort_by?.trim()) qs.set('sort_by', payload.sort_by.trim())
    if (payload?.sort_dir?.trim()) qs.set('sort_dir', payload.sort_dir.trim())
    qs.set('page', String(page))
    qs.set('page_size', String(page_size))
    const res = await apiFetch<{
      items: CustomerSummary[]
      total: number
      page: number
      page_size: number
    }>(`/api/customers?${qs.toString()}`)
    return {
      q: search,
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
      const res = await apiFetch<{
        ok: boolean
        customer: { id: string }
        xero_sync?: XeroSaveSyncResult
      }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(payload.data),
      })
      return { ...res.customer, xero_sync: res.xero_sync }
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
      const res = await apiFetch<{
        ok: boolean
        customer: { id: string }
        xero_sync?: XeroSaveSyncResult
      }>(`/api/customers/${payload.customerId}`, {
        method: 'PUT',
        body: JSON.stringify(payload.data),
      })
      return { customerId: payload.customerId, xero_sync: res.xero_sync }
    } catch (e) {
      const err = toUpsertError(e)
      if (err) return rejectWithValue(err)
      throw e
    }
  },
)

export const deleteCustomer = createAsyncThunk(
  'customers/delete',
  async (customerId: string, { rejectWithValue }) => {
    try {
      await apiFetch<void>(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' })
      return { customerId }
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
      s.list.lastQuery = a.meta.arg?.search?.trim() || a.meta.arg?.q?.trim() || ''
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

    b.addCase(deleteCustomer.fulfilled, (s, a) => {
      const cid = a.payload.customerId
      delete s.detail.byId[cid]
      s.list.items = s.list.items.filter((c) => c.id !== cid)
      if (s.list.total > 0) s.list.total -= 1
    })
  },
})

export const customersReducer = slice.reducer
export const { clearUpsertErrors, clearUpsertFieldError } = slice.actions


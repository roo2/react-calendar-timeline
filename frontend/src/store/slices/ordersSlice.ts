import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

/** Row from GET /api/orders (optionally filtered by customer_id). */
export type OrderRow = {
  id: string
  code: string
  customer_purchase_order_number?: string | null
  status: string
  customer_name?: string | null
  product_code?: string | null
  version_number?: number | null
  item_count?: number | null
  created_at?: string | null
  order_date?: string | null
  import_source?: string | null
  myob_order_uid?: string | null
  myob_synced_at?: string | null
  myob_all_job_sheets_entered?: boolean | null
  order_total?: number | null
  manufactured_first_product_code?: string | null
  manufactured_other_line_count?: number
  /** MYOB resell line_kind counts (outsourced vs supply catalog). */
  resell_outsourced_line_count?: number
  resell_supply_line_count?: number
  /** Staff QA after import: incomplete | complete */
  import_review_status?: 'incomplete' | 'complete' | null
}

export type OrdersBootstrapCustomer = { id: string; name: string }

export type OrdersBootstrapResellProduct = {
  id: string
  description: string
  unit_price: number
  catalog_kind?: string | null
  /** Outsourced MYOB rows: customer this catalog entry belongs to; supplies are typically null. */
  customer_id?: string | null
}

export type OrdersBootstrapQuery = {
  /** When set, outsourced manufacturing resell products are limited to this customer (supply rows unchanged). */
  customer_id?: string | null
}

export type OrdersListQuery = {
  customer_id?: string
  /** Filter orders whose customer belongs to this brand (UUID). */
  brand_id?: string
  /** Filter by brand code (e.g. CROWN_PACK); ignored if brand_id is set. */
  brand_code?: string
  invoice_number?: string
  customer_po?: string
  customer?: string
  product?: string
  order_total_min?: number
  order_total_max?: number
  status?: string
  order_date_from?: string
  order_date_to?: string
  line_item_search?: string
  search?: string
  page?: number
  page_size?: number
}

function ordersListQueryToSearchParams(q: OrdersListQuery): URLSearchParams {
  const qs = new URLSearchParams()
  const set = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === null) return
    const s = typeof v === 'number' ? String(v) : String(v).trim()
    if (s !== '') qs.set(k, s)
  }
  set('customer_id', q.customer_id)
  set('brand_id', q.brand_id)
  set('brand_code', q.brand_code)
  set('invoice_number', q.invoice_number)
  set('customer_po', q.customer_po)
  set('customer', q.customer)
  set('product', q.product)
  set('order_total_min', q.order_total_min)
  set('order_total_max', q.order_total_max)
  set('status', q.status)
  set('order_date_from', q.order_date_from)
  set('order_date_to', q.order_date_to)
  set('line_item_search', q.line_item_search)
  set('search', q.search)
  set('page', q.page)
  set('page_size', q.page_size)
  return qs
}

type OrdersState = {
  list: {
    status: Status
    error: string | null
    items: OrderRow[]
    total: number
    page: number
    pageSize: number
    /** Set when the last successful list fetch was scoped by `customer_id` (customer detail page). */
    lastCustomerId: string | null
  }
  detail: {
    byId: Record<
      string,
      {
        status: Status
        error: string | null
        order: any | null
      }
    >
  }
  bootstrap: {
    status: Status
    error: string | null
    customers: OrdersBootstrapCustomer[] | null
    resell_products: OrdersBootstrapResellProduct[] | null
  }
}

const initialState: OrdersState = {
  list: { status: 'idle', error: null, items: [], total: 0, page: 1, pageSize: 100, lastCustomerId: null },
  detail: { byId: {} },
  bootstrap: { status: 'idle', error: null, customers: null, resell_products: null },
}

export const fetchOrders = createAsyncThunk(
  'orders/list',
  async (query: OrdersListQuery | undefined) => {
    const customerId = query?.customer_id?.trim() || null
    const qs = query ? ordersListQueryToSearchParams(query) : new URLSearchParams()
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const res = await apiFetch<{ items: OrderRow[]; total?: number; page?: number; page_size?: number } | OrderRow[]>(
      `/api/orders${suffix}`,
    )
    if (Array.isArray(res)) {
      return {
        items: res,
        total: res.length,
        page: Number(query?.page) || 1,
        pageSize: Number(query?.page_size) || 100,
        customer_id: customerId,
      }
    }
    return {
      items: Array.isArray(res.items) ? res.items : [],
      total: Number(res.total) || 0,
      page: Number(res.page) || Number(query?.page) || 1,
      pageSize: Number(res.page_size) || Number(query?.page_size) || 100,
      customer_id: customerId,
    }
  },
)

export const fetchOrder = createAsyncThunk('orders/detail', async (orderId: string) => {
  const order = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
  return { orderId, order }
})

export const fetchOrdersBootstrap = createAsyncThunk(
  'orders/bootstrap',
  async (query: OrdersBootstrapQuery | undefined) => {
    const cid = String(query?.customer_id || '').trim()
    const suffix = cid ? `?customer_id=${encodeURIComponent(cid)}` : ''
    const res = await apiFetch<{
      customers: OrdersBootstrapCustomer[]
      resell_products?: OrdersBootstrapResellProduct[]
    }>(`/api/orders/bootstrap${suffix}`)
    return {
      customers: Array.isArray(res.customers) ? res.customers : [],
      resell_products: Array.isArray(res.resell_products) ? res.resell_products : [],
    }
  },
)

export const publishOrder = createAsyncThunk('orders/publish', async (orderId: string) => {
  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/publish`, { method: 'POST' })
  const order = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
  return { orderId, order }
})

export type CreateOrderBody = {
  customer_id: string
  /** When converting from a saved quote. */
  quote_id?: string
  status: string
  order_date?: string | null
  invoice_number?: string | null
  customer_purchase_order_number?: string | null
  resell_items?: Array<{
    resell_product_id: string
    quantity_value: number
    quantity_unit?: string
    due_date?: string | null
    rate?: number | null
    total_price?: number | null
  }>
  items: Array<{
    product_id: string
    quantity_value: number
    quantity_unit: string
    due_date?: string | null
    rate?: number | null
    total_price?: number | null
    /** Job sheet qty (e.g. from quote convert): total_rolls needs weight_per_roll_kg */
    qty_type?: string
    num_product_units?: number
    weight_per_roll_kg?: number
    num_rolls?: number
  }>
}

export const createOrder = createAsyncThunk('orders/create', async (body: CreateOrderBody) => {
  const res = await apiFetch<{ ok: boolean; order_id: string }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res
})

export const patchOrder = createAsyncThunk(
  'orders/patch',
  async (payload: { orderId: string; body: Record<string, unknown> }) => {
    const { orderId, body } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return { orderId }
  },
)

export const addOrderItem = createAsyncThunk(
  'orders/addItem',
  async (payload: { orderId: string; body: Record<string, unknown> }) => {
    const { orderId, body } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { orderId }
  },
)

export const deleteOrderItem = createAsyncThunk(
  'orders/deleteItem',
  async (payload: { orderId: string; orderItemId: string }) => {
    const { orderId, orderItemId } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(orderItemId)}`, {
      method: 'DELETE',
    })
    return { orderId }
  },
)

export const addOrderResellItem = createAsyncThunk(
  'orders/addResellItem',
  async (payload: { orderId: string; body: Record<string, unknown> }) => {
    const { orderId, body } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/resell-items`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { orderId }
  },
)

export const patchOrderResellItem = createAsyncThunk(
  'orders/patchResellItem',
  async (payload: { orderId: string; lineId: string; body: Record<string, unknown> }) => {
    const { orderId, lineId, body } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/resell-items/${encodeURIComponent(lineId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return { orderId }
  },
)

export const deleteOrderResellItem = createAsyncThunk(
  'orders/deleteResellItem',
  async (payload: { orderId: string; lineId: string }) => {
    const { orderId, lineId } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/resell-items/${encodeURIComponent(lineId)}`, {
      method: 'DELETE',
    })
    return { orderId }
  },
)

/** MYOB import fix-up: resell line → ``myob_import`` + import-draft job sheet. */
export const convertResellLineToMyobJobSheet = createAsyncThunk(
  'orders/convertResellToMyobJobSheet',
  async (payload: { orderId: string; lineId: string }) => {
    const { orderId, lineId } = payload
    await apiFetch(
      `/api/orders/${encodeURIComponent(orderId)}/resell-items/${encodeURIComponent(lineId)}/convert-to-myob-job-sheet`,
      { method: 'POST' },
    )
    return { orderId }
  },
)

export const linkMyobImportLine = createAsyncThunk(
  'orders/linkMyobLine',
  async (payload: { orderId: string; lineId: string; job_sheet_id: string }) => {
    const { orderId, lineId, job_sheet_id } = payload
    await apiFetch(
      `/api/orders/${encodeURIComponent(orderId)}/myob-import-lines/${encodeURIComponent(lineId)}/link`,
      {
        method: 'POST',
        body: JSON.stringify({ job_sheet_id }),
      },
    )
    return { orderId }
  },
)

export const addOrderJob = createAsyncThunk(
  'orders/addJob',
  async (payload: { orderId: string; body: { planned_qty: string; allocated_order_units: string | null } }) => {
    const { orderId, body } = payload
    await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/jobs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { orderId }
  },
)

/** Publish without refetching detail (caller navigates away or refetches separately). */
export const publishOrderBare = createAsyncThunk('orders/publishBare', async (orderId: string) => {
  await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/publish`, { method: 'POST' })
  return { orderId }
})

function mergeOrderDetail(
  s: OrdersState,
  orderId: string,
  status: Status,
  error: string | null,
  order: any | null,
) {
  s.detail.byId[orderId] = { status, error, order }
}

const slice = createSlice({
  name: 'orders',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchOrders.pending, (s) => {
      s.list.status = 'loading'
      s.list.error = null
    })
    b.addCase(fetchOrders.fulfilled, (s, a) => {
      s.list.status = 'succeeded'
      s.list.items = a.payload.items
      s.list.total = a.payload.total
      s.list.page = a.payload.page
      s.list.pageSize = a.payload.pageSize
      s.list.lastCustomerId = a.payload.customer_id
      s.list.error = null
    })
    b.addCase(fetchOrders.rejected, (s, a) => {
      s.list.status = 'failed'
      s.list.error = a.error.message || 'Failed to load orders'
      const arg = a.meta.arg as OrdersListQuery | undefined
      s.list.lastCustomerId = arg?.customer_id?.trim() ?? null
    })

    b.addCase(fetchOrder.pending, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, order: null }
      s.detail.byId[id].status = 'loading'
      s.detail.byId[id].error = null
    })
    b.addCase(fetchOrder.fulfilled, (s, a) => {
      const { orderId, order } = a.payload
      mergeOrderDetail(s, orderId, 'succeeded', null, order)
    })
    b.addCase(fetchOrder.rejected, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, order: null }
      s.detail.byId[id].status = 'failed'
      s.detail.byId[id].error = a.error.message || 'Failed to load order'
      s.detail.byId[id].order = null
    })

    b.addCase(fetchOrdersBootstrap.pending, (s) => {
      s.bootstrap.status = 'loading'
      s.bootstrap.error = null
    })
    b.addCase(fetchOrdersBootstrap.fulfilled, (s, a) => {
      s.bootstrap.status = 'succeeded'
      s.bootstrap.customers = a.payload.customers
      s.bootstrap.resell_products = a.payload.resell_products
      s.bootstrap.error = null
    })
    b.addCase(fetchOrdersBootstrap.rejected, (s, a) => {
      s.bootstrap.status = 'failed'
      s.bootstrap.error = a.error.message || 'Failed to load order form data'
      s.bootstrap.customers = null
      s.bootstrap.resell_products = null
    })

    b.addCase(publishOrder.fulfilled, (s, a) => {
      const { orderId, order } = a.payload
      mergeOrderDetail(s, orderId, 'succeeded', null, order)
    })

    b.addCase(patchOrder.fulfilled, (s, a) => {
      const id = a.meta.arg.orderId
      const row = s.list.items.find((x) => x.id === id)
      if (!row) return
      const body = a.meta.arg.body
      if (Object.prototype.hasOwnProperty.call(body, 'import_review_status')) {
        const v = body.import_review_status as string | null | undefined
        row.import_review_status =
          v === 'complete' || v === 'incomplete' ? (v as 'complete' | 'incomplete') : null
      }
    })
  },
})

export const ordersReducer = slice.reducer

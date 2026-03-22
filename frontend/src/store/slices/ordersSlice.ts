import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

/** Row from GET /api/orders (optionally filtered by customer_id). */
export type OrderRow = {
  id: string
  code: string
  status: string
  customer_name?: string | null
  product_code?: string | null
  version_number?: number | null
  item_count?: number | null
  created_at?: string | null
  order_date?: string | null
}

export type OrdersBootstrapCustomer = { id: string; name: string; code?: string | null }

type OrdersState = {
  list: {
    status: Status
    error: string | null
    items: OrderRow[]
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
  }
}

const initialState: OrdersState = {
  list: { status: 'idle', error: null, items: [], lastCustomerId: null },
  detail: { byId: {} },
  bootstrap: { status: 'idle', error: null, customers: null },
}

export const fetchOrders = createAsyncThunk(
  'orders/list',
  async (params: { customer_id?: string } | undefined) => {
    const cid = params?.customer_id?.trim()
    const url = cid ? `/api/orders?customer_id=${encodeURIComponent(cid)}` : '/api/orders'
    const rows = await apiFetch<OrderRow[]>(url)
    return { customer_id: cid ?? null, items: Array.isArray(rows) ? rows : [] }
  },
)

export const fetchOrder = createAsyncThunk('orders/detail', async (orderId: string) => {
  const order = await apiFetch<any>(`/api/orders/${encodeURIComponent(orderId)}`)
  return { orderId, order }
})

export const fetchOrdersBootstrap = createAsyncThunk('orders/bootstrap', async () => {
  const res = await apiFetch<{ customers: OrdersBootstrapCustomer[] }>('/api/orders/bootstrap')
  return { customers: Array.isArray(res.customers) ? res.customers : [] }
})

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
  items: Array<{
    product_id: string
    quantity_value: number
    quantity_unit: string
    due_date?: string | null
    rate?: number | null
    total_price?: number | null
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
      s.list.lastCustomerId = a.payload.customer_id
      s.list.error = null
    })
    b.addCase(fetchOrders.rejected, (s, a) => {
      s.list.status = 'failed'
      s.list.error = a.error.message || 'Failed to load orders'
      s.list.lastCustomerId = a.meta.arg?.customer_id?.trim() ?? null
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
      s.bootstrap.error = null
    })
    b.addCase(fetchOrdersBootstrap.rejected, (s, a) => {
      s.bootstrap.status = 'failed'
      s.bootstrap.error = a.error.message || 'Failed to load order form data'
      s.bootstrap.customers = null
    })

    b.addCase(publishOrder.fulfilled, (s, a) => {
      const { orderId, order } = a.payload
      mergeOrderDetail(s, orderId, 'succeeded', null, order)
    })
  },
})

export const ordersReducer = slice.reducer

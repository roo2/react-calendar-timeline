import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'
import { parseFastApiValidationDetail } from '../../api/validation'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type CreateProductPayload = {
  customer_id: string
  code: string
  spec: any
}

export type UpsertError = {
  message: string
  fieldErrors: Record<string, string>
  messages: string[]
}

function toUpsertError(e: unknown): UpsertError | null {
  if (!(e instanceof ApiError)) return null
  const { fieldErrors, messages } = parseFastApiValidationDetail(e.body?.detail)
  const hasFieldErrors = Object.keys(fieldErrors).length > 0
  const feLines = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`)
  let message: string
  if (hasFieldErrors && messages.length > 0) {
    message = messages.join(' · ')
  } else if (hasFieldErrors && feLines.length > 0) {
    message = feLines.join(' · ')
  } else if (hasFieldErrors) {
    message = 'Please fix the highlighted fields and try again.'
  } else {
    message = e.message || 'Request failed'
  }
  return {
    message,
    fieldErrors,
    messages,
  }
}

/** Summary row from GET /api/products */
export type ProductListItem = {
  id: string
  code: string
  description?: string | null
  customer_name?: string | null
  active_version_id?: string | null
  active_version_number?: number | null
  version_count?: number | null
  product_type?: string | null
  /** From active version spec identity when available. */
  finish_mode?: 'Rolls' | 'Cartons' | string | null
  customer_id?: string
  pack_mode?: string | null
}

export function productVersionCacheKey(productId: string, versionId: string) {
  return `${productId}:${versionId}`
}

type ProductsState = {
  create: {
    status: Status
    error: string | null
    fieldErrors: Record<string, string>
    messages: string[]
  }
  newVersion: {
    status: Status
    error: string | null
    fieldErrors: Record<string, string>
    messages: string[]
  }
  list: {
    status: Status
    error: string | null
    items: ProductListItem[]
    lastQuery: string
    lastCustomerId: string | null
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
  versionDetail: {
    byKey: Record<
      string,
      {
        status: Status
        error: string | null
        data: any | null
      }
    >
  }
}

const initialState: ProductsState = {
  create: { status: 'idle', error: null, fieldErrors: {}, messages: [] },
  newVersion: { status: 'idle', error: null, fieldErrors: {}, messages: [] },
  list: { status: 'idle', error: null, items: [], lastQuery: '', lastCustomerId: null },
  detail: { byId: {} },
  versionDetail: { byKey: {} },
}

export const createProduct = createAsyncThunk(
  'products/create',
  async (payload: { data: CreateProductPayload }, { rejectWithValue }) => {
    try {
      const res = await apiFetch<{ ok: boolean; product: { id: string }; version?: { id: string } }>('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload.data),
      })
      return res
    } catch (e) {
      const err = toUpsertError(e)
      if (err) return rejectWithValue(err)
      throw e
    }
  },
)

export const createProductVersion = createAsyncThunk(
  'products/newVersion',
  async (payload: { productId: string; spec: any }, { rejectWithValue }) => {
    try {
      const res = await apiFetch<{ ok: boolean; version: { id: string } }>(`/api/products/${payload.productId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ spec: payload.spec }),
      })
      return { productId: payload.productId, versionId: res.version?.id }
    } catch (e) {
      const err = toUpsertError(e)
      if (err) return rejectWithValue(err)
      throw e
    }
  },
)

export const fetchProducts = createAsyncThunk(
  'products/list',
  async (params: { q?: string; customer_id?: string } | undefined) => {
    const q = (params?.q ?? '').trim()
    const cid = params?.customer_id?.trim()
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (cid) sp.set('customer_id', cid)
    const qs = sp.toString()
    const res = await apiFetch<{ items: ProductListItem[] }>(`/api/products${qs ? `?${qs}` : ''}`)
    return { q, customer_id: cid ?? null, items: res.items || [] }
  },
)

export const fetchProduct = createAsyncThunk('products/detail', async (productId: string) => {
  const data = await apiFetch<any>(`/api/products/${encodeURIComponent(productId)}`)
  return { productId, data }
})

export const fetchProductVersion = createAsyncThunk(
  'products/versionDetail',
  async (payload: { productId: string; versionId: string }) => {
    const data = await apiFetch<any>(
      `/api/products/${encodeURIComponent(payload.productId)}/versions/${encodeURIComponent(payload.versionId)}`,
    )
    return {
      key: productVersionCacheKey(payload.productId, payload.versionId),
      data,
    }
  },
)

/** Debounced uniqueness check per customer; use with request-id in UI to ignore stale responses. */
export const checkProductCodeExists = createAsyncThunk(
  'products/codeExists',
  async (payload: { code: string; customer_id: string }, { signal }) => {
    const v = (payload.code || '').trim()
    const cid = (payload.customer_id || '').trim()
    if (!v || !cid) return { exists: false }
    const sp = new URLSearchParams()
    sp.set('code', v)
    sp.set('customer_id', cid)
    const res = await apiFetch<{ exists: boolean }>(`/api/products/code-exists?${sp.toString()}`, { signal })
    return { exists: !!res?.exists }
  },
)

const slice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    clearCreateErrors(s) {
      s.create.error = null
      s.create.fieldErrors = {}
      s.create.messages = []
    },
    clearCreateFieldError(s, a: { payload: string }) {
      const key = a.payload
      if (s.create.fieldErrors[key]) {
        const next = { ...s.create.fieldErrors }
        delete next[key]
        s.create.fieldErrors = next
      }
    },
    clearNewVersionErrors(s) {
      s.newVersion.error = null
      s.newVersion.fieldErrors = {}
      s.newVersion.messages = []
    },
    clearNewVersionFieldError(s, a: { payload: string }) {
      const key = a.payload
      if (s.newVersion.fieldErrors[key]) {
        const next = { ...s.newVersion.fieldErrors }
        delete next[key]
        s.newVersion.fieldErrors = next
      }
    },
    clearProductDetail(s, a: { payload: string }) {
      delete s.detail.byId[a.payload]
    },
    clearProductVersionDetail(s, a: { payload: string }) {
      delete s.versionDetail.byKey[a.payload]
    },
  },
  extraReducers: (b) => {
    b.addCase(createProduct.pending, (s) => {
      s.create.status = 'loading'
      s.create.error = null
      s.create.fieldErrors = {}
      s.create.messages = []
    })
    b.addCase(createProduct.fulfilled, (s) => {
      s.create.status = 'succeeded'
      s.create.error = null
      s.create.fieldErrors = {}
      s.create.messages = []
    })
    b.addCase(createProduct.rejected, (s, a) => {
      s.create.status = 'failed'
      const v = a.payload as UpsertError | undefined
      s.create.error = v?.message || a.error.message || 'Failed to create product'
      s.create.fieldErrors = v?.fieldErrors || {}
      s.create.messages = v?.messages || []
    })

    b.addCase(createProductVersion.pending, (s) => {
      s.newVersion.status = 'loading'
      s.newVersion.error = null
      s.newVersion.fieldErrors = {}
      s.newVersion.messages = []
    })
    b.addCase(createProductVersion.fulfilled, (s, a) => {
      s.newVersion.status = 'succeeded'
      s.newVersion.error = null
      s.newVersion.fieldErrors = {}
      s.newVersion.messages = []
      const pid = a.meta.arg.productId
      delete s.detail.byId[pid]
    })
    b.addCase(createProductVersion.rejected, (s, a) => {
      s.newVersion.status = 'failed'
      const v = a.payload as UpsertError | undefined
      s.newVersion.error = v?.message || a.error.message || 'Failed to create version'
      s.newVersion.fieldErrors = v?.fieldErrors || {}
      s.newVersion.messages = v?.messages || []
    })

    b.addCase(fetchProducts.pending, (s) => {
      s.list.status = 'loading'
      s.list.error = null
    })
    b.addCase(fetchProducts.fulfilled, (s, a) => {
      s.list.status = 'succeeded'
      s.list.items = a.payload.items
      s.list.lastQuery = a.payload.q
      s.list.lastCustomerId = a.payload.customer_id
      s.list.error = null
    })
    b.addCase(fetchProducts.rejected, (s, a) => {
      s.list.status = 'failed'
      s.list.error = a.error.message || 'Failed to load products'
      const arg = a.meta.arg
      s.list.lastQuery = (arg?.q ?? '').trim()
      s.list.lastCustomerId = arg?.customer_id?.trim() ?? null
    })

    b.addCase(fetchProduct.pending, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
      s.detail.byId[id].status = 'loading'
      s.detail.byId[id].error = null
    })
    b.addCase(fetchProduct.fulfilled, (s, a) => {
      const { productId, data } = a.payload
      s.detail.byId[productId] = { status: 'succeeded', error: null, data }
    })
    b.addCase(fetchProduct.rejected, (s, a) => {
      const id = a.meta.arg
      s.detail.byId[id] = s.detail.byId[id] || { status: 'idle', error: null, data: null }
      s.detail.byId[id].status = 'failed'
      s.detail.byId[id].error = a.error.message || 'Failed to load product'
      s.detail.byId[id].data = null
    })

    b.addCase(fetchProductVersion.pending, (s, a) => {
      const key = productVersionCacheKey(a.meta.arg.productId, a.meta.arg.versionId)
      s.versionDetail.byKey[key] = s.versionDetail.byKey[key] || { status: 'idle', error: null, data: null }
      s.versionDetail.byKey[key].status = 'loading'
      s.versionDetail.byKey[key].error = null
    })
    b.addCase(fetchProductVersion.fulfilled, (s, a) => {
      const { key, data } = a.payload
      s.versionDetail.byKey[key] = { status: 'succeeded', error: null, data }
    })
    b.addCase(fetchProductVersion.rejected, (s, a) => {
      const key = productVersionCacheKey(a.meta.arg.productId, a.meta.arg.versionId)
      s.versionDetail.byKey[key] = s.versionDetail.byKey[key] || { status: 'idle', error: null, data: null }
      s.versionDetail.byKey[key].status = 'failed'
      s.versionDetail.byKey[key].error = a.error.message || 'Failed to load product version'
      s.versionDetail.byKey[key].data = null
    })
  },
})

export const productsReducer = slice.reducer
export const {
  clearCreateErrors,
  clearCreateFieldError,
  clearNewVersionErrors,
  clearNewVersionFieldError,
  clearProductDetail,
  clearProductVersionDetail,
} = slice.actions

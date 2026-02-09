import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, apiFetch } from '../../api/client'
import { parseFastApiValidationDetail } from '../../api/validation'

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type CreateProductPayload = {
  customer_id: string
  code: string
  description?: string | null
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
  return {
    message: hasFieldErrors ? 'Please fix the highlighted fields and try again.' : e.message || 'Request failed',
    fieldErrors,
    messages,
  }
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
}

const initialState: ProductsState = {
  create: { status: 'idle', error: null, fieldErrors: {}, messages: [] },
  newVersion: { status: 'idle', error: null, fieldErrors: {}, messages: [] },
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
    b.addCase(createProductVersion.fulfilled, (s) => {
      s.newVersion.status = 'succeeded'
      s.newVersion.error = null
      s.newVersion.fieldErrors = {}
      s.newVersion.messages = []
    })
    b.addCase(createProductVersion.rejected, (s, a) => {
      s.newVersion.status = 'failed'
      const v = a.payload as UpsertError | undefined
      s.newVersion.error = v?.message || a.error.message || 'Failed to create version'
      s.newVersion.fieldErrors = v?.fieldErrors || {}
      s.newVersion.messages = v?.messages || []
    })
  },
})

export const productsReducer = slice.reducer
export const { clearCreateErrors, clearCreateFieldError, clearNewVersionErrors, clearNewVersionFieldError } = slice.actions


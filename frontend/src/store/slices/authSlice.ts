import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

export type Identity = {
  user: string | null
  roles: string[]
  csrf?: string | null
}

type AuthState = {
  identity: Identity | null
  csrfToken: string | null
  status: 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error'
  error: string | null
}

const initialState: AuthState = {
  identity: null,
  csrfToken: null,
  status: 'idle',
  error: null,
}

export const login = createAsyncThunk(
  'auth/login',
  async (payload: { username: string; password: string }) => {
    return await apiFetch<{ ok: boolean; identity: Identity }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
)

export const logout = createAsyncThunk('auth/logout', async () => {
  return await apiFetch<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
  })
})

export const fetchCsrf = createAsyncThunk('auth/csrf', async () => {
  return await apiFetch<{ csrf_token: string }>('/api/auth/csrf')
})

export const fetchMe = createAsyncThunk('auth/me', async () => {
  return await apiFetch<{ identity: Identity }>('/api/auth/me')
})

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(login.pending, (s) => {
      s.status = 'loading'
      s.error = null
    })
    b.addCase(login.fulfilled, (s, a) => {
      s.identity = a.payload.identity
      s.csrfToken = a.payload.identity?.csrf ?? null
      s.status = a.payload.identity?.user ? 'authenticated' : 'anonymous'
      s.error = null
    })
    b.addCase(login.rejected, (s, a) => {
      s.status = 'error'
      s.error = a.error.message || 'Login failed'
    })

    b.addCase(logout.fulfilled, (s) => {
      s.identity = null
      s.csrfToken = null
      s.status = 'anonymous'
    })

    b.addCase(fetchCsrf.fulfilled, (s, a) => {
      s.csrfToken = a.payload.csrf_token
    })

    b.addCase(fetchMe.fulfilled, (s, a) => {
      s.identity = a.payload.identity
      s.csrfToken = a.payload.identity?.csrf ?? null
      s.status = a.payload.identity?.user ? 'authenticated' : 'anonymous'
    })
    b.addCase(fetchMe.pending, (s) => {
      // Keep UI predictable during app start / refresh.
      s.status = 'loading'
      s.error = null
    })
    b.addCase(fetchMe.rejected, (s) => {
      // Most common case is 401 when no session exists.
      s.identity = null
      s.csrfToken = null
      s.status = 'anonymous'
      s.error = null
    })
  },
})

export const authReducer = slice.reducer


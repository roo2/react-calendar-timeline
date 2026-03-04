import { configureStore } from '@reduxjs/toolkit'
import { setCsrfTokenGetter } from '../api/client'
import { authReducer } from './slices/authSlice'
import { customersReducer } from './slices/customersSlice'
import { inventoryReducer } from './slices/inventorySlice'
import { productsReducer } from './slices/productsSlice'
import { quotesReducer } from './slices/quotesSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    customers: customersReducer,
    inventory: inventoryReducer,
    products: productsReducer,
    quotes: quotesReducer,
  },
})

// Allow apiFetch() to automatically attach CSRF tokens for mutating requests.
setCsrfTokenGetter(() => store.getState().auth.csrfToken)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch


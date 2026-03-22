import { configureStore } from '@reduxjs/toolkit'
import { setCsrfTokenGetter } from '../api/client'
import { adminRateCardsReducer } from './slices/adminRateCardsSlice'
import { authReducer } from './slices/authSlice'
import { customersReducer } from './slices/customersSlice'
import { dashboardReducer } from './slices/dashboardSlice'
import { inventoryReducer } from './slices/inventorySlice'
import { productsReducer } from './slices/productsSlice'
import { jobSheetsReducer } from './slices/jobSheetsSlice'
import { ordersReducer } from './slices/ordersSlice'
import { productSpecReducer } from './slices/productSpecSlice'
import { quotesReducer } from './slices/quotesSlice'

export const store = configureStore({
  reducer: {
    adminRateCards: adminRateCardsReducer,
    auth: authReducer,
    customers: customersReducer,
    dashboard: dashboardReducer,
    inventory: inventoryReducer,
    jobSheets: jobSheetsReducer,
    orders: ordersReducer,
    productSpec: productSpecReducer,
    products: productsReducer,
    quotes: quotesReducer,
  },
})

// Allow apiFetch() to automatically attach CSRF tokens for mutating requests.
setCsrfTokenGetter(() => store.getState().auth.csrfToken)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch


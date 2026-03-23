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
import { scheduleReducer } from './slices/scheduleSlice'
import { productionCalendarReducer } from './slices/productionCalendarSlice'

/**
 * Redux DevTools can add noticeable overhead on busy pages. Opt in with VITE_REDUX_DEVTOOLS=true.
 * (In production builds, DevTools are off regardless.)
 */
export const store = configureStore({
  devTools: import.meta.env.VITE_REDUX_DEVTOOLS === 'true',
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
    schedule: scheduleReducer,
    productionCalendar: productionCalendarReducer,
  },
})

// Allow apiFetch() to automatically attach CSRF tokens for mutating requests.
setCsrfTokenGetter(() => store.getState().auth.csrfToken)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch


import { Fragment, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { store } from './store'
import { CssBaseline } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' },
  },
  components: {
    MuiTextField: {
      defaultProps: {
        // Always show label above the input (shrink), even when empty or disabled.
        InputLabelProps: { shrink: true },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          // Disable the default hover background across the app.
          '&.MuiTableRow-hover:hover': {
            backgroundColor: 'inherit',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          // Transparent border when disabled so computed/read-only fields are visually distinct.
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
            borderColor: 'transparent',
          },
        },
      },
    },
  },
})

function GlobalWheelGuard() {
  // Prevent mouse wheel from changing focused number inputs while scrolling.
  useEffect(() => {
    function onWheel() {
      const el = document.activeElement
      if (!el) return
      if (el instanceof HTMLInputElement && el.type === 'number') {
        // Blurring avoids the browser increment/decrement behavior without breaking scroll.
        el.blur()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true } as any)
  }, [])
  return null
}

/**
 * StrictMode double-invokes effects in dev (e.g. schedule page fetches gantt twice).
 * Set VITE_REACT_STRICT_MODE=true to re-enable. Production behaviour is unchanged.
 */
const AppTree = (
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalWheelGuard />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </Provider>
)

const RootWrapper = import.meta.env.VITE_REACT_STRICT_MODE === 'true' ? StrictMode : Fragment

createRoot(document.getElementById('root')!).render(<RootWrapper>{AppTree}</RootWrapper>)

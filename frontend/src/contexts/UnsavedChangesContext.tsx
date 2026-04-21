import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from '@mui/material'

type UnsavedChangesContextValue = {
  isDirty: boolean
  setDirty: (dirty: boolean) => void
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null)

export function useUnsavedChanges(): UnsavedChangesContextValue {
  const ctx = useContext(UnsavedChangesContext)
  if (!ctx) {
    return {
      isDirty: false,
      setDirty: () => {},
    }
  }
  return ctx
}

/** Handles beforeunload (tab close / refresh) when there are unsaved changes. */
function BeforeUnload({ isDirty }: { isDirty: boolean }) {
  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
  return null
}

/** Intercepts in-app link clicks when dirty and shows confirmation dialog. */
function UnsavedChangesGuard({ children }: { children: ReactNode }) {
  const { isDirty, setDirty } = useUnsavedChanges()
  const navigate = useNavigate()
  const [pendingNav, setPendingNav] = useState<string | null>(null)
  const isInternalNav = useRef(false)

  useEffect(() => {
    if (!isDirty) return
    const handleClick = (e: MouseEvent) => {
      if (isInternalNav.current) return
      const target = e.target as HTMLElement
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      const isInternal = href.startsWith('/') || (!href.startsWith('http') && !href.startsWith('//'))
      if (!isInternal) return
      e.preventDefault()
      e.stopPropagation()
      setPendingNav(href)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [isDirty])

  const handleClose = useCallback(() => setPendingNav(null), [])
  const handleLeave = useCallback(() => {
    const to = pendingNav
    setPendingNav(null)
    if (to) {
      setDirty(false)
      isInternalNav.current = true
      navigate(to)
      setTimeout(() => { isInternalNav.current = false }, 0)
    }
  }, [pendingNav, setDirty, navigate])

  return (
    <>
      {children}
      <BeforeUnload isDirty={isDirty} />
      <Dialog open={pendingNav !== null} onClose={handleClose} disableEscapeKeyDown>
        <DialogTitle>Unsaved changes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved changes. Do you want to leave without saving?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="inherit">
            Stay
          </Button>
          <Button onClick={handleLeave} color="primary" variant="contained">
            Leave
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [isDirty, setDirtyState] = useState(false)
  const setDirty = useCallback((dirty: boolean) => setDirtyState(dirty), [])
  const location = useLocation()
  useEffect(() => {
    setDirtyState(false)
  }, [location.pathname, location.key])

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setDirty }}>
      <UnsavedChangesGuard>{children}</UnsavedChangesGuard>
    </UnsavedChangesContext.Provider>
  )
}

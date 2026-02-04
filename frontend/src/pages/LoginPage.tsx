import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { login } from '../store/slices/authSlice'
import { Alert, Button, Paper, Stack, TextField, Typography } from '@mui/material'

export function LoginPage() {
  const dispatch = useAppDispatch()
  const nav = useNavigate()
  const location = useLocation()
  const auth = useAppSelector((s) => s.auth)

  const qs = new URLSearchParams(location.search)
  const nextParam = qs.get('next')
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  if (auth.identity?.user) {
    return <Navigate to={next} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    try {
      await dispatch(login({ username, password })).unwrap()
      nav(next, { replace: true })
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as any).message)
            : 'Login failed'
      setLocalError(msg)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 480, mx: 'auto' }}>
      <Stack spacing={2}>
        <Typography variant="h5">Login</Typography>

        <form onSubmit={onSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              autoComplete="username"
            />
            <TextField
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              type="password"
              autoComplete="current-password"
            />
            <Button type="submit" variant="contained" disabled={auth.status === 'loading'}>
              {auth.status === 'loading' ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </form>

        {(localError || auth.error) && (
          <Alert severity="error">{localError || auth.error}</Alert>
        )}
      </Stack>
    </Paper>
  )
}


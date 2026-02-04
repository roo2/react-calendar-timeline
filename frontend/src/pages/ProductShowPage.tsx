import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

export function ProductShowPage() {
  const { productId } = useParams()

  const csrfToken = useAppSelector((s) => s.auth.csrfToken)
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = roles.includes('PROD_MANAGER')
  const canSuggest = roles.includes('OPERATOR') || isPm

  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [suggestCategory, setSuggestCategory] = useState('')
  const [suggestText, setSuggestText] = useState('')
  const [busySuggestion, setBusySuggestion] = useState(false)

  useEffect(() => {
    if (!productId) return
    void (async () => {
      try {
        setErr(null)
        const [res, sugg] = await Promise.all([
          apiFetch<any>(`/api/products/${productId}`),
          apiFetch<{ items: any[] }>(`/api/suggestions?status=open&product_id=${encodeURIComponent(productId)}`),
        ])
        setData(res)
        setSuggestions(sugg.items || [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load product')
      }
    })()
  }, [productId])

  async function reloadSuggestions() {
    if (!productId) return
    const res = await apiFetch<{ items: any[] }>(`/api/suggestions?status=open&product_id=${encodeURIComponent(productId)}`)
    setSuggestions(res.items || [])
  }

  async function onSubmitSuggestion(e: FormEvent) {
    e.preventDefault()
    if (!productId || !canSuggest || !suggestText.trim()) return
    try {
      setBusySuggestion(true)
      setErr(null)
      await apiFetch<any>(`/api/products/${productId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({
          category: suggestCategory.trim() || null,
          suggestion_text: suggestText.trim(),
        }),
        csrfToken: csrfToken || undefined,
      })
      setSuggestCategory('')
      setSuggestText('')
      await reloadSuggestions()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to submit suggestion')
    } finally {
      setBusySuggestion(false)
    }
  }

  async function resolveSuggestion(suggestionId: string, decision: 'accept' | 'reject') {
    if (!csrfToken) {
      setErr('Missing CSRF token. Please re-login.')
      return
    }
    try {
      setBusySuggestion(true)
      setErr(null)
      await apiFetch<any>(`/api/suggestions/${suggestionId}/resolve?decision=${decision}`, {
        method: 'POST',
        csrfToken,
      })
      if (productId) setData(await apiFetch<any>(`/api/products/${productId}`))
      await reloadSuggestions()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to resolve suggestion')
    } finally {
      setBusySuggestion(false)
    }
  }

  if (err) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Product</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
      </Stack>
    )
  }
  if (!data) return <p>Loading…</p>

  const product = data.product
  const versions = data.versions || []

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5">Product {product.code}</Typography>
          <Typography color="text.secondary" variant="body2">
            Customer: {product.customer_name || '-'} • Active Version: {product.active_version_id || '-'}
          </Typography>
        </Box>
        {isPm && (
          <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
            Create New Version
          </Button>
        )}
      </Box>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Version</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Created At</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((v: any) => (
              <TableRow key={v.id} hover>
                <TableCell>
                  <Typography fontWeight={600}>{v.version_number}</Typography>
                </TableCell>
                <TableCell>{v.created_by}</TableCell>
                <TableCell>{v.created_at}</TableCell>
                <TableCell>
                  <MuiLink component={Link} to={`/products/${productId}/versions/${v.id}`} underline="hover">
                    View
                  </MuiLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Suggest an Improvement</Typography>
          {!canSuggest ? (
            <Typography color="text.secondary">You don’t have permission to submit suggestions.</Typography>
          ) : (
            <form onSubmit={onSubmitSuggestion}>
              <Stack spacing={2}>
                <TextField
                  label="Category (optional)"
                  value={suggestCategory}
                  onChange={(e) => setSuggestCategory(e.currentTarget.value)}
                />
                <TextField
                  label="Suggestion"
                  value={suggestText}
                  onChange={(e) => setSuggestText(e.currentTarget.value)}
                  multiline
                  minRows={4}
                  required
                />
                <Button type="submit" variant="contained" disabled={busySuggestion}>
                  Submit Suggestion
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>

      {suggestions.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell>Text</TableCell>
                <TableCell>Created By</TableCell>
                <TableCell>Created At</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {suggestions.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>{s.category || '-'}</TableCell>
                  <TableCell>{s.text}</TableCell>
                  <TableCell>{s.created_by}</TableCell>
                  <TableCell>{s.created_at}</TableCell>
                  <TableCell>
                    {isPm && (
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => resolveSuggestion(s.id, 'accept')}
                          disabled={busySuggestion}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          onClick={() => resolveSuggestion(s.id, 'reject')}
                          disabled={busySuggestion}
                        >
                          Reject
                        </Button>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
      </Box>
    </Stack>
  )
}


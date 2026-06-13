import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { can } from '../../auth/permissions'
import { deleteSavedQuote, fetchSavedQuote } from '../../store/slices/quotesSlice'
import { isRejectedWithValue } from '@reduxjs/toolkit'
import { ApiError } from '../../api/client'
import { QuotesPage, type SavedQuoteInitialData } from './QuotesPage'

export function QuoteEditPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')
  const detail = useAppSelector((s) => (id ? s.quotes.detail.byId[id] : undefined))
  const quote = detail?.quote
  const loadErr = detail?.error ?? null
  const loading = detail?.status === 'loading'
  const notFetched = id && !detail
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void dispatch(fetchSavedQuote(id))
  }, [id, dispatch])

  async function onDeleteQuote() {
    if (!id || !canEdit || deleting) return
    const ok = window.confirm('Delete this quote permanently? This cannot be undone.')
    if (!ok) return
    setDeleteErr(null)
    setDeleting(true)
    try {
      await dispatch(deleteSavedQuote(id)).unwrap()
      nav('/quotes')
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as { message?: string }
        setDeleteErr(p.message || 'Failed to delete quote')
      } else if (e instanceof ApiError) {
        setDeleteErr(e.message || 'Failed to delete quote')
      } else {
        setDeleteErr(e instanceof Error ? e.message : 'Failed to delete quote')
      }
    } finally {
      setDeleting(false)
    }
  }

  if (loadErr) {
    return (
      <Box sx={{ py: 2 }}>
        <Typography color="error">{loadErr}</Typography>
      </Box>
    )
  }

  if (notFetched || loading || !quote) {
    return (
      <Box sx={{ py: 2 }}>
        <Typography color="text.secondary">Loading quote…</Typography>
      </Box>
    )
  }

  const initialData: SavedQuoteInitialData = {
    customer_id: quote.customer_id,
    customer_name: quote.customer_name ?? null,
    payload: quote.payload || {},
    cost_per_kg: quote.cost_per_kg,
    price_per_kg: quote.price_per_kg,
    created_at: quote.created_at ?? null,
    updated_at: quote.updated_at ?? null,
  }

  return (
    <Stack spacing={2}>
      {canEdit ? (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
          {deleteErr ? (
            <Typography variant="caption" color="error" sx={{ alignSelf: 'center', mr: 'auto' }}>
              {deleteErr}
            </Typography>
          ) : null}
          <Button variant="outlined" color="error" disabled={deleting} onClick={() => void onDeleteQuote()}>
            {deleting ? 'Deleting…' : 'Delete quote'}
          </Button>
        </Box>
      ) : null}
      <QuotesPage key={quote.id} quoteId={quote.id} initialData={initialData} />
    </Stack>
  )
}

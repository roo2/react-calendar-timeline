import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchSavedQuote } from '../../store/slices/quotesSlice'
import { QuotesPage, type SavedQuoteInitialData } from './QuotesPage'

export function QuoteEditPage() {
  const { id } = useParams<{ id: string }>()
  const dispatch = useAppDispatch()
  const detail = useAppSelector((s) => (id ? s.quotes.detail.byId[id] : undefined))
  const quote = detail?.quote
  const loadErr = detail?.error ?? null
  const loading = detail?.status === 'loading'
  const notFetched = id && !detail

  useEffect(() => {
    if (!id) return
    void dispatch(fetchSavedQuote(id))
  }, [id, dispatch])

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
    payload: quote.payload || {},
    cost_per_kg: quote.cost_per_kg,
    price_per_kg: quote.price_per_kg,
  }

  return <QuotesPage quoteId={quote.id} initialData={initialData} />
}

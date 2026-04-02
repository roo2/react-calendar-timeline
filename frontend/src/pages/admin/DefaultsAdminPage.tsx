import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminSaveQuoteDefaults,
  fetchAdminQuoteDefaults,
  type QuoteDefaultsSettings,
} from '../../store/slices/adminRateCardsSlice'
import { AdminPageHeader } from './components/AdminPageHeader'

export type { QuoteDefaultsSettings }

export function DefaultsAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const { data: settings, status, error: loadErr } = useAppSelector((s) => s.adminRateCards.quoteDefaults)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [marginPct, setMarginPct] = useState<number | ''>(37)

  useEffect(() => {
    void dispatch(fetchAdminQuoteDefaults())
  }, [dispatch])

  useEffect(() => {
    if (!settings) return
    setMarginPct(settings.default_margin_pct)
  }, [settings])

  const dirty = settings != null && Number(marginPct) !== settings.default_margin_pct

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  const displayErr = err || loadErr

  async function handleSave() {
    const m = Number(marginPct)
    if (!Number.isFinite(m) || m < 0 || m >= 100) {
      setErr('Margin must be a number from 0 up to (but not including) 100.')
      return
    }
    try {
      setErr(null)
      setSaving(true)
      await dispatch(adminSaveQuoteDefaults({ default_margin_pct: m })).unwrap()
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Defaults"
        subtitle="Quote calculator defaults for new quotes (margin %). Saved quotes keep their own margin."
      />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 480 }}>
        {loading && !settings ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <TextField
              size="small"
              label="Default margin (%)"
              type="number"
              inputProps={{ min: 0, max: 99.99, step: 0.01 }}
              value={marginPct}
              onChange={(e) => setMarginPct(e.target.value === '' ? '' : Number(e.target.value))}
              helperText="Used when opening a new quote (before any save). Range: 0–99.99."
            />
            <Box>
              <Button variant="contained" disabled={saving || !dirty || marginPct === ''} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Box>
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}

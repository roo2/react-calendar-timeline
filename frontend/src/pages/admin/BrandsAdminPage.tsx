import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Paper,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'

type BrandRow = {
  id: string
  code: string
  name: string
  xero_branding_theme_id?: string | null
}

export function BrandsAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [rows, setRows] = useState<BrandRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  async function load() {
    try {
      setLoadErr(null)
      setLoading(true)
      const list = await apiFetch<BrandRow[]>('/api/admin/brands')
      const items = Array.isArray(list) ? list : []
      setRows(items)
      setDrafts(
        Object.fromEntries(
          items.map((row) => [row.id, String(row.xero_branding_theme_id || '').trim()]),
        ),
      )
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
      setRows([])
      setDrafts({})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function saveRow(row: BrandRow) {
    const draft = (drafts[row.id] ?? '').trim()
    const current = String(row.xero_branding_theme_id || '').trim()
    if (draft === current) return
    try {
      setErr(null)
      setSavingId(row.id)
      await apiFetch(`/api/admin/brands/${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ xero_branding_theme_id: draft || null }),
      })
      setDirty(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="Brands"
        subtitle="Map each commercial brand to its Xero BrandingThemeID. Used when pushing customers to Xero and when exporting invoices."
      />

      <Alert severity="info">
        Find theme IDs in Xero under Settings → Invoice settings → Branding themes, or via the{' '}
        <RouterLink to="/admin/xero">Xero admin</RouterLink> API GET utility (
        <code>/BrandingThemes</code>).
      </Alert>

      {loadErr ? <Alert severity="error">{loadErr}</Alert> : null}
      {err ? <Alert severity="error">{err}</Alert> : null}

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : null}

      {!loading && rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No brands found.
        </Typography>
      ) : null}

      {!loading && rows.length > 0 ? (
        <Paper variant="outlined">
          <AdminDataTable>
          <TableHead>
            <TableRow>
              <TableCell>Brand</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Xero BrandingThemeID</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const draft = drafts[row.id] ?? ''
              const current = String(row.xero_branding_theme_id || '').trim()
              const dirty = draft.trim() !== current
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                      {row.code}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 360 }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={draft}
                      onChange={(e) => {
                        setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                        setDirty(true)
                      }}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      helperText="Leave blank to clear the mapping"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!dirty || savingId !== null}
                      onClick={() => void saveRow(row)}
                    >
                      {savingId === row.id ? 'Saving…' : 'Save'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </AdminDataTable>
      </Paper>
      ) : null}
    </Stack>
  )
}

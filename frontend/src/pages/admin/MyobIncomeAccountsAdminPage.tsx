import { useEffect, useState } from 'react'
import { Alert, Paper, Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'

type Row = {
  myob_account_uid: string
  name: string | null
  display_id: string | null
  synced_at: string | null
}

export function MyobIncomeAccountsAdminPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoadErr(null)
        setLoading(true)
        const list = await apiFetch<Row[]>('/api/myob/income-accounts')
        if (!cancelled) setRows(Array.isArray(list) ? list : [])
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : 'Failed to load')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="MYOB income accounts"
        subtitle="Accounts referenced on MYOB inventory items (IncomeAccount). Synced automatically when items are fetched or the MYOB item UOM cache is rebuilt. Read-only."
      />
      {loadErr ? <Alert severity="error">{loadErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && rows.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary">
            No income accounts cached yet. Rebuild the MYOB item cache on the MYOB admin page, or import orders so
            inventory items are fetched.
          </Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>Display ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 320 }}>MYOB UID</TableCell>
                <TableCell sx={{ width: 200 }}>Last synced (UTC)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.myob_account_uid} hover>
                  <TableCell>{r.display_id || '—'}</TableCell>
                  <TableCell>{r.name || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" component="code" sx={{ wordBreak: 'break-all' }}>
                      {r.myob_account_uid}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {r.synced_at
                      ? String(r.synced_at).replace('T', ' ').slice(0, 19)
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

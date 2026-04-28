import { useEffect, useState } from 'react'
import { Alert, Paper, Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'

const ITEM_LIST_LIMIT = 10_000

type IncomeRow = {
  myob_account_uid: string
  name: string | null
  display_id: string | null
  synced_at: string | null
}

type ItemRow = {
  myob_item_uid: string
  selling_unit_of_measure: string | null
  is_bought: boolean | null
  is_sold: boolean | null
  is_inventoried: boolean | null
  myob_income_account_uid: string | null
  income_account_display_id: string | null
  income_account_name: string | null
  synced_at: string | null
}

type ItemsResponse = { total: number; items: ItemRow[] }

function triState(v: boolean | null | undefined): string {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return '—'
}

export function MyobDataAdminPage() {
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([])
  const [itemsPayload, setItemsPayload] = useState<ItemsResponse | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoadErr(null)
        setLoading(true)
        const itemsUrl = `/api/myob/item-selling-uoms?limit=${ITEM_LIST_LIMIT}&offset=0`
        const [incomeList, itemsRes] = await Promise.all([
          apiFetch<IncomeRow[]>('/api/myob/income-accounts'),
          apiFetch<ItemsResponse>(itemsUrl),
        ])
        if (!cancelled) {
          setIncomeRows(Array.isArray(incomeList) ? incomeList : [])
          setItemsPayload(
            itemsRes && typeof itemsRes.total === 'number' && Array.isArray(itemsRes.items)
              ? itemsRes
              : { total: 0, items: [] },
          )
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : 'Failed to load')
          setIncomeRows([])
          setItemsPayload({ total: 0, items: [] })
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

  const itemRows = itemsPayload?.items ?? []
  const itemsTotal = itemsPayload?.total ?? 0
  const itemsTruncated = itemRows.length < itemsTotal

  return (
    <Stack spacing={2}>
      <AdminPageHeader
        title="MYOB data"
        subtitle="Locally cached MYOB reference data: GL income accounts from inventory items, and the per-item UID cache (selling UOM, bought/sold/stock flags, income account) used when importing orders. Rebuild the item cache from the MYOB admin page."
      />
      {loadErr ? <Alert severity="error">{loadErr}</Alert> : null}

      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Income accounts
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && incomeRows.length === 0 && itemRows.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : incomeRows.length === 0 ? (
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
              {incomeRows.map((r) => (
                <TableRow key={r.myob_account_uid} hover>
                  <TableCell>{r.display_id || '—'}</TableCell>
                  <TableCell>{r.name || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" component="code" sx={{ wordBreak: 'break-all' }}>
                      {r.myob_account_uid}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {r.synced_at ? String(r.synced_at).replace('T', ' ').slice(0, 19) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
        Cached inventory items
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {itemsTotal.toLocaleString()} UID(s) in <code style={{ fontSize: '0.9em' }}>myob_item_selling_uoms</code>
        {itemsTruncated
          ? ` — showing first ${itemRows.length.toLocaleString()} (cap ${ITEM_LIST_LIMIT.toLocaleString()} per load)`
          : itemRows.length > 0
            ? ` — ${itemRows.length.toLocaleString()} loaded`
            : null}
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {!loading && itemRows.length === 0 ? (
          <Typography color="text.secondary">
            No cached items yet. Use <strong>Rebuild item UOM cache</strong> on the MYOB admin page after connecting
            MYOB.
          </Typography>
        ) : itemRows.length === 0 && loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 300 }}>Item UID</TableCell>
                <TableCell sx={{ width: 120 }}>Selling UOM</TableCell>
                <TableCell sx={{ width: 72 }}>Bought</TableCell>
                <TableCell sx={{ width: 72 }}>Sold</TableCell>
                <TableCell sx={{ width: 100 }}>Inventoried</TableCell>
                <TableCell sx={{ width: 110 }}>Income acct</TableCell>
                <TableCell>Income account name</TableCell>
                <TableCell sx={{ width: 200 }}>Synced (UTC)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {itemRows.map((r) => (
                <TableRow key={r.myob_item_uid} hover>
                  <TableCell>
                    <Typography variant="body2" component="code" sx={{ wordBreak: 'break-all' }}>
                      {r.myob_item_uid}
                    </Typography>
                  </TableCell>
                  <TableCell>{r.selling_unit_of_measure || '—'}</TableCell>
                  <TableCell>{triState(r.is_bought)}</TableCell>
                  <TableCell>{triState(r.is_sold)}</TableCell>
                  <TableCell>{triState(r.is_inventoried)}</TableCell>
                  <TableCell>{r.income_account_display_id || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }} title={r.income_account_name || undefined}>
                      {r.income_account_name || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {r.synced_at ? String(r.synced_at).replace('T', ' ').slice(0, 19) : '—'}
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

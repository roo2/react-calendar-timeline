import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { adminDeleteResinBlend, adminSaveResinBlend, fetchAdminResinBlendsTab } from '../../store/slices/adminRateCardsSlice'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import { BlendComponentsEditor, type BlendComponentDraft } from './components/BlendComponentsEditor'
import type { ResinBlend } from './types'
import type { ResinOption } from '../../components/ResinSelect'

export function ResinBlendsAdminPage() {
  const dispatch = useAppDispatch()
  const resins = useAppSelector((s) => s.adminRateCards.resins.items)
  const blends = useAppSelector((s) => s.adminRateCards.resinBlends.items)
  const { status, error: loadErr } = useAppSelector((s) => s.adminRateCards.resinBlendsTab)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newComponents, setNewComponents] = useState<BlendComponentDraft[]>([{ resin_code: '', pct: '' }])

  const resinOptions: ResinOption[] = useMemo(() => {
    return (resins || []).map((r) => ({ resin_code: r.resin_code, name: r.name }))
  }, [resins])

  const canCreate = useMemo(() => {
    if (!newCode.trim() || !newName.trim()) return false
    const comps = newComponents.filter((c) => c.resin_code.trim() && c.pct !== '')
    if (comps.length === 0) return false
    const sum = comps.reduce((acc, c) => acc + Number(c.pct || 0), 0)
    return Math.abs(sum - 100) < 0.01
  }, [newCode, newComponents, newName])

  useEffect(() => {
    void dispatch(fetchAdminResinBlendsTab())
  }, [dispatch])

  const displayErr = err || loadErr

  async function saveBlend(blendCode: string, patch: Omit<ResinBlend, 'blend_code'>) {
    const trimmed = blendCode.trim()
    if (!trimmed) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminSaveResinBlend({ code: trimmed, patch })).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin blend')
    } finally {
      setSaving(null)
    }
  }

  async function deleteBlend(blendCode: string) {
    const trimmed = blendCode.trim()
    if (!trimmed) return
    if (!confirmDelete(`resin blend '${trimmed}'`)) return
    try {
      setErr(null)
      setSaving(trimmed)
      await dispatch(adminDeleteResinBlend(trimmed)).unwrap()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete resin blend')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Resin blends" subtitle="Define named blends used for quoting (components must sum to 100%)." />
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading && blends.length === 0 ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Code</TableCell>
                <TableCell sx={{ width: 260 }}>Name</TableCell>
                <TableCell>Components</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {blends.map((b) => (
                <ResinBlendRow
                  key={b.blend_code}
                  blend={b}
                  resinOptions={resinOptions}
                  saving={saving === b.blend_code}
                  onSave={saveBlend}
                  onDelete={deleteBlend}
                />
              ))}

              <NewResinBlendRow
                resinOptions={resinOptions}
                saving={saving === newCode.trim()}
                code={newCode}
                name={newName}
                components={newComponents}
                canSave={canCreate}
                onChangeCode={setNewCode}
                onChangeName={setNewName}
                onChangeComponents={setNewComponents}
                onCreate={async () => {
                  await saveBlend(newCode, {
                    name: newName.trim(),
                    components: newComponents
                      .filter((c) => c.resin_code.trim() && c.pct !== '')
                      .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
                  })
                  setNewCode('')
                  setNewName('')
                  setNewComponents([{ resin_code: '', pct: '' }])
                }}
              />
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function ResinBlendRow(props: {
  blend: ResinBlend
  resinOptions: ResinOption[]
  saving: boolean
  onSave: (blendCode: string, patch: Omit<ResinBlend, 'blend_code'>) => Promise<void>
  onDelete: (blendCode: string) => Promise<void>
}) {
  const { blend, resinOptions, saving, onSave, onDelete } = props
  const [open, setOpen] = useState(false)

  const [name, setName] = useState(blend.name)
  const [componentsDraft, setComponentsDraft] = useState<BlendComponentDraft[]>(
    blend.components.length ? blend.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct })) : [{ resin_code: '', pct: '' }],
  )

  const code = blend.blend_code
  const compsSummary = blend.components.map((c) => `${c.pct}% ${c.resin_code}`).join(', ')

  const components = componentsDraft.filter((c) => c.resin_code.trim() && c.pct !== '').map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) }))
  const sum = components.reduce((acc, c) => acc + c.pct, 0)
  const canSave = !!code.trim() && !!name.trim() && components.length > 0 && Math.abs(sum - 100) < 0.01
  const dirty =
    name !== blend.name ||
    JSON.stringify(components) !== JSON.stringify(blend.components.map((c) => ({ resin_code: c.resin_code, pct: c.pct })))

  return (
    <>
      <TableRow hover>
        <TableCell sx={{ fontFamily: 'monospace' }}>{code}</TableCell>
        <TableCell>
          <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {compsSummary || '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" variant="outlined" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Details'}
            </Button>
            <Button size="small" variant="outlined" disabled={saving || !dirty || !canSave} onClick={() => void onSave(code, { name: name.trim(), components })}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(code)}>
              Delete
            </Button>
          </Stack>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4}>
            <BlendComponentsEditor resinOptions={resinOptions} components={componentsDraft} onChange={setComponentsDraft} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function NewResinBlendRow(props: {
  resinOptions: ResinOption[]
  saving: boolean
  code: string
  name: string
  components: BlendComponentDraft[]
  canSave: boolean
  onChangeCode: (v: string) => void
  onChangeName: (v: string) => void
  onChangeComponents: (v: BlendComponentDraft[]) => void
  onCreate: () => Promise<void>
}) {
  const { resinOptions, saving, code, name, components, canSave, onChangeCode, onChangeName, onChangeComponents, onCreate } = props
  const [open, setOpen] = useState(false)
  const compsSummary = components
    .filter((c) => c.resin_code.trim() && c.pct !== '')
    .map((c) => `${Number(c.pct).toFixed(2)}% ${c.resin_code}`)
    .join(', ')
  return (
    <>
      <TableRow>
        <TableCell>
          <TextField size="small" label="Code" value={code} onChange={(e) => onChangeCode(e.target.value)} />
        </TableCell>
        <TableCell>
          <TextField size="small" fullWidth label="Name" value={name} onChange={(e) => onChangeName(e.target.value)} />
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {compsSummary || '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" variant="outlined" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Details'}
            </Button>
            <Button size="small" variant="outlined" disabled={!canSave || saving} onClick={() => void onCreate()}>
              {saving ? 'Saving…' : 'Add blend'}
            </Button>
          </Stack>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4}>
            <BlendComponentsEditor resinOptions={resinOptions} components={components} onChange={onChangeComponents} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

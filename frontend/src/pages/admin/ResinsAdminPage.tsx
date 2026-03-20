import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminDataTable } from './components/AdminDataTable'
import { AdminPageHeader } from './components/AdminPageHeader'
import { confirmDelete } from './components/confirmDelete'
import { BlendComponentsEditor, type BlendComponentDraft } from './components/BlendComponentsEditor'
import type { Additive, Colour, Resin, ResinBlend } from './types'
import type { ResinOption } from '../../components/ResinSelect'

export function ResinsAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [resins, setResins] = useState<Resin[]>([])
  const [additives, setAdditives] = useState<Additive[]>([])
  const [colours, setColours] = useState<Colour[]>([])
  const [blends, setBlends] = useState<ResinBlend[]>([])

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Resins add row
  const [newResinCode, setNewResinCode] = useState('')
  const [newResinName, setNewResinName] = useState('')
  const [newResinDensity, setNewResinDensity] = useState<number | ''>('')
  const [newResinPrice, setNewResinPrice] = useState<number | ''>('')
  const canCreateResin = useMemo(
    () => !!newResinCode.trim() && !!newResinName.trim() && newResinDensity !== '' && newResinPrice !== '',
    [newResinCode, newResinDensity, newResinName, newResinPrice],
  )

  // Additives add row
  const [newAdditiveCode, setNewAdditiveCode] = useState('')
  const [newAdditiveName, setNewAdditiveName] = useState('')
  const [newAdditivePrice, setNewAdditivePrice] = useState<number | ''>('')
  const canCreateAdditive = useMemo(
    () => !!newAdditiveCode.trim() && !!newAdditiveName.trim() && newAdditivePrice !== '',
    [newAdditiveCode, newAdditiveName, newAdditivePrice],
  )

  // Colours add row
  const [newColourCode, setNewColourCode] = useState('')
  const [newColourName, setNewColourName] = useState('')
  const [newColourPrice, setNewColourPrice] = useState<number | ''>('')
  const [newColourShortCode, setNewColourShortCode] = useState('')
  const canCreateColour = useMemo(
    () => !!newColourCode.trim() && !!newColourName.trim() && newColourPrice !== '',
    [newColourCode, newColourName, newColourPrice],
  )

  // Blends add row
  const [newBlendCode, setNewBlendCode] = useState('')
  const [newBlendName, setNewBlendName] = useState('')
  const [newBlendComponents, setNewBlendComponents] = useState<BlendComponentDraft[]>([{ resin_code: '', pct: '' }])

  const resinOptions: ResinOption[] = useMemo(() => {
    return (resins || []).map((r) => ({ resin_code: r.resin_code, name: r.name }))
  }, [resins])

  const canCreateBlend = useMemo(() => {
    if (!newBlendCode.trim() || !newBlendName.trim()) return false
    const comps = newBlendComponents.filter((c) => c.resin_code.trim() && c.pct !== '')
    if (comps.length === 0) return false
    const sum = comps.reduce((acc, c) => acc + Number(c.pct || 0), 0)
    return Math.abs(sum - 100) < 0.01
  }, [newBlendCode, newBlendComponents, newBlendName])

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const [resinRows, additiveRows, colourRows, blendRows] = await Promise.all([
          apiFetch<Resin[]>('/api/admin/rate-cards/resins'),
          apiFetch<Additive[]>('/api/admin/rate-cards/additives'),
          apiFetch<Colour[]>('/api/admin/rate-cards/colours'),
          apiFetch<ResinBlend[]>('/api/admin/rate-cards/resin-blends'),
        ])
        setResins(resinRows)
        setAdditives(additiveRows)
        setColours(colourRows)
        setBlends(blendRows)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load resins admin data')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveResin(code: string, patch: Omit<Resin, 'resin_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    const k = `resin:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<Resin>(`/api/admin/rate-cards/resins/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setResins((cur) => {
        const idx = cur.findIndex((r) => r.resin_code === saved.resin_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.resin_code.localeCompare(b.resin_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteResin(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`resin '${trimmed}'`)) return
    const k = `resin:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      await apiFetch<void>(`/api/admin/rate-cards/resins/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setResins((cur) => cur.filter((r) => r.resin_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete resin')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveAdditive(code: string, patch: Omit<Additive, 'additive_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    const k = `additive:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<Additive>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setAdditives((cur) => {
        const idx = cur.findIndex((r) => r.additive_code === saved.additive_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.additive_code.localeCompare(b.additive_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save additive')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteAdditive(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`additive '${trimmed}'`)) return
    const k = `additive:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      await apiFetch<void>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setAdditives((cur) => cur.filter((r) => r.additive_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete additive')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveColour(code: string, patch: Omit<Colour, 'colour_code'>) {
    const trimmed = code.trim()
    if (!trimmed) return
    const k = `colour:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<Colour>(`/api/admin/rate-cards/colours/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
        setColours((cur) => {
          const idx = cur.findIndex((r) => r.colour_code === saved.colour_code)
          const next = idx === -1 ? [...cur, saved] : cur.slice().map((r, i) => (i === idx ? saved : r))
          return next.sort((a, b) => a.sort_order - b.sort_order || a.colour_code.localeCompare(b.colour_code))
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save colour')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteColour(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!confirmDelete(`colour '${trimmed}'`)) return
    const k = `colour:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      await apiFetch<void>(`/api/admin/rate-cards/colours/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setColours((cur) => cur.filter((r) => r.colour_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete colour')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveBlend(blendCode: string, patch: Omit<ResinBlend, 'blend_code'>) {
    const trimmed = blendCode.trim()
    if (!trimmed) return
    const k = `blend:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      const saved = await apiFetch<ResinBlend>(`/api/admin/rate-cards/resin-blends/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setBlends((cur) => {
        const idx = cur.findIndex((b) => b.blend_code === saved.blend_code)
        if (idx === -1) return [...cur, saved].sort((a, b) => a.blend_code.localeCompare(b.blend_code))
        const next = cur.slice()
        next[idx] = saved
        return next
      })
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save resin blend')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteBlend(blendCode: string) {
    const trimmed = blendCode.trim()
    if (!trimmed) return
    if (!confirmDelete(`resin blend '${trimmed}'`)) return
    const k = `blend:${trimmed}`
    try {
      setErr(null)
      setSavingKey(k)
      await apiFetch<void>(`/api/admin/rate-cards/resin-blends/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
      setBlends((cur) => cur.filter((b) => b.blend_code !== trimmed))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete resin blend')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Stack spacing={2}>
      <AdminPageHeader title="Resins" subtitle="Resins, additives, colours, and resin blends." />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Resins
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 140 }}>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 140 }}>Density</TableCell>
                <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {resins.map((r) => (
                <ResinRow
                  key={r.resin_code}
                  resin={r}
                  saving={savingKey === `resin:${r.resin_code}`}
                  onSave={saveResin}
                  onDelete={deleteResin}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newResinCode} onChange={(e) => setNewResinCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newResinName} onChange={(e) => setNewResinName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="Density"
                    inputProps={{ inputMode: 'decimal' }}
                    value={newResinDensity}
                    onChange={(e) => setNewResinDensity(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="Price / kg"
                    inputProps={{ inputMode: 'decimal' }}
                    value={newResinPrice}
                    onChange={(e) => setNewResinPrice(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateResin || savingKey === `resin:${newResinCode.trim()}`}
                    onClick={() => {
                      if (!canCreateResin) return
                      void saveResin(newResinCode, {
                        name: newResinName.trim(),
                        density: Number(newResinDensity),
                        price_per_kg: Number(newResinPrice),
                      }).then(() => {
                        setNewResinCode('')
                        setNewResinName('')
                        setNewResinDensity('')
                        setNewResinPrice('')
                      })
                    }}
                  >
                    Add resin
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Additives
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {additives.map((a) => (
                <AdditiveRow
                  key={a.additive_code}
                  row={a}
                  saving={savingKey === `additive:${a.additive_code}`}
                  onSave={saveAdditive}
                  onDelete={deleteAdditive}
                />
              ))}
              <TableRow>
                <TableCell>
                  <TextField size="small" label="Code" value={newAdditiveCode} onChange={(e) => setNewAdditiveCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newAdditiveName} onChange={(e) => setNewAdditiveName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="Price / kg"
                    inputProps={{ inputMode: 'decimal' }}
                    value={newAdditivePrice}
                    onChange={(e) => setNewAdditivePrice(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateAdditive || savingKey === `additive:${newAdditiveCode.trim()}`}
                    onClick={() => {
                      if (!canCreateAdditive) return
                      void saveAdditive(newAdditiveCode, { name: newAdditiveName.trim(), price_per_kg: Number(newAdditivePrice) }).then(() => {
                        setNewAdditiveCode('')
                        setNewAdditiveName('')
                        setNewAdditivePrice('')
                      })
                    }}
                  >
                    Add additive
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Colours
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <AdminDataTable>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 80 }}>Order</TableCell>
                <TableCell sx={{ width: 180 }}>Code</TableCell>
                <TableCell sx={{ width: 72 }}>Short</TableCell>
                <TableCell>Name</TableCell>
                <TableCell sx={{ width: 160 }}>Price / kg</TableCell>
                <TableCell sx={{ width: 180 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {colours.map((c) => (
                <ColourRow
                  key={c.colour_code}
                  row={c}
                  saving={savingKey === `colour:${c.colour_code}`}
                  onSave={saveColour}
                  onDelete={deleteColour}
                />
              ))}
              <TableRow>
                <TableCell />
                <TableCell>
                  <TextField size="small" label="Code" value={newColourCode} onChange={(e) => setNewColourCode(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField size="small" label="Short" value={newColourShortCode} onChange={(e) => setNewColourShortCode((e.target.value || '').slice(0, 3))} inputProps={{ maxLength: 3 }} placeholder="3" />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth label="Name" value={newColourName} onChange={(e) => setNewColourName(e.target.value)} />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    label="Price / kg"
                    inputProps={{ inputMode: 'decimal' }}
                    value={newColourPrice}
                    onChange={(e) => setNewColourPrice(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCreateColour || savingKey === `colour:${newColourCode.trim()}`}
                    onClick={() => {
                      if (!canCreateColour) return
                      const maxOrder = colours.length === 0 ? 0 : Math.max(...colours.map((c) => c.sort_order))
                      void saveColour(newColourCode, { name: newColourName.trim(), price_per_kg: Number(newColourPrice), sort_order: maxOrder + 1, short_code: newColourShortCode.trim() || null }).then(() => {
                        setNewColourCode('')
                        setNewColourName('')
                        setNewColourPrice('')
                        setNewColourShortCode('')
                      })
                    }}
                  >
                    Add colour
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Resin blends
        </Typography>
        {loading ? (
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
                  saving={savingKey === `blend:${b.blend_code}`}
                  onSave={saveBlend}
                  onDelete={deleteBlend}
                />
              ))}

              <NewResinBlendRow
                resinOptions={resinOptions}
                saving={savingKey === `blend:${newBlendCode.trim()}`}
                code={newBlendCode}
                name={newBlendName}
                components={newBlendComponents}
                canSave={canCreateBlend}
                onChangeCode={setNewBlendCode}
                onChangeName={setNewBlendName}
                onChangeComponents={setNewBlendComponents}
                onCreate={async () => {
                  await saveBlend(newBlendCode, {
                    name: newBlendName.trim(),
                    components: newBlendComponents
                      .filter((c) => c.resin_code.trim() && c.pct !== '')
                      .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) })),
                  })
                  setNewBlendCode('')
                  setNewBlendName('')
                  setNewBlendComponents([{ resin_code: '', pct: '' }])
                }}
              />
            </TableBody>
          </AdminDataTable>
        )}
      </Paper>
    </Stack>
  )
}

function ResinRow(props: {
  resin: Resin
  saving: boolean
  onSave: (code: string, patch: Omit<Resin, 'resin_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { resin, saving, onSave, onDelete } = props
  const [name, setName] = useState(resin.name)
  const [density, setDensity] = useState<number | ''>(resin.density)
  const [price, setPrice] = useState<number | ''>(resin.price_per_kg)
  const dirty = name !== resin.name || density !== resin.density || price !== resin.price_per_kg
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{resin.resin_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={density} onChange={(e) => setDensity(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={price} onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || density === '' || price === ''}
            onClick={() => void onSave(resin.resin_code, { name: name.trim(), density: Number(density), price_per_kg: Number(price) })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(resin.resin_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function AdditiveRow(props: {
  row: Additive
  saving: boolean
  onSave: (code: string, patch: Omit<Additive, 'additive_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState<number | ''>(row.price_per_kg)
  const dirty = name !== row.name || price !== row.price_per_kg
  return (
    <TableRow hover>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.additive_code}</TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={price} onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || price === ''}
            onClick={() => void onSave(row.additive_code, { name: name.trim(), price_per_kg: Number(price) })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.additive_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function ColourRow(props: {
  row: Colour
  saving: boolean
  onSave: (code: string, patch: Omit<Colour, 'colour_code'>) => Promise<void>
  onDelete: (code: string) => Promise<void>
}) {
  const { row, saving, onSave, onDelete } = props
  const [name, setName] = useState(row.name)
  const [price, setPrice] = useState<number | ''>(row.price_per_kg)
  const [sortOrder, setSortOrder] = useState<number | ''>(row.sort_order)
  const [shortCode, setShortCode] = useState(row.short_code ?? '')
  useEffect(() => {
    setName(row.name)
    setPrice(row.price_per_kg)
    setSortOrder(row.sort_order)
    setShortCode(row.short_code ?? '')
  }, [row.name, row.price_per_kg, row.sort_order, row.short_code])
  const dirty =
    name !== row.name ||
    price !== row.price_per_kg ||
    (sortOrder !== '' && Number(sortOrder) !== row.sort_order) ||
    shortCode !== (row.short_code ?? '')
  return (
    <TableRow hover>
      <TableCell>
        <TextField
          size="small"
          type="number"
          inputProps={{ min: 0, step: 1 }}
          sx={{ width: 72 }}
          value={sortOrder}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') setSortOrder('')
            else {
              const n = parseInt(v, 10)
              if (!Number.isNaN(n)) setSortOrder(n)
            }
          }}
        />
      </TableCell>
      <TableCell sx={{ fontFamily: 'monospace' }}>{row.colour_code}</TableCell>
      <TableCell>
        <TextField size="small" sx={{ width: 72 }} value={shortCode} onChange={(e) => setShortCode((e.target.value || '').slice(0, 3))} inputProps={{ maxLength: 3 }} />
      </TableCell>
      <TableCell>
        <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell>
        <TextField size="small" inputProps={{ inputMode: 'decimal' }} value={price} onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : '')} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !dirty || !name.trim() || price === '' || sortOrder === ''}
            onClick={() =>
              void onSave(row.colour_code, {
                name: name.trim(),
                price_per_kg: Number(price),
                sort_order: Number(sortOrder),
                short_code: shortCode.trim() || null,
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="small" variant="outlined" color="error" disabled={saving} onClick={() => void onDelete(row.colour_code)}>
            Delete
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
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
  const compsSummary = blend.components.map((c) => `${c.resin_code} ${c.pct}%`).join(', ')

  const components = componentsDraft
    .filter((c) => c.resin_code.trim() && c.pct !== '')
    .map((c) => ({ resin_code: c.resin_code.trim(), pct: Number(c.pct) }))
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
    .map((c) => `${c.resin_code} ${Number(c.pct).toFixed(2)}%`)
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


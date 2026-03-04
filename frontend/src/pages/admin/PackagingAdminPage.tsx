import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { apiFetch } from '../../api/client'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { AdminPageHeader } from './components/AdminPageHeader'

export type PackagingSettings = {
  packing_factor_rolls: number
  packing_factor_cartons: number
  pallet_volume_m3: number
}

export function PackagingAdminPage() {
  const { setDirty } = useUnsavedChanges()
  const [settings, setSettings] = useState<PackagingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [packingRolls, setPackingRolls] = useState<number | ''>(0.7)
  const [packingCartons, setPackingCartons] = useState<number | ''>(0.5)
  const [palletVolume, setPalletVolume] = useState<number | ''>(1)

  useEffect(() => {
    void (async () => {
      try {
        setErr(null)
        setLoading(true)
        const data = await apiFetch<PackagingSettings>('/api/admin/rate-cards/packaging-settings')
        setSettings(data)
        setPackingRolls(data.packing_factor_rolls)
        setPackingCartons(data.packing_factor_cartons)
        setPalletVolume(data.pallet_volume_m3)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load packaging settings')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const dirty =
    settings != null &&
    (Number(packingRolls) !== settings.packing_factor_rolls ||
      Number(packingCartons) !== settings.packing_factor_cartons ||
      Number(palletVolume) !== settings.pallet_volume_m3)

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  async function handleSave() {
    const rolls = Number(packingRolls)
    const cartons = Number(packingCartons)
    const vol = Number(palletVolume)
    if (!Number.isFinite(rolls) || rolls <= 0 || rolls > 1 || !Number.isFinite(cartons) || cartons <= 0 || cartons > 1 || !Number.isFinite(vol) || vol <= 0) {
      setErr('Invalid values: packing factors must be between 0 and 1, pallet volume must be positive.')
      return
    }
    try {
      setErr(null)
      setSaving(true)
      const data = await apiFetch<PackagingSettings>('/api/admin/rate-cards/packaging-settings', {
        method: 'PUT',
        body: JSON.stringify({
          packing_factor_rolls: rolls,
          packing_factor_cartons: cartons,
          pallet_volume_m3: vol,
        }),
      })
      setSettings(data)
      setPackingRolls(data.packing_factor_rolls)
      setPackingCartons(data.packing_factor_cartons)
      setPalletVolume(data.pallet_volume_m3)
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
        title="Shipping / Pallets"
        subtitle="Packing factors and pallet volume used to estimate number of pallets for quotes. Packing factor: fraction of pallet space occupied by product (Rolls vs Cartons)."
      />
      {err ? <Alert severity="error">{err}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 480 }}>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <TextField
              size="small"
              label="Packing factor (Rolls)"
              type="number"
              inputProps={{ min: 0.01, max: 1, step: 0.01 }}
              value={packingRolls}
              onChange={(e) => setPackingRolls(e.target.value === '' ? '' : Number(e.target.value))}
              helperText="0–1, e.g. 0.7 = 70% of pallet space is product"
            />
            <TextField
              size="small"
              label="Packing factor (Cartons)"
              type="number"
              inputProps={{ min: 0.01, max: 1, step: 0.01 }}
              value={packingCartons}
              onChange={(e) => setPackingCartons(e.target.value === '' ? '' : Number(e.target.value))}
              helperText="0–1, e.g. 0.5 = 50% of pallet space is product"
            />
            <TextField
              size="small"
              label="Pallet volume (m³)"
              type="number"
              inputProps={{ min: 0.01, step: 0.1 }}
              value={palletVolume}
              onChange={(e) => setPalletVolume(e.target.value === '' ? '' : Number(e.target.value))}
              helperText="Usable volume per pallet, default 1 m³"
            />
            <Box>
              <Button
                variant="contained"
                disabled={saving || !dirty || packingRolls === '' || packingCartons === '' || palletVolume === ''}
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Box>
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}

import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  adminSavePackagingSettings,
  fetchAdminPackagingSettings,
  type PackagingSettings,
} from '../../store/slices/adminRateCardsSlice'
import { AdminPageHeader } from './components/AdminPageHeader'

export type { PackagingSettings }

export function PackagingAdminPage() {
  const dispatch = useAppDispatch()
  const { setDirty } = useUnsavedChanges()
  const { data: settings, status, error: loadErr } = useAppSelector((s) => s.adminRateCards.packaging)
  const loading = status === 'loading'
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [packingRolls, setPackingRolls] = useState<number | ''>(0.7)
  const [packingCartons, setPackingCartons] = useState<number | ''>(0.5)
  const [palletVolume, setPalletVolume] = useState<number | ''>(1)

  useEffect(() => {
    void dispatch(fetchAdminPackagingSettings())
  }, [dispatch])

  useEffect(() => {
    if (!settings) return
    setPackingRolls(settings.packing_factor_rolls)
    setPackingCartons(settings.packing_factor_cartons)
    setPalletVolume(settings.pallet_volume_m3)
  }, [settings])

  const dirty =
    settings != null &&
    (Number(packingRolls) !== settings.packing_factor_rolls ||
      Number(packingCartons) !== settings.packing_factor_cartons ||
      Number(palletVolume) !== settings.pallet_volume_m3)

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  const displayErr = err || loadErr

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
      await dispatch(
        adminSavePackagingSettings({
          packing_factor_rolls: rolls,
          packing_factor_cartons: cartons,
          pallet_volume_m3: vol,
        }),
      ).unwrap()
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
      {displayErr ? <Alert severity="error">{displayErr}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 480 }}>
        {loading && !settings ? (
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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { can } from '../../../auth/permissions'
import { fetchOrder, patchOrder } from '../../../store/slices/ordersSlice'
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  type SelectChangeEvent,
} from '@mui/material'

/** Matches list filters and backend ``OrderStatus`` values. */
export const ORDER_STATUS_OPTIONS = [
  'draft',
  'confirmed',
  'dispatched',
  'partially_fulfilled',
  'closed',
  'cancelled',
] as const

export type OrderFormFooterVariant = 'new' | 'edit' | 'view'

type Props = {
  variant: OrderFormFooterVariant
  /** Undefined on new-order screen before a draft exists. */
  orderId?: string
  orderStatus: string
  importSource?: string | null
  importReviewStatus?: 'incomplete' | 'complete' | null
  /** When true, disable line/header edits (reserved; normally false for all statuses). */
  orderLocked?: boolean
  /** Edit new: save draft handler. */
  onSaveDraft?: () => void | Promise<void>
  saveDraftDisabled?: boolean
  saveDraftPending?: boolean
  /** Edit existing: save line/header changes. */
  onSaveChanges?: () => void | Promise<void>
  saveChangesDisabled?: boolean
  saveChangesPending?: boolean
  /** Disable status/import controls while a save or other order mutation is in flight. */
  formBusy?: boolean
  onCancel: () => void
  /** After any successful PATCH; parent refreshes local state from API. */
  onAfterPatch?: () => void | Promise<void>
}

export function OrderFormFooter(props: Props) {
  const {
    variant,
    orderId,
    orderStatus,
    importSource,
    importReviewStatus,
    orderLocked = false,
    onSaveDraft,
    saveDraftDisabled,
    saveDraftPending,
    onSaveChanges,
    saveChangesDisabled,
    saveChangesPending,
    formBusy = false,
    onCancel,
    onAfterPatch,
  } = props
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEdit = can(roles, 'SALES', 'PROD_MANAGER')

  const [statusBusy, setStatusBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [footerErr, setFooterErr] = useState<string | null>(null)

  const st = String(orderStatus || '').trim().toLowerCase()
  const [localStatus, setLocalStatus] = useState(st)
  useEffect(() => {
    setLocalStatus(st)
  }, [st])

  const importPending =
    Boolean(String(importSource || '').trim()) && String(importReviewStatus || '').trim().toLowerCase() !== 'complete'

  const statusEditable = canEdit && !orderLocked && Boolean(orderId) && !formBusy
  const showStatus = variant !== 'new'

  async function applyStatus(next: string) {
    if (!orderId || !statusEditable) return
    if (next === st) return
    setFooterErr(null)
    setStatusBusy(true)
    try {
      await dispatch(patchOrder({ orderId, body: { status: next } })).unwrap()
      await dispatch(fetchOrder(orderId)).unwrap()
      await onAfterPatch?.()
    } catch (e) {
      setLocalStatus(st)
      setFooterErr(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setStatusBusy(false)
    }
  }

  async function applyImportReview(next: 'incomplete' | 'complete') {
    if (!orderId || !canEdit) return
    const cur: 'incomplete' | 'complete' = importReviewStatus === 'complete' ? 'complete' : 'incomplete'
    if (next === cur) return
    setFooterErr(null)
    setImportBusy(true)
    try {
      await dispatch(patchOrder({ orderId, body: { import_review_status: next } })).unwrap()
      await dispatch(fetchOrder(orderId)).unwrap()
      await onAfterPatch?.()
    } catch (e) {
      setFooterErr(e instanceof Error ? e.message : 'Failed to update import review')
    } finally {
      setImportBusy(false)
    }
  }

  function onStatusSelectChange(e: SelectChangeEvent<string>) {
    const next = String(e.target.value || '').trim().toLowerCase()
    setLocalStatus(next)
    void applyStatus(next)
  }

  const trailingAction =
    variant === 'new' ? (
      <Button
        variant="outlined"
        onClick={() => void onSaveDraft?.()}
        disabled={Boolean(saveDraftDisabled) || Boolean(saveDraftPending)}
      >
        {saveDraftPending ? 'Saving…' : 'Save draft'}
      </Button>
    ) : variant === 'edit' ? (
      <Button
        variant="outlined"
        onClick={() => void onSaveChanges?.()}
        disabled={Boolean(saveChangesDisabled) || Boolean(saveChangesPending) || !onSaveChanges}
      >
        {saveChangesPending ? 'Saving…' : 'Save changes'}
      </Button>
    ) : variant === 'view' && orderId && canEdit ? (
      <Button variant="outlined" component={Link} to={`/orders/${encodeURIComponent(orderId)}/edit`}>
        Edit order
      </Button>
    ) : null

  const importControl =
    showStatus && importPending ? (
      <Button
        variant="outlined"
        size="small"
        disabled={!canEdit || importBusy || formBusy}
        onClick={() => void applyImportReview('complete')}
      >
        {importBusy ? 'Saving…' : 'Import complete'}
      </Button>
    ) : null

  return (
    <Box
      sx={{
        mt: 2,
        pt: 1,
        pb: 1,
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        bgcolor: 'background.paper',
      }}
    >
      {footerErr ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {footerErr}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap sx={{ justifyContent: 'flex-start' }}>
        <Button variant="text" color="inherit" onClick={onCancel}>
          Cancel
        </Button>
        {showStatus ? (
          <FormControl size="small" sx={{ minWidth: 200 }} disabled={!statusEditable || statusBusy}>
            <InputLabel id="order-form-footer-status">Order status</InputLabel>
            <Select
              labelId="order-form-footer-status"
              label="Order status"
              value={localStatus}
              onChange={onStatusSelectChange}
            >
              {ORDER_STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        {importControl}
        {trailingAction}
      </Stack>
    </Box>
  )
}

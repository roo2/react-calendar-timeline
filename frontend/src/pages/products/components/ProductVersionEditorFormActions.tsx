import { Link } from 'react-router-dom'
import { Button } from '@mui/material'
import { SaveAsNewProductButton, SaveFormButton } from '../../../components/SaveActionButtons'

export type ProductVersionEditorFormActionsProps = {
  onCancel?: () => void
  /** Used when `onCancel` is not provided (standalone product page). */
  cancelTo?: string
  canDeleteProduct?: boolean
  deletingProduct?: boolean
  onDeleteProduct?: () => void | Promise<void>
  showSaveAsNewProduct?: boolean
  saveAsNewDisabled?: boolean
  savingAsNew?: boolean
  onSaveAsNewProduct?: () => void | Promise<void>
  submitDisabled?: boolean
  submitSaving?: boolean
  submitLabel?: string
}

/**
 * Primary actions for {@link ProductVersionEditor}: same ordering and styling at top (Job Sheet header)
 * and bottom of the form so modal + full-page flows stay consistent.
 */
export function ProductVersionEditorFormActions(props: ProductVersionEditorFormActionsProps) {
  const {
    onCancel,
    cancelTo,
    canDeleteProduct = false,
    deletingProduct = false,
    onDeleteProduct,
    showSaveAsNewProduct = false,
    saveAsNewDisabled = false,
    savingAsNew = false,
    onSaveAsNewProduct,
    submitDisabled = false,
    submitSaving = false,
    submitLabel = 'Save',
  } = props

  return (
    <>
      {onCancel ? (
        <Button type="button" variant="text" color="primary" onClick={onCancel}>
          Cancel
        </Button>
      ) : (
        <Button component={Link} to={cancelTo || '/products'} variant="text" color="primary">
          Cancel
        </Button>
      )}
      {canDeleteProduct ? (
        <Button
          type="button"
          variant="outlined"
          color="error"
          disabled={submitDisabled}
          onClick={() => void onDeleteProduct?.()}
        >
          {deletingProduct ? 'Deleting…' : 'Delete product'}
        </Button>
      ) : null}
      {showSaveAsNewProduct ? (
        <SaveAsNewProductButton
          disabled={saveAsNewDisabled}
          saving={savingAsNew}
          onClick={() => void onSaveAsNewProduct?.()}
        />
      ) : null}
      <SaveFormButton
        type="submit"
        disabled={submitDisabled}
        saving={submitSaving}
        label={submitLabel}
      />
    </>
  )
}

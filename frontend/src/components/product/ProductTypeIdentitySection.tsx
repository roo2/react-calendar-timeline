import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { DefaultSelectField } from '../DefaultSelectField'
import { PRODUCT_TYPE, PRODUCT_TYPES, productTypeLabel } from '../../utils/productTypes'

export type ProductTypeIdentitySectionProps = {
  customerCode: string
  onCustomerCodeChange: (value: string) => void
  customerFacingDescription: string
  onCustomerFacingDescriptionChange: (value: string) => void
  generatedProductCodePlaceholder: string
  customerFacingDescriptionPlaceholder: string
  customerCodeError?: boolean
  customerCodeHelperText?: string
  productType: string
  onProductTypeChange: (value: string) => void
  finishMode: string
  onFinishModeChange: (value: string) => void
  isTubeProduct?: boolean
  notes: string
  onNotesChange: (value: string) => void
  notesError?: string
}

/**
 * Product Type block: customer-facing code/description, product type, finish mode, notes.
 * Shared by {@link SpecPayloadForm} (job sheet + product version editors).
 */
export function ProductTypeIdentitySection(props: ProductTypeIdentitySectionProps) {
  const {
    customerCode,
    onCustomerCodeChange,
    customerFacingDescription,
    onCustomerFacingDescriptionChange,
    generatedProductCodePlaceholder,
    customerFacingDescriptionPlaceholder,
    customerCodeError = false,
    customerCodeHelperText,
    productType,
    onProductTypeChange,
    finishMode,
    onFinishModeChange,
    isTubeProduct = false,
    notes,
    onNotesChange,
    notesError,
  } = props

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Product Type
      </Typography>

      <Box
        sx={{
          mb: 2,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 2fr)' },
          gap: 2,
          alignItems: 'flex-start',
        }}
      >
        <TextField
          label="Customer-facing product code"
          placeholder={generatedProductCodePlaceholder}
          value={customerCode}
          onChange={(e) => onCustomerCodeChange(e.target.value)}
          fullWidth
          multiline
          inputProps={{ maxLength: 64 }}
          error={customerCodeError}
          helperText={customerCodeHelperText}
        />
        <TextField
          label="Customer-facing description"
          placeholder={customerFacingDescriptionPlaceholder}
          value={customerFacingDescription}
          onChange={(e) => onCustomerFacingDescriptionChange(e.target.value)}
          fullWidth
          multiline
          minRows={1}
          InputLabelProps={{ shrink: true }}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2 }}>
        <DefaultSelectField
          label="Product Type"
          defaultValue={PRODUCT_TYPE.Bag}
          value={productType || PRODUCT_TYPE.Bag}
          onChange={(e) => onProductTypeChange(e.target.value)}
        >
          {PRODUCT_TYPES.map((v) => (
            <MenuItem key={v} value={v}>
              {productTypeLabel(v)}
            </MenuItem>
          ))}
        </DefaultSelectField>

        <DefaultSelectField
          label="Finish Mode"
          defaultValue="Rolls"
          value={finishMode || 'Rolls'}
          onChange={(e) => onFinishModeChange(e.target.value)}
        >
          <MenuItem value="Rolls">Rolls</MenuItem>
          <MenuItem value="Cartons" disabled={isTubeProduct}>
            Cartons
          </MenuItem>
        </DefaultSelectField>
      </Box>

      <Box sx={{ mt: 2 }}>
        <TextField
          label="Notes"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          multiline
          minRows={3}
          fullWidth
          error={!!notesError}
          helperText={notesError || ''}
        />
      </Box>
    </Box>
  )
}

import { Box, ListSubheader, MenuItem, TextField, Typography } from '@mui/material'
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
  onProductTypeChange: (productType: string, finishMode?: string) => void
  finishMode: string
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
    isTubeProduct = false,
    notes,
    onNotesChange,
    notesError,
  } = props

  const combinedValue = `${productType || PRODUCT_TYPE.Bag}::${finishMode || 'Rolls'}`
  const rollOptions = PRODUCT_TYPES.map((pt) => ({
    finishMode: 'Rolls',
    value: `${pt}::Rolls`,
    label: `${productTypeLabel(pt)} on Roll`,
  }))
  const cartonOptions = PRODUCT_TYPES.filter((pt) => pt !== PRODUCT_TYPE.Tube).map((pt) => ({
    finishMode: 'Cartons',
    value: `${pt}::Cartons`,
    label: `${productTypeLabel(pt)} in Carton`,
  }))

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
          label="Product / Finish"
          defaultValue={`${PRODUCT_TYPE.Bag}::Rolls`}
          value={combinedValue}
          onChange={(e) => {
            const [nextProductType, nextFinishMode] = String(e.target.value).split('::')
            onProductTypeChange(nextProductType || PRODUCT_TYPE.Bag, nextFinishMode || 'Rolls')
          }}
        >
          <ListSubheader>On Roll</ListSubheader>
          {rollOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
          <ListSubheader>In Carton</ListSubheader>
          {cartonOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </DefaultSelectField>
        {isTubeProduct ? (
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Tube products are always set up as rolls with continuous length.
          </Typography>
        ) : null}
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

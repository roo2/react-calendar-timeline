import type { ReactNode } from 'react'
import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'

export type ListFiltersCardProps = {
  /** Optional section title inside the card (e.g. "Match past orders"). */
  title?: string
  description?: ReactNode
  search: {
    label?: string
    placeholder?: string
    value: string
    onChange: (next: string) => void
  }
  /** Extra filter controls shown when `advancedOpen` is true. */
  advanced?: ReactNode
  advancedOpen?: boolean
  onToggleAdvanced?: () => void
  advancedShowLabel?: string
  advancedHideLabel?: string
  /** Total rows matching filters (server-side). */
  resultCount: number
  /** e.g. (n) => `${n.toLocaleString()} results` */
  formatResultCount?: (n: number) => string
  onClearFilters: () => void
  clearDisabled?: boolean
}

const defaultFormatCount = (n: number) => `${n.toLocaleString()} results`

/**
 * Standard filter strip: primary search, expandable advanced filters, result count, clear.
 */
export function ListFiltersCard({
  title,
  description,
  search,
  advanced,
  advancedOpen = false,
  onToggleAdvanced = () => {},
  advancedShowLabel = 'Show advanced filters',
  advancedHideLabel = 'Hide advanced filters',
  resultCount,
  formatResultCount = defaultFormatCount,
  onClearFilters,
  clearDisabled,
}: ListFiltersCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {title ? (
        <Typography variant="subtitle2" sx={{ mb: description ? 0.5 : 1.5 }}>
          {title}
        </Typography>
      ) : null}
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {description}
        </Typography>
      ) : null}
      <Stack spacing={2}>
        <TextField
          size="small"
          fullWidth
          label={search.label ?? 'Search'}
          placeholder={search.placeholder}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
        {advanced && advancedOpen ? <Box>{advanced}</Box> : null}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          {advanced && onToggleAdvanced ? (
            <Button
              variant="text"
              onClick={onToggleAdvanced}
              sx={{ p: 0, minWidth: 0, textTransform: 'none' }}
            >
              {advancedOpen ? advancedHideLabel : advancedShowLabel}
            </Button>
          ) : (
            <span />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {formatResultCount(resultCount)}
            </Typography>
            <Button variant="outlined" onClick={onClearFilters} disabled={clearDisabled}>
              Clear filters
            </Button>
          </Box>
        </Box>
      </Stack>
    </Paper>
  )
}

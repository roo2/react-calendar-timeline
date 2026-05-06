import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp'
import { Box, IconButton, TableCell, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'

export type UrlSortDir = '' | 'asc' | 'desc'

export type SortHeaderCellProps = {
  align?: 'left' | 'right' | 'center'
  children: ReactNode
  column: string
  sortBy: string
  sortDir: UrlSortDir
  onSort: (column: string, dir: 'asc' | 'desc') => void
  sx?: SxProps<Theme>
}

export function SortHeaderCell({
  align = 'left',
  children,
  column,
  sortBy,
  sortDir,
  onSort,
  sx,
}: SortHeaderCellProps) {
  const active = sortBy === column
  const upActive = active && sortDir === 'asc'
  const downActive = active && sortDir === 'desc'
  const justify = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'

  return (
    <TableCell align={align} sx={sx}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: justify, gap: 0.25, minHeight: 32 }}>
        <Typography component="span" variant="subtitle2" sx={{ lineHeight: 1.2 }}>
          {children}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', ml: 0.25 }}>
          <IconButton
            size="small"
            aria-label="Sort ascending"
            onClick={() => onSort(column, 'asc')}
            sx={{
              p: 0,
              minWidth: 0,
              width: 22,
              height: 16,
              color: upActive ? 'primary.main' : 'action.disabled',
            }}
          >
            <KeyboardArrowUp sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Sort descending"
            onClick={() => onSort(column, 'desc')}
            sx={{
              p: 0,
              minWidth: 0,
              width: 22,
              height: 16,
              mt: -0.5,
              color: downActive ? 'primary.main' : 'action.disabled',
            }}
          >
            <KeyboardArrowDown sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>
    </TableCell>
  )
}

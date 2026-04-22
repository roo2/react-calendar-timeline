import { Paper, TablePagination } from '@mui/material'

/** Fixed page size for all list views using this bar (MUI hides the selector when only one option). */
export const LIST_PAGE_SIZE = 100

export type ListPaginationBarProps = {
  total: number
  /** Zero-based page index (MUI TablePagination). */
  page: number
  onPageChange: (nextPageZeroBased: number) => void
}

/**
 * Bottom pagination bar consistent across list pages (100 rows per page, not user-editable).
 */
export function ListPaginationBar({ total, page, onPageChange }: ListPaginationBarProps) {
  const rowsPerPage = LIST_PAGE_SIZE
  const maxPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1)
  const safePage = Math.min(page, maxPage)

  return (
    <Paper variant="outlined">
      <TablePagination
        component="div"
        count={total}
        page={safePage}
        rowsPerPage={rowsPerPage}
        onPageChange={(_, next) => onPageChange(next)}
        rowsPerPageOptions={[rowsPerPage]}
      />
    </Paper>
  )
}

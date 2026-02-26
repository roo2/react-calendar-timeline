import { type ReactNode } from 'react'
import { Table } from '@mui/material'

export function AdminDataTable(props: { children: ReactNode }) {
  return (
    <Table size="small" sx={{ width: '100%' }}>
      {props.children}
    </Table>
  )
}


import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

export function ProductShowPage() {
  const { productId } = useParams()

  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = can(roles, 'PROD_MANAGER')

  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!productId) return
    void (async () => {
      try {
        setErr(null)
        const res = await apiFetch<any>(`/api/products/${productId}`)
        setData(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load product')
      }
    })()
  }, [productId])

  if (err) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Product</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
      </Stack>
    )
  }
  if (!data) return <p>Loading…</p>

  const product = data.product
  const versions = data.versions || []

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5">Product {product.code}</Typography>
          <Typography color="text.secondary" variant="body2">
            Customer: {product.customer_name || '-'} • Active Version: {product.active_version_id || '-'}
          </Typography>
        </Box>
        {isPm && (
          <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
            Create New Version
          </Button>
        )}
      </Box>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Version</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Created At</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((v: any) => (
              <TableRow key={v.id} hover>
                <TableCell>
                  <Typography fontWeight={600}>{v.version_number}</Typography>
                </TableCell>
                <TableCell>{v.created_by}</TableCell>
                <TableCell>{v.created_at}</TableCell>
                <TableCell>
                  <MuiLink component={Link} to={`/products/${productId}/versions/${v.id}`} underline="hover">
                    View
                  </MuiLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
      </Box>
    </Stack>
  )
}


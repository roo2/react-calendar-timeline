import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { computeProductDescriptionFromSpec } from '../../utils/productDescription'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { deleteProduct, fetchProduct } from '../../store/slices/productsSlice'
import { can } from '../../auth/permissions'
import { isRejectedWithValue } from '@reduxjs/toolkit'
import type { UpsertError } from '../../store/slices/productsSlice'
import { ApiError } from '../../api/client'
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
  const dispatch = useAppDispatch()
  const nav = useNavigate()

  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = can(roles, 'PROD_MANAGER')

  const entry = useAppSelector((s) => (productId ? s.products.detail.byId[productId] : undefined))
  const data = entry?.data
  const err = entry?.error

  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!productId) return
    void dispatch(fetchProduct(productId))
  }, [productId, dispatch])

  const usage = data?.usage as
    | { can_delete?: boolean; job_sheet_count?: number; order_count?: number }
    | undefined
  const canDelete = Boolean(isPm && productId && usage?.can_delete === true)

  async function onDeleteProduct() {
    if (!productId || !canDelete || deleting) return
    const code = data?.product?.code || 'this product'
    const ok = window.confirm(
      `Delete product "${code}" permanently? This removes all versions. This cannot be undone.`,
    )
    if (!ok) return
    setDeleteErr(null)
    setDeleting(true)
    try {
      await dispatch(deleteProduct(productId)).unwrap()
      nav('/products')
    } catch (e: unknown) {
      if (isRejectedWithValue(e)) {
        const p = e.payload as UpsertError
        setDeleteErr(p.message || 'Failed to delete product')
      } else if (e instanceof ApiError) {
        setDeleteErr(e.message || 'Failed to delete product')
      } else {
        setDeleteErr(e instanceof Error ? e.message : 'Failed to delete product')
      }
    } finally {
      setDeleting(false)
    }
  }

  if (err && !data && entry?.status === 'failed') {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Product</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to="/products" variant="text" color="primary">
          Back to Products
        </Button>
      </Stack>
    )
  }
  if (!data) return <p>Loading…</p>

  const product = data.product
  const versions = (data.versions || []).slice().sort((a: any, b: any) => Number(b?.version_number || 0) - Number(a?.version_number || 0))

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5">Product {product.code}</Typography>
          <Typography color="text.secondary" variant="body2">
            Customer: {product.customer_name || '-'} • Active Version: {product.active_version_id || '-'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {canDelete ? (
            <Button
              variant="outlined"
              color="error"
              disabled={deleting}
              onClick={() => void onDeleteProduct()}
            >
              {deleting ? 'Deleting…' : 'Delete product'}
            </Button>
          ) : null}
          {isPm ? (
            <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
              Create New Version
            </Button>
          ) : null}
        </Box>
      </Box>

      {deleteErr ? <Alert severity="error">{deleteErr}</Alert> : null}

      {isPm && usage && !usage.can_delete ? (
        <Alert severity="info">
          This product cannot be deleted because it is used on
          {Number(usage.job_sheet_count || 0) > 0
            ? ` ${usage.job_sheet_count} job sheet${Number(usage.job_sheet_count) !== 1 ? 's' : ''}`
            : ''}
          {Number(usage.job_sheet_count || 0) > 0 && Number(usage.order_count || 0) > 0 ? ' and' : ''}
          {Number(usage.order_count || 0) > 0
            ? ` ${usage.order_count} order${Number(usage.order_count) !== 1 ? 's' : ''}`
            : ''}
          .
        </Alert>
      ) : null}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Version</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Created At</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((v: any) => {
              const fromSpec = computeProductDescriptionFromSpec(v.spec_payload).trim()
              const fromApi = typeof v.description === 'string' ? v.description.trim() : ''
              const versionDescription = fromSpec || fromApi || '—'
              return (
                <TableRow key={v.id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{v.version_number}</Typography>
                  </TableCell>
                  <TableCell
                    sx={{
                      maxWidth: { xs: 280, sm: 420, md: 560 },
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                    }}
                  >
                    <Typography variant="body2" component="span">
                      {versionDescription}
                    </Typography>
                  </TableCell>
                  <TableCell>{v.created_by}</TableCell>
                  <TableCell>{v.created_at}</TableCell>
                  <TableCell>
                    <MuiLink component={Link} to={`/products/${productId}/versions/${v.id}`} underline="hover">
                      Edit
                    </MuiLink>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button component={Link} to="/products" variant="text" color="primary">
          Back to Products
        </Button>
      </Box>
    </Stack>
  )
}

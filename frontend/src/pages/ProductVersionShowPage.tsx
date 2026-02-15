import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { can } from '../auth/permissions'
import { ProductVersionSummary } from '../components/ProductVersionSummary'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from '@mui/material'

export function ProductVersionShowPage() {
  const { productId, versionId } = useParams()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const isPm = can(roles, 'PROD_MANAGER')

  const [productData, setProductData] = useState<any>(null)
  const [versionData, setVersionData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!productId || !versionId) return
    void (async () => {
      try {
        setErr(null)
        const [p, v] = await Promise.all([
          apiFetch<any>(`/api/products/${productId}`),
          apiFetch<any>(`/api/products/${productId}/versions/${versionId}`),
        ])
        setProductData(p)
        setVersionData(v)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load version')
      }
    })()
  }, [productId, versionId])

  const spec = useMemo(() => versionData?.version?.spec_payload || null, [versionData])

  if (err) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Product Version
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
        <Button component={Link} to={productId ? `/products/${productId}` : '/products'} variant="outlined">
          Back
        </Button>
      </Box>
    )
  }

  if (!productData || !versionData) return <p>Loading…</p>

  const product = productData.product
  const version = versionData.version
  const routing = versionData.routing || { operations: [], warnings: [] }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h5">
            Job Sheet: {product.code} — Version {version.version_number}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Customer: {product.customer_name || '-'} • Created by: {version.created_by} • Created at: {version.created_at || '-'}
          </Typography>
          {product.description ? (
            <Typography variant="body2" color="text.secondary">
              Description: {product.description}
            </Typography>
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {isPm && (
            <Button variant="contained" component={Link} to={`/products/${productId}/versions/new`}>
              Create New Version
            </Button>
          )}
          <Button variant="outlined" component={Link} to={`/products/${productId}`}>
            Previous Versions
          </Button>
          <Button
            variant="outlined"
            component={Link}
            to={`/products/${productId}/versions/${versionId}/print`}
            target="_blank"
            rel="noreferrer"
          >
            Print
          </Button>
        </Box>
      </Box>

      {!spec ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No spec payload found for this version.
        </Typography>
      ) : (
        <>
          <ProductVersionSummary spec={spec} />

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Required Operation Sequence
            </Typography>
            <Stack spacing={1}>
              {(routing.operations || []).map((op: any, idx: number) => (
                <Typography key={idx} variant="body2">
                  <strong>{op.operation_type}</strong>: {op.description}
                </Typography>
              ))}
            </Stack>

            {Array.isArray(routing.warnings) && routing.warnings.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Warnings
                </Typography>
                <Stack spacing={0.5}>
                  {routing.warnings.map((w: string, idx: number) => (
                    <Typography key={idx} variant="body2">
                      {w}
                    </Typography>
                  ))}
                </Stack>
              </Paper>
            ) : null}
          </Paper>
        </>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button component={Link} to={`/products/${productId}`} variant="outlined">
          Back to Product
        </Button>
        <Button component={Link} to="/products" variant="outlined">
          Back to Products
        </Button>
        <MuiLink component={Link} to={`/products/${productId}`} underline="hover" sx={{ alignSelf: 'center' }}>
          View product versions
        </MuiLink>
      </Box>
    </Stack>
  )
}


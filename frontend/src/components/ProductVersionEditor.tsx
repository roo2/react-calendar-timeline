import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from './SpecPayloadForm'
import { Box, Button, Link as MuiLink, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import { FormErrorAlert } from './FormErrorAlert'
import { clearNewVersionErrors, createProductVersion } from '../store/slices/productsSlice'
import { computeProductCodeFromSpec, computeProductDescriptionFromSpec } from '../utils/productDescription'
import { JobSheetPreviewPanel } from './JobSheetPreviewPanel'
import { StickySideAside } from './StickySideAside'

function ensureSpec(s: any): SpecPayload {
  const d = makeDefaultSpec()
  const src = s && typeof s === 'object' ? s : {}
  return {
    ...d,
    ...src,
    identity: { ...d.identity, ...(src.identity || {}) },
    dimensions: { ...d.dimensions, ...(src.dimensions || {}) },
    formulation: { ...d.formulation, ...(src.formulation || {}) },
    printing: { ...d.printing, ...(src.printing || {}) },
    quality_expectations: { ...d.quality_expectations, ...(src.quality_expectations || {}) },
    run_requirements: { ...d.run_requirements, ...(src.run_requirements || {}) },
    packaging: { ...d.packaging, ...(src.packaging || {}) },
    tool_requirements: Array.isArray(src.tool_requirements) ? src.tool_requirements : d.tool_requirements,
  }
}

export function ProductVersionEditor(props: {
  productId: string
  returnTo?: string | null
  onDone?: (versionId?: string) => void
  onCancel?: () => void
  title?: string
  submitLabel?: string
}) {
  const { productId, returnTo, onDone, onCancel, title, submitLabel } = props
  const nav = useNavigate()
  const dispatch = useAppDispatch()

  const [data, setData] = useState<any>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const upsert = useAppSelector((s) => s.products.newVersion)
  const err = upsert.error
  const errorSummary = upsert.messages
  const fieldErrors = upsert.fieldErrors
  const saving = upsert.status === 'loading'
  const { setDirty } = useUnsavedChanges()

  useEffect(() => {
    void dispatch(clearNewVersionErrors())
  }, [dispatch, productId])

  useEffect(() => {
    void (async () => {
      try {
        setLoadErr(null)
        const res = await apiFetch<any>(`/api/products/${encodeURIComponent(productId)}`)
        setData(res)

        const product = res.product
        const versions = res.versions || []
        const activeId = product?.active_version_id
        const active = activeId ? versions.find((v: any) => v.id === activeId) : null
        const latest = versions.slice().sort((a: any, b: any) => (b.version_number || 0) - (a.version_number || 0))[0]
        const srcSpec = (active?.spec_payload || latest?.spec_payload) ?? null
        setSpec(ensureSpec(srcSpec))
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : 'Failed to load product')
      }
    })()
  }, [productId])

  const canSubmit = useMemo(() => !!productId && !saving, [productId, saving])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const res = await dispatch(createProductVersion({ productId, spec })).unwrap()
      const vid = res?.versionId as string | undefined
      setDirty(false)
      if (onDone) {
        onDone(vid)
        return
      }
      if (returnTo) nav(returnTo)
      else if (vid) nav(`/products/${productId}/versions/${vid}`)
      else nav(`/products/${productId}`)
    } catch {
      // errors in slice
    }
  }

  const product = data?.product

  const previewDescription = useMemo(() => computeProductDescriptionFromSpec(spec), [spec])
  const previewProductCode = useMemo(() => computeProductCodeFromSpec(spec), [spec])
  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))

  if (loadErr && !data) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">{title || 'New Version'}</Typography>
        <FormErrorAlert error={loadErr} scrollOnShow={false} />
        {onCancel ? (
          <Button variant="text" color="primary" onClick={onCancel}>
            Back
          </Button>
        ) : (
          <Button component={Link} to={returnTo || (productId ? `/products/${productId}` : '/products')} variant="text" color="primary">
            Back
          </Button>
        )}
      </Stack>
    )
  }

  if (!data) return <p>Loading…</p>

  return (
    <Box onChange={() => setDirty(true)}>
      <Stack spacing={2}>
        <Typography variant="h5">{title || `Edit ${product?.code || ''}`.trim()}</Typography>

        <FormErrorAlert error={err} messages={errorSummary} scrollOnShow={true} scrollMarginTop={80} />

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0 }}>
            <Stack spacing={2}>
              {isNarrow ? (
                <JobSheetPreviewPanel
                  showJobFields={false}
                  productCode={previewProductCode}
                  description={previewDescription}
                />
              ) : null}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Product Spec
                </Typography>
                <MuiLink
                  component={Link}
                  to={`/products/${encodeURIComponent(productId)}`}
                  target="_blank"
                  rel="noreferrer"
                  underline="hover"
                  sx={{ fontSize: '0.875rem' }}
                >
                  View previous versions
                </MuiLink>
              </Box>
              <SpecPayloadForm
                value={spec}
                onChange={setSpec}
                fieldErrors={fieldErrors}
                customerId={product?.customer_id || undefined}
              />

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {onCancel ? (
                  <Button type="button" variant="text" color="primary" onClick={onCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button component={Link} to={returnTo || `/products/${productId}`} variant="text" color="primary">
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
                  {saving ? 'Saving…' : submitLabel || 'Save Changes'}
                </Button>
              </Box>
            </Stack>
          </form>

          {!isNarrow ? (
            <StickySideAside>
              <JobSheetPreviewPanel
                showJobFields={false}
                productCode={previewProductCode}
                description={previewDescription}
              />
            </StickySideAside>
          ) : null}
        </Box>
      </Stack>
    </Box>
  )
}


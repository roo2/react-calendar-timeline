import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'
import { Box, Button, Stack, Typography } from '@mui/material'
import { FormErrorAlert } from '../components/FormErrorAlert'
import { clearNewVersionErrors, createProductVersion } from '../store/slices/productsSlice'

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

export function ProductVersionNewPage() {
  const { productId } = useParams()
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()

  const qs0 = new URLSearchParams(loc.search)
  const returnTo = qs0.get('returnTo')

  const [data, setData] = useState<any>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [derived, setDerived] = useState<unknown>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const upsert = useAppSelector((s) => s.products.newVersion)
  const err = upsert.error
  const errorSummary = upsert.messages
  const fieldErrors = upsert.fieldErrors
  const saving = upsert.status === 'loading'

  useEffect(() => {
    if (!productId) return
    void (async () => {
      try {
        setLoadErr(null)
        const res = await apiFetch<any>(`/api/products/${productId}`)
        setData(res)

        const product = res.product
        const versions = res.versions || []
        const activeId = product?.active_version_id
        const active = activeId ? versions.find((v: any) => v.id === activeId) : null
        const latest = versions
          .slice()
          .sort((a: any, b: any) => (b.version_number || 0) - (a.version_number || 0))[0]
        const srcSpec = (active?.spec_payload || latest?.spec_payload) ?? null
        setSpec(ensureSpec(srcSpec))
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : 'Failed to load product')
      }
    })()
  }, [productId])

  const canSubmit = useMemo(() => !!productId && !saving, [productId, saving])

  useEffect(() => {
    dispatch(clearNewVersionErrors())
  }, [dispatch, productId])

  async function previewDerived() {
    try {
      const res = await apiFetch<{ derived: unknown }>('/api/products/preview/dimensions', {
        method: 'POST',
        body: JSON.stringify(spec),
      })
      setDerived(res.derived)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const res = await dispatch(
        createProductVersion({ productId: productId!, spec }),
      ).unwrap()
      const vid = res?.versionId
      if (returnTo) nav(returnTo)
      else if (vid) nav(`/products/${productId}/versions/${vid}`)
      else nav(`/products/${productId}`)
    } catch {
      // Errors are stored in the slice (including field-level validation).
    }
  }

  if (loadErr && !data) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">New Version</Typography>
        <FormErrorAlert error={loadErr} scrollOnShow={false} />
        <Button component={Link} to={returnTo || (productId ? `/products/${productId}` : '/products')} variant="outlined">
          Back
        </Button>
      </Stack>
    )
  }

  if (!data) return <p>Loading…</p>

  const product = data.product

  return (
    <Stack spacing={2}>
      <Typography variant="h5">New Version for {product.code}</Typography>

      <FormErrorAlert error={err} messages={errorSummary} scrollOnShow={true} scrollMarginTop={80} />

      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <SpecPayloadForm
            value={spec}
            onChange={setSpec}
            onPreviewDerived={previewDerived}
            derived={derived as any}
            fieldErrors={fieldErrors}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
              {saving ? 'Creating…' : 'Create New Version'}
            </Button>
            <Button component={Link} to={returnTo || `/products/${productId}`} variant="outlined">
              Cancel
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  )
}


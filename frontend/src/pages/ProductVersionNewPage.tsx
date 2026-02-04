import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAppSelector } from '../store/hooks'
import { makeDefaultSpec, SpecPayloadForm, type SpecPayload } from '../components/SpecPayloadForm'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'

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
  const csrfToken = useAppSelector((s) => s.auth.csrfToken)

  const [data, setData] = useState<any>(null)
  const [spec, setSpec] = useState<SpecPayload>(() => makeDefaultSpec())
  const [derived, setDerived] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!productId) return
    void (async () => {
      try {
        setErr(null)
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
        setErr(e instanceof Error ? e.message : 'Failed to load product')
      }
    })()
  }, [productId])

  const canSubmit = useMemo(() => !!productId && !saving, [productId, saving])

  async function previewDerived() {
    try {
      setErr(null)
      const res = await apiFetch<{ derived: unknown }>('/api/products/preview/dimensions', {
        method: 'POST',
        body: JSON.stringify(spec),
        csrfToken: csrfToken || undefined,
      })
      setDerived(res.derived)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to preview dimensions')
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      setSaving(true)
      setErr(null)
      const res = await apiFetch<any>(`/api/products/${productId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ spec }),
        csrfToken: csrfToken || undefined,
      })
      const vid = res?.version?.id
      if (vid) nav(`/products/${productId}/versions/${vid}`)
      else nav(`/products/${productId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create version')
    } finally {
      setSaving(false)
    }
  }

  if (err && !data) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">New Version</Typography>
        <Alert severity="error">{err}</Alert>
        <Button component={Link} to={productId ? `/products/${productId}` : '/products'} variant="outlined">
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

      {err && <Alert severity="error">{err}</Alert>}

      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <SpecPayloadForm value={spec} onChange={setSpec} onPreviewDerived={previewDerived} derived={derived as any} />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
              {saving ? 'Creating…' : 'Create New Version'}
            </Button>
            <Button component={Link} to={`/products/${productId}`} variant="outlined">
              Cancel
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  )
}


import { useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, List, ListItem, ListItemText, Typography } from '@mui/material'
import { ApiError, apiFetch, uploadPrintingArtworkPdf } from '../api/client'

export type PrintingArtworkScope =
  | { kind: 'job_sheet'; jobSheetId: string }
  | { kind: 'product_version'; productId: string; versionId: string }

export type PrintingArtworkFileRow = {
  id: string
  filename: string
  byte_size?: number | null
}

function uploadPath(scope: PrintingArtworkScope): string {
  if (scope.kind === 'job_sheet') {
    return `/api/job-sheets/${encodeURIComponent(scope.jobSheetId)}/printing-artwork`
  }
  return `/api/products/${encodeURIComponent(scope.productId)}/versions/${encodeURIComponent(scope.versionId)}/printing-artwork`
}

function downloadUrlPath(scope: PrintingArtworkScope, fileId: string): string {
  if (scope.kind === 'job_sheet') {
    return `/api/job-sheets/${encodeURIComponent(scope.jobSheetId)}/printing-artwork/${encodeURIComponent(fileId)}/download-url`
  }
  return `/api/products/${encodeURIComponent(scope.productId)}/versions/${encodeURIComponent(scope.versionId)}/printing-artwork/${encodeURIComponent(fileId)}/download-url`
}

function deletePath(scope: PrintingArtworkScope, fileId: string): string {
  if (scope.kind === 'job_sheet') {
    return `/api/job-sheets/${encodeURIComponent(scope.jobSheetId)}/printing-artwork/${encodeURIComponent(fileId)}`
  }
  return `/api/products/${encodeURIComponent(scope.productId)}/versions/${encodeURIComponent(scope.versionId)}/printing-artwork/${encodeURIComponent(fileId)}`
}

export function PrintingArtworkUploadSection(props: {
  scope: PrintingArtworkScope | null | undefined
  disabled?: boolean
  files: PrintingArtworkFileRow[]
  onChangeFiles: (next: PrintingArtworkFileRow[]) => void
}) {
  const { scope, disabled, files, onChangeFiles } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!scope) {
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          Artwork (PDF)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Save the job sheet (or use a saved product version) before attaching artwork PDFs.
        </Typography>
      </Box>
    )
  }

  async function onPickFile(f: File | null) {
    setMsg(null)
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setMsg('Please choose a PDF file.')
      return
    }
    setBusy(true)
    try {
      const res = await uploadPrintingArtworkPdf(uploadPath(scope), f)
      const row = res?.file
      if (!row?.id || !row?.filename) throw new Error('Unexpected response from server')
      onChangeFiles([...(files || []), { id: row.id, filename: row.filename, byte_size: row.byte_size ?? null }])
    } catch (e: unknown) {
      if (e instanceof ApiError) setMsg(e.message)
      else setMsg(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function onOpen(fileId: string) {
    setMsg(null)
    try {
      const res = await apiFetch<{ url: string }>(downloadUrlPath(scope, fileId))
      if (!res?.url) throw new Error('No download URL returned')
      window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e: unknown) {
      if (e instanceof ApiError) setMsg(e.message)
      else setMsg(e instanceof Error ? e.message : 'Failed to get download link')
    }
  }

  async function onRemove(fileId: string) {
    setMsg(null)
    setBusy(true)
    try {
      await apiFetch<void>(deletePath(scope, fileId), { method: 'DELETE' })
      onChangeFiles((files || []).filter((x) => x.id !== fileId))
    } catch (e: unknown) {
      if (e instanceof ApiError) setMsg(e.message)
      else setMsg(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        Artwork (PDF)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Files are stored in S3. Save the spec (job sheet or product version) so attachment metadata is persisted.
      </Typography>

      {msg ? (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setMsg(null)}>
          {msg}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
        />
        <Button type="button" variant="outlined" size="small" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          Upload PDF…
        </Button>
        {busy ? <LinearProgress sx={{ flex: 1, minWidth: 120 }} /> : null}
      </Box>

      {Array.isArray(files) && files.length > 0 ? (
        <List dense sx={{ mt: 1 }}>
          {files.map((f) => (
            <ListItem
              key={f.id}
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button size="small" variant="text" disabled={busy} onClick={() => void onOpen(f.id)}>
                    Open
                  </Button>
                  <Button size="small" color="error" variant="text" disabled={busy} onClick={() => void onRemove(f.id)}>
                    Remove
                  </Button>
                </Box>
              }
            >
              <ListItemText
                primary={f.filename}
                secondary={f.byte_size != null ? `${Math.round(Number(f.byte_size) / 1024)} KB` : undefined}
              />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No artwork uploaded yet.
        </Typography>
      )}
    </Box>
  )
}

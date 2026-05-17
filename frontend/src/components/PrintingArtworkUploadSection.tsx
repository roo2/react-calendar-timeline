import { useRef, useState, type DragEvent } from 'react'
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

function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
}

function pdfFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt?.files?.length) return []
  return Array.from(dt.files).filter(isPdfFile)
}

export function PrintingArtworkUploadSection(props: {
  scope: PrintingArtworkScope | null | undefined
  disabled?: boolean
  files: PrintingArtworkFileRow[]
  onChangeFiles: (next: PrintingArtworkFileRow[]) => void
}) {
  const { scope, disabled, files, onChangeFiles } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

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
  const activeScope: PrintingArtworkScope = scope
  const dropDisabled = Boolean(disabled) || busy

  async function uploadOne(f: File, accumulated: PrintingArtworkFileRow[]): Promise<PrintingArtworkFileRow[]> {
    const res = await uploadPrintingArtworkPdf(uploadPath(activeScope), f)
    const row = res?.file
    if (!row?.id || !row?.filename) throw new Error('Unexpected response from server')
    return [...accumulated, { id: row.id, filename: row.filename, byte_size: row.byte_size ?? null }]
  }

  async function uploadFiles(incoming: File[], opts?: { skippedNonPdf?: number }) {
    setMsg(null)
    if (!incoming.length) {
      setMsg('Please drop PDF files only.')
      return
    }
    setBusy(true)
    let accumulated = [...(files || [])]
    let uploadErr: string | null = null
    try {
      for (const f of incoming) {
        accumulated = await uploadOne(f, accumulated)
        onChangeFiles(accumulated)
      }
    } catch (e: unknown) {
      uploadErr = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Upload failed'
      setMsg(uploadErr)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
      const skipped = opts?.skippedNonPdf ?? 0
      if (!uploadErr && skipped > 0) {
        setMsg(`Skipped ${skipped} non-PDF file(s).`)
      }
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (dropDisabled) return
    dragDepthRef.current += 1
    setDragOver(true)
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (dropDisabled) return
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setDragOver(false)
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (dropDisabled) return
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setDragOver(false)
    if (dropDisabled) return
    const pdfs = pdfFilesFromDataTransfer(e.dataTransfer)
    const skipped = (e.dataTransfer.files?.length ?? 0) - pdfs.length
    void uploadFiles(pdfs, { skippedNonPdf: skipped > 0 ? skipped : undefined })
  }

  function openFilePicker() {
    if (dropDisabled) return
    inputRef.current?.click()
  }

  async function onOpen(fileId: string) {
    setMsg(null)
    try {
      const res = await apiFetch<{ url: string }>(downloadUrlPath(activeScope, fileId))
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
      await apiFetch<void>(deletePath(activeScope, fileId), { method: 'DELETE' })
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

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const list = e.target.files
          if (!list?.length) return
          const picked = Array.from(list)
          const pdfs = picked.filter(isPdfFile)
          const skipped = picked.length - pdfs.length
          void uploadFiles(pdfs, { skippedNonPdf: skipped > 0 ? skipped : undefined })
        }}
      />

      <Box
        role="button"
        tabIndex={dropDisabled ? -1 : 0}
        aria-disabled={dropDisabled}
        aria-label="Upload artwork PDFs by drag and drop or file browse"
        onKeyDown={(e) => {
          if (dropDisabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openFilePicker()
          }
        }}
        onClick={openFilePicker}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          border: '2px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          borderRadius: 1,
          p: 2,
          textAlign: 'center',
          bgcolor: dragOver ? 'action.selected' : 'action.hover',
          cursor: dropDisabled ? 'not-allowed' : 'pointer',
          opacity: dropDisabled ? 0.65 : 1,
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
          outline: dragOver ? (t) => `2px solid ${t.palette.primary.main}` : 'none',
          outlineOffset: 2,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: dragOver ? 600 : 500, mb: 0.5 }}>
          {dragOver ? 'Drop PDFs here' : 'Drag and drop PDFs here'}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          or click to browse — multiple files allowed
        </Typography>
        {busy ? <LinearProgress sx={{ mt: 1.5 }} /> : null}
      </Box>

      {Array.isArray(files) && files.length > 0 ? (
        <List dense sx={{ mt: 1 }}>
          {files.map((f) => (
            <ListItem
              key={f.id}
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button
                    size="small"
                    variant="text"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      void onOpen(f.id)
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      void onRemove(f.id)
                    }}
                  >
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

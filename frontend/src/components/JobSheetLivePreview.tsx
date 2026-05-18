import type { ReactElement } from 'react'
import { JobSheetPreviewPanel } from './JobSheetPreviewPanel'
import { StickySideAside } from './StickySideAside'
import type { JobSheetLivePreviewPanelProps } from '../hooks/useJobSheetLivePreviewProps'

export type JobSheetLivePreviewProps = {
  panelProps: JobSheetLivePreviewPanelProps
  /** When true, wrap in {@link StickySideAside} (desktop job sheet / order modal layout). */
  wrapInAside?: boolean
}

/**
 * Live job sheet sidebar preview — renders {@link JobSheetPreviewPanel} with props from
 * {@link useJobSheetLivePreviewProps} in the parent editor.
 */
export function JobSheetLivePreview(props: JobSheetLivePreviewProps): ReactElement {
  const { panelProps, wrapInAside = false } = props
  const panel = <JobSheetPreviewPanel {...panelProps} />
  return wrapInAside ? <StickySideAside>{panel}</StickySideAside> : panel
}

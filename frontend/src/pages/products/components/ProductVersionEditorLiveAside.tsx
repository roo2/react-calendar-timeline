import { JobSheetLivePreview } from '../../../components/JobSheetLivePreview'
import { useJobSheetLivePreviewProps, type UseJobSheetLivePreviewParams } from '../../../hooks/useJobSheetLivePreviewProps'

/** Sidebar preview — isolated so standalone product editors do not run preview hooks until needed. */
export function ProductVersionEditorLiveAside(props: UseJobSheetLivePreviewParams) {
  const panelProps = useJobSheetLivePreviewProps(props)
  return <JobSheetLivePreview panelProps={panelProps} wrapInAside />
}

import { useLocation, useParams } from 'react-router-dom'
import { ProductVersionEditor } from './components/ProductVersionEditor'

export function ProductVersionEditPage() {
  const { productId, versionId } = useParams()
  const loc = useLocation()

  const returnTo = new URLSearchParams(loc.search).get('returnTo')
  if (!productId || !versionId) return <p>Missing product or version id.</p>

  return (
    <ProductVersionEditor
      productId={productId}
      versionId={versionId}
      returnTo={returnTo}
    />
  )
}

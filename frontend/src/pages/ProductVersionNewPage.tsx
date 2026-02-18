import { useLocation, useParams } from 'react-router-dom'
import { ProductVersionEditor } from '../components/ProductVersionEditor'

export function ProductVersionNewPage() {
  const { productId } = useParams()
  const loc = useLocation()

  const qs0 = new URLSearchParams(loc.search)
  const returnTo = qs0.get('returnTo')
  if (!productId) return <p>Missing product id.</p>
  return <ProductVersionEditor productId={productId} returnTo={returnTo} />
}


type DeliveryAddressRow = {
  label?: string | null
  type?: string | null
  street1?: string | null
  street2?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  delivery_instructions?: string | null
  is_default?: boolean | null
}

function addressHasContent(addr: DeliveryAddressRow): boolean {
  return Boolean(
    String(addr.street1 || '').trim() ||
      String(addr.street2 || '').trim() ||
      String(addr.suburb || '').trim() ||
      String(addr.state || '').trim() ||
      String(addr.postcode || '').trim() ||
      String(addr.country || '').trim(),
  )
}

export function pickDefaultDeliveryAddress(
  addresses: DeliveryAddressRow[] | null | undefined,
): DeliveryAddressRow | null {
  const rows = Array.isArray(addresses) ? addresses : []
  const candidates = rows.filter((a) => {
    const t = String(a.type || '').trim()
    return t === 'Delivery' || t === 'Both' || t === ''
  })
  const pool = candidates.length > 0 ? candidates : rows
  return pool.find((a) => a.is_default && addressHasContent(a)) || pool.find((a) => addressHasContent(a)) || null
}

export function formatDeliveryAddressDisplay(addr: DeliveryAddressRow | null | undefined): string | null {
  if (!addr || !addressHasContent(addr)) return null
  const lines: string[] = []
  const street = [addr.street1, addr.street2].map((p) => String(p || '').trim()).filter(Boolean).join('\n')
  if (street) lines.push(street)
  const locality = [addr.suburb, addr.state, addr.postcode]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ')
  if (locality) lines.push(locality)
  const country = String(addr.country || '').trim()
  if (country) lines.push(country)
  const contactName = String(addr.contact_name || '').trim()
  const contactPhone = String(addr.contact_phone || '').trim()
  if (contactName || contactPhone) {
    lines.push(`Contact: ${[contactName, contactPhone].filter(Boolean).join(' — ')}`)
  }
  const instructions = String(addr.delivery_instructions || '').trim()
  if (instructions) lines.push(`Instructions: ${instructions}`)
  const label = String(addr.label || '').trim()
  if (label && lines.length > 0) return `${label}\n${lines.join('\n')}`
  return lines.length > 0 ? lines.join('\n') : null
}

export function formatDefaultDeliveryAddress(
  addresses: DeliveryAddressRow[] | null | undefined,
): string | null {
  return formatDeliveryAddressDisplay(pickDefaultDeliveryAddress(addresses))
}

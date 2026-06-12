type DeliveryAddressRow = {
  address_type?: string | null
  address_line1?: string | null
  address_line2?: string | null
  address_line3?: string | null
  address_line4?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country?: string | null
  attention_to?: string | null
}

function addressHasContent(addr: DeliveryAddressRow): boolean {
  return Boolean(
    String(addr.address_line1 || '').trim() ||
      String(addr.address_line2 || '').trim() ||
      String(addr.address_line3 || '').trim() ||
      String(addr.address_line4 || '').trim() ||
      String(addr.city || '').trim() ||
      String(addr.region || '').trim() ||
      String(addr.postal_code || '').trim() ||
      String(addr.country || '').trim() ||
      String(addr.attention_to || '').trim(),
  )
}

export function pickDefaultDeliveryAddress(
  addresses: DeliveryAddressRow[] | null | undefined,
): DeliveryAddressRow | null {
  const rows = Array.isArray(addresses) ? addresses : []
  const usable = rows.filter((a) => addressHasContent(a))
  if (usable.length === 0) return null
  for (const preferred of ['STREET', 'DELIVERY', 'POBOX']) {
    const match = usable.find((a) => String(a.address_type || '').toUpperCase() === preferred)
    if (match) return match
  }
  return usable[0]
}

export function formatDeliveryAddressDisplay(addr: DeliveryAddressRow | null | undefined): string | null {
  if (!addr || !addressHasContent(addr)) return null
  const lines: string[] = []
  for (const key of ['address_line1', 'address_line2', 'address_line3', 'address_line4'] as const) {
    const value = String(addr[key] || '').trim()
    if (value) lines.push(value)
  }
  const locality = [addr.city, addr.region, addr.postal_code]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ')
  if (locality) lines.push(locality)
  const country = String(addr.country || '').trim()
  if (country) lines.push(country)
  const attention = String(addr.attention_to || '').trim()
  if (attention) lines.push(`Attention: ${attention}`)
  return lines.length > 0 ? lines.join('\n') : null
}

export function formatDefaultDeliveryAddress(
  addresses: DeliveryAddressRow[] | null | undefined,
): string | null {
  return formatDeliveryAddressDisplay(pickDefaultDeliveryAddress(addresses))
}

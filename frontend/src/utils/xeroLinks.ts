/** Open a Xero contact profile in the web app (user must be logged into Xero). */
export function xeroContactViewUrl(contactId: string): string {
  const id = String(contactId || '').trim()
  return `https://go.xero.com/Contacts/View/${encodeURIComponent(id)}`
}

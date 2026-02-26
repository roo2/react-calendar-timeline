export function confirmDelete(label: string) {
  return window.confirm(`Delete ${label}? This cannot be undone.`)
}


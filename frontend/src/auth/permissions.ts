export function isSysAdmin(roles: readonly string[]): boolean {
  return roles.includes('SYS_ADMIN')
}

export function hasAnyRole(roles: readonly string[], ...allowed: readonly string[]): boolean {
  return allowed.some((r) => roles.includes(r))
}

/**
 * Standard permission helper:
 * - SYS_ADMIN can do everything
 * - otherwise require at least one of the allowed roles
 */
export function can(roles: readonly string[], ...allowed: readonly string[]): boolean {
  return isSysAdmin(roles) || hasAnyRole(roles, ...allowed)
}


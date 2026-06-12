import type { UserManager } from 'oidc-client-ts'

export function hasWebCallbackParams(): boolean {
  const search = new URLSearchParams(window.location.search)
  return search.has('code') && search.has('state')
}

export async function handleWebCallback(userManager: UserManager): Promise<void> {
  if (hasWebCallbackParams()) {
    await userManager.signinRedirectCallback()
    window.history.replaceState({}, document.title, window.location.pathname)
  }
}

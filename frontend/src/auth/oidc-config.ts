import type { UserManagerSettings } from 'oidc-client-ts'
import { isNativeApp } from './platform'
import { createOidcUserStore } from './storage'

function env(key: string, legacyKey?: string): string | undefined {
  const envRecord = import.meta.env as Record<string, string | undefined>
  return envRecord[key] ?? (legacyKey ? envRecord[legacyKey] : undefined)
}

export function getOidcRedirectUri(): string | null {
  const configured = env('VITE_AUTHENTIK_OIDC_APP_ORIGIN')?.trim()
  if (configured) return configured
  if (typeof window !== 'undefined' && !isNativeApp()) {
    return window.location.origin
  }
  return null
}

export function isOidcConfigured(): boolean {
  const authority = env('VITE_AUTHENTIK_OIDC_ISSUER', 'VITE_AUTHENTIK_ISSUER')
  const clientId = env('VITE_AUTHENTIK_OIDC_CLIENT_ID', 'VITE_AUTHENTIK_CLIENT_ID')
  const redirectUri = getOidcRedirectUri()
  return Boolean(authority && clientId && redirectUri)
}

export function buildUserManagerSettings(): UserManagerSettings | null {
  const authority = env('VITE_AUTHENTIK_OIDC_ISSUER', 'VITE_AUTHENTIK_ISSUER')
  const clientId = env('VITE_AUTHENTIK_OIDC_CLIENT_ID', 'VITE_AUTHENTIK_CLIENT_ID')
  const redirectUri = getOidcRedirectUri()
  if (!authority || !clientId || !redirectUri) return null

  const postLogoutRedirectUri =
    env('VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI', 'VITE_AUTHENTIK_POST_LOGOUT_REDIRECT_URI') ??
    redirectUri

  const scope =
    env('VITE_AUTHENTIK_OIDC_SCOPE', 'VITE_AUTHENTIK_SCOPE') ??
    (isNativeApp() ? 'openid profile email phone offline_access' : 'openid profile email phone')

  return {
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    response_type: 'code',
    scope,
    userStore: createOidcUserStore(),
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
  }
}

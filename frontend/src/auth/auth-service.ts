import { UserManager } from 'oidc-client-ts'
import { isNativeApp } from './platform'
import { buildUserManagerSettings } from './oidc-config'
import { createNativeRedirectNavigator, registerNativeDeepLinkHandler } from './auth-native'
import { handleWebCallback } from './auth-web'

type AuthListener = (token: string | null) => void

let userManager: UserManager | null = null
let initPromise: Promise<UserManager | null> | null = null
const listeners = new Set<AuthListener>()

function notify(token: string | null) {
  for (const listener of listeners) {
    listener(token)
  }
}

export function onAccessTokenChange(listener: AuthListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUserManager(): UserManager | null {
  return userManager
}

export async function initAuthService(
  onError: (message: string) => void,
): Promise<UserManager | null> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    const settings = buildUserManagerSettings()
    if (!settings) return null

    userManager = isNativeApp()
      ? new UserManager(settings, createNativeRedirectNavigator())
      : new UserManager(settings)

    userManager.events.addUserLoaded((user) => {
      notify(user.access_token ?? null)
    })
    userManager.events.addUserUnloaded(() => {
      notify(null)
    })
    userManager.events.addAccessTokenExpired(() => {
      void refreshAccessToken().catch(() => notify(null))
    })
    userManager.events.addSilentRenewError(() => {
      notify(null)
    })

    if (isNativeApp()) {
      registerNativeDeepLinkHandler(
        userManager,
        () => {
          void syncAccessToken()
        },
        () => {
          notify(null)
        },
        onError,
      )
    } else {
      try {
        await handleWebCallback(userManager)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'OIDC Anmeldung fehlgeschlagen')
      }
    }

    await syncAccessToken()
    return userManager
  })()

  return initPromise
}

async function syncAccessToken(): Promise<string | null> {
  if (!userManager) return null
  const user = await userManager.getUser()
  const token = user?.access_token ?? null
  notify(token)
  return token
}

export async function getAccessToken(): Promise<string | null> {
  if (!userManager) return null
  const user = await userManager.getUser()
  if (!user) return null
  if (user.expired) {
    return refreshAccessToken()
  }
  return user.access_token ?? null
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!userManager) return null
  try {
    const user = await userManager.signinSilent()
    const token = user?.access_token ?? null
    notify(token)
    return token
  } catch {
    notify(null)
    return null
  }
}

export async function login(): Promise<void> {
  if (!userManager) throw new Error('OIDC nicht konfiguriert')
  await userManager.signinRedirect()
}

export async function logout(): Promise<void> {
  if (!userManager) return
  await userManager.removeUser()
  notify(null)
  if (isNativeApp()) {
    try {
      await userManager.signoutRedirect()
    } catch {
      // Local session cleared even if browser logout fails.
    }
    return
  }
  await userManager.signoutRedirect()
}

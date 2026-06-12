import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { INavigator, IWindow, NavigateParams, NavigateResponse, UserManager } from 'oidc-client-ts'

const CALLBACK_PATH = '/oauth/callback'
const LOGOUT_PATH = '/oauth/logout'

export function isOAuthCallbackUrl(url: string): boolean {
  return url.includes(CALLBACK_PATH) && url.includes('code=')
}

export function isOAuthLogoutUrl(url: string): boolean {
  return url.includes(LOGOUT_PATH)
}

export function createNativeRedirectNavigator(): INavigator {
  return {
    async prepare(): Promise<IWindow> {
      return {
        navigate: async (params: NavigateParams): Promise<NavigateResponse> => {
          await Browser.open({ url: params.url, windowName: '_self' })
          return { url: params.url }
        },
        close: () => {
          void Browser.close()
        },
      }
    },
    async callback() {
      return
    },
  }
}

let deepLinkListenerRegistered = false

export function registerNativeDeepLinkHandler(
  userManager: UserManager,
  onAuthenticated: () => void,
  onLogout: () => void,
  onError: (message: string) => void,
): void {
  if (deepLinkListenerRegistered) return
  deepLinkListenerRegistered = true

  void App.addListener('appUrlOpen', (event) => {
    void (async () => {
      const { url } = event
      try {
        if (isOAuthCallbackUrl(url)) {
          await Browser.close()
          await userManager.signinRedirectCallback(url)
          onAuthenticated()
          return
        }
        if (isOAuthLogoutUrl(url)) {
          await Browser.close()
          await userManager.removeUser()
          onLogout()
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : 'OIDC Anmeldung fehlgeschlagen')
      }
    })()
  })
}

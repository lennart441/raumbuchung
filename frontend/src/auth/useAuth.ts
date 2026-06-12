import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { getApiBaseUrl } from '../api-base'
import { isOidcConfigured } from './oidc-config'
import { isNativeApp } from './platform'
import {
  initAuthService,
  login as oidcLogin,
  logout as oidcLogout,
  onAccessTokenChange,
} from './auth-service'

function viteDevFallback(): boolean {
  const v = (import.meta.env.VITE_DEV as string | undefined)?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export type DevRole = 'USER' | 'EXTENDED_USER' | 'ADMIN'

export function useAuth() {
  const [authDev, setAuthDev] = useState<boolean | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [oidcToken, setOidcToken] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [devRolePickerOpen, setDevRolePickerOpen] = useState(false)
  const [isDevLoggedIn, setIsDevLoggedIn] = useState(false)
  const [devRole, setDevRole] = useState<DevRole>('USER')
  const [bootstrapDone, setBootstrapDone] = useState(false)

  const nativeApp = isNativeApp()
  const isOidcMode = nativeApp ? true : authDev === false
  const oidcConfigured = isOidcMode && isOidcConfigured()
  const devLoginAllowed = !nativeApp && authDev === true

  const loadAuthConfig = useCallback(() => {
    const base = getApiBaseUrl()
    void axios
      .get<{ dev: boolean }>(`${base}/auth/config`)
      .then((res) => {
        setConfigError(null)
        if (nativeApp && res.data.dev) {
          setAuthDev(false)
          setConfigError(
            'Das Backend laeuft im Entwicklungsmodus. Die App benoetigt Authentik (DEV=false) auf dem Server.',
          )
          return
        }
        setAuthDev(res.data.dev)
      })
      .catch(() => {
        if (nativeApp) {
          setAuthDev(false)
          setConfigError(`API nicht erreichbar (${base}/auth/config). Netzwerk und VITE_MOBILE_API_URL pruefen.`)
          return
        }
        setConfigError(null)
        setAuthDev(viteDevFallback())
      })
  }, [nativeApp])

  useEffect(() => {
    void Promise.resolve().then(() => loadAuthConfig())
  }, [loadAuthConfig])

  useEffect(() => {
    if (authDev === null) return

    const finishBootstrap = () => {
      setBootstrapDone(true)
    }

    if (!isOidcMode || !oidcConfigured) {
      void Promise.resolve().then(finishBootstrap)
      return
    }

    void initAuthService((message) => setAuthError(message)).then(finishBootstrap)
  }, [authDev, isOidcMode, oidcConfigured])

  useEffect(() => {
    if (!isOidcMode || !oidcConfigured) return
    return onAccessTokenChange(setOidcToken)
  }, [isOidcMode, oidcConfigured])

  const isLoggedIn = isOidcMode ? Boolean(oidcToken) : isDevLoggedIn

  const authHeaders = useMemo((): Record<string, string> => {
    if (isOidcMode && oidcToken) return { authorization: `Bearer ${oidcToken}` }
    if (devLoginAllowed && isDevLoggedIn) return { 'x-dev-role': devRole }
    return {}
  }, [devLoginAllowed, devRole, isDevLoggedIn, isOidcMode, oidcToken])

  const handleLogin = useCallback(async () => {
    if (isOidcMode) {
      if (!oidcConfigured) return
      setAuthError(null)
      await oidcLogin()
      return
    }
    setDevRolePickerOpen(true)
  }, [isOidcMode, oidcConfigured])

  const handleDevRoleChoice = useCallback((role: DevRole) => {
    setDevRole(role)
    setIsDevLoggedIn(true)
    setDevRolePickerOpen(false)
  }, [])

  const handleLogout = useCallback(async () => {
    if (isOidcMode && oidcConfigured) {
      setOidcToken(null)
      await oidcLogout()
      return
    }
    setDevRolePickerOpen(false)
    setIsDevLoggedIn(false)
  }, [isOidcMode, oidcConfigured])

  const loading = authDev === null || !bootstrapDone

  return {
    authError: authError ?? configError,
    authHeaders,
    configError,
    devRole,
    devRolePickerOpen,
    devLoginAllowed,
    handleDevRoleChoice,
    handleLogin,
    handleLogout,
    isLoggedIn,
    isOidcMode,
    loading,
    oidcConfigured,
    reloadAuthConfig: loadAuthConfig,
    setDevRolePickerOpen,
  }
}

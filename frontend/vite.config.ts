import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveApiBaseFromEnv } from './src/api-base'

const AUTHENTIK_ENV_MAP: Record<string, string> = {
  AUTHENTIK_OIDC_ISSUER: 'VITE_AUTHENTIK_OIDC_ISSUER',
  AUTHENTIK_OIDC_CLIENT_ID: 'VITE_AUTHENTIK_OIDC_CLIENT_ID',
  AUTHENTIK_OIDC_APP_ORIGIN: 'VITE_AUTHENTIK_OIDC_APP_ORIGIN',
  AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI: 'VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI',
  AUTHENTIK_OIDC_SCOPE: 'VITE_AUTHENTIK_OIDC_SCOPE',
}

const MOBILE_OIDC_DEFAULTS: Record<string, string> = {
  VITE_AUTHENTIK_OIDC_APP_ORIGIN: 'de.stocksee.raumbuchung://oauth/callback',
  VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI: 'de.stocksee.raumbuchung://oauth/logout',
  VITE_AUTHENTIK_OIDC_SCOPE: 'openid profile email phone offline_access',
  VITE_API_URL: 'https://raum.stocksee.de/api',
  VITE_DEV: 'false',
}

function enrichEnvForVite(mode: string, merged: Record<string, string>): Record<string, string> {
  const env = { ...merged }

  for (const [backendKey, viteKey] of Object.entries(AUTHENTIK_ENV_MAP)) {
    if (!env[viteKey]?.trim() && env[backendKey]?.trim()) {
      env[viteKey] = env[backendKey].trim()
    }
  }

  if (mode === 'mobile') {
    for (const [key, value] of Object.entries(MOBILE_OIDC_DEFAULTS)) {
      if (!env[key]?.trim()) {
        env[key] = value
      }
    }
    // Web-Redirect (https://raum.stocksee.de) gilt nicht fuer die native App.
    if (env.VITE_AUTHENTIK_OIDC_APP_ORIGIN?.startsWith('http')) {
      env.VITE_AUTHENTIK_OIDC_APP_ORIGIN = MOBILE_OIDC_DEFAULTS.VITE_AUTHENTIK_OIDC_APP_ORIGIN
    }
    if (env.VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI?.startsWith('http')) {
      env.VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI =
        MOBILE_OIDC_DEFAULTS.VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI
    }
  }

  return env
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '..')
  const merged = enrichEnvForVite(mode, {
    ...loadEnv(mode, repoRoot, ''),
    ...loadEnv(mode, __dirname, ''),
  })

  const define: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (k.startsWith('VITE_')) {
      define[`import.meta.env.${k}`] = JSON.stringify(v)
    }
  }

  const apiBase = resolveApiBaseFromEnv(merged)
  const backendProxy = (merged.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
  const useDevProxy =
    mode === 'development' && apiBase === '/api'
  const hmrClientPort = merged.VITE_HMR_CLIENT_PORT
    ? Number(merged.VITE_HMR_CLIENT_PORT)
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    define,
    server: {
      host: '0.0.0.0',
      port: 5173,
      ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
      ...(useDevProxy
        ? {
            proxy: {
              '/api': {
                target: backendProxy,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  }
})

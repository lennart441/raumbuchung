import { Capacitor } from '@capacitor/core'

type EnvRecord = Record<string, string | boolean | undefined>

const NATIVE_PRODUCTION_API_DEFAULT = 'https://raum.stocksee.de/api'

/**
 * Gleiche Logik wie im Browser (`import.meta.env`), auch fuer vite.config.ts (merged .env).
 */
export function resolveApiBaseFromEnv(env: EnvRecord): string {
  const fromApi = String(env.VITE_API_URL ?? '').trim()
  if (fromApi) return fromApi.replace(/\/$/, '')
  const origin = String(env.VITE_BACKEND_ORIGIN ?? '').trim()
  if (origin) return `${origin.replace(/\/$/, '')}/api`
  return '/api'
}

function resolveNativeApiBase(env: EnvRecord, webBase: string): string {
  const mobileOverride = String(env.VITE_MOBILE_API_URL ?? '').trim()
  if (mobileOverride) return mobileOverride.replace(/\/$/, '')

  if (webBase.startsWith('http://') || webBase.startsWith('https://')) {
    return webBase
  }

  return NATIVE_PRODUCTION_API_DEFAULT
}

/**
 * Basis-URL aller API-Aufrufe (ohne trailing slash).
 *
 * - `VITE_API_URL`: volle Basis, z. B. `http://localhost:3000/api` oder `/api` (Proxy/nginx)
 * - `VITE_BACKEND_ORIGIN`: nur Origin, z. B. `http://localhost:3000` → es wird `/api` angehaengt
 * - Native App: relative `/api` wird zu `VITE_MOBILE_API_URL` oder Production-Default aufgeloest
 */
export function getApiBaseUrl(): string {
  const env = (import.meta as unknown as { env: EnvRecord }).env
  const webBase = resolveApiBaseFromEnv(env)
  if (Capacitor.isNativePlatform()) {
    return resolveNativeApiBase(env, webBase)
  }
  return webBase
}

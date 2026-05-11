type EnvRecord = Record<string, string | boolean | undefined>

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

/**
 * Basis-URL aller API-Aufrufe (ohne trailing slash).
 *
 * - `VITE_API_URL`: volle Basis, z. B. `http://localhost:3000/api` oder `/api` (Proxy/nginx)
 * - `VITE_BACKEND_ORIGIN`: nur Origin, z. B. `http://localhost:3000` → es wird `/api` angehaengt
 */
export function getApiBaseUrl(): string {
  const env = (import.meta as unknown as { env: EnvRecord }).env
  return resolveApiBaseFromEnv(env)
}

import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveApiBaseFromEnv } from './src/api-base'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '..')
  const merged = { ...loadEnv(mode, repoRoot, ''), ...loadEnv(mode, __dirname, '') }

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

  return {
    plugins: [react(), tailwindcss()],
    define,
    server: useDevProxy
      ? {
          proxy: {
            '/api': {
              target: backendProxy,
              changeOrigin: true,
            },
          },
        }
      : {},
  }
})

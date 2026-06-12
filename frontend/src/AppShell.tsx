import type { ReactNode } from 'react'

type AppShellProps = {
  children: ReactNode
  apiError?: string | null
  apiLoading?: boolean
  onRetry?: () => void
}

export function AppShell({ children, apiError, apiLoading, onRetry }: AppShellProps) {
  return (
    <div className="native-app-shell min-h-dvh bg-slate-100 text-slate-900">
      {apiLoading && (
        <div className="border-b border-slate-200 bg-white px-4 py-2 text-center text-sm text-slate-600">
          Verbinde mit dem Server …
        </div>
      )}
      {apiError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Server nicht erreichbar</p>
          <p className="mt-1 text-xs">{apiError}</p>
          {onRetry && (
            <button
              type="button"
              className="mt-2 min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium"
              onClick={onRetry}
            >
              Erneut versuchen
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

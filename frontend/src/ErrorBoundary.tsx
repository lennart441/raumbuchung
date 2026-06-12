import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI-Fehler:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 p-6 text-center text-slate-800">
          <h1 className="text-lg font-semibold text-rose-800">Anzeigefehler</h1>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            Die Oberflaeche konnte nicht geladen werden. Bitte App neu starten.
          </p>
          <pre className="mt-4 max-h-48 w-full max-w-lg overflow-auto rounded-lg bg-white p-3 text-left text-xs text-slate-700 ring-1 ring-slate-200">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-4 min-h-11 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white"
            onClick={() => this.setState({ error: null })}
          >
            Erneut versuchen
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

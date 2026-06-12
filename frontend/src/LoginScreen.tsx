import wappenStocksee from './assets/Wappen_Stocksee.png'
import bmlehLogo from './assets/BMLEH_Fz_2025_Web_de.gif'

type Role = 'USER' | 'EXTENDED_USER' | 'ADMIN'

type LoginScreenProps = {
  loading?: boolean
  isOidcMode: boolean
  oidcConfigured: boolean
  authError: string | null
  devRolePickerOpen: boolean
  roleLabels: Record<Role, string>
  onLogin: () => void
  onDevRoleChoice: (role: Role) => void
  onDevRolePickerClose: () => void
}

const FOOTER_LINKS = [
  { label: 'Gemeindeseite', href: 'https://www.stocksee.de/' },
  { label: 'Impressum', href: 'https://www.stocksee.de/impressum/index.php' },
  { label: 'Datenschutz', href: 'https://www.stocksee.de/datenschutz/index.php' },
] as const

export function LoginScreen({
  loading,
  isOidcMode,
  oidcConfigured,
  authError,
  devRolePickerOpen,
  roleLabels,
  onLogin,
  onDevRoleChoice,
  onDevRolePickerClose,
}: LoginScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f3f5f2] text-slate-800 pt-[env(safe-area-inset-top)]">
      <header className="border-b border-transparent bg-white/60">
        <div
          className="h-0.5 w-full"
          style={{ background: 'linear-gradient(90deg, #1b5e3b 0%, #2d6a9f 100%)' }}
        />
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <img src={wappenStocksee} alt="" className="h-10 w-10 shrink-0 object-contain" aria-hidden />
          <div>
            <p className="text-base font-semibold leading-tight text-[#1b5e3b]">Raumbuchung</p>
            <p className="text-sm leading-tight text-slate-700">Gemeinde Stocksee</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-lg text-center">
          <img
            src={wappenStocksee}
            alt="Wappen der Gemeinde Stocksee"
            className="mx-auto h-28 w-28 object-contain sm:h-32 sm:w-32"
          />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#1b5e3b] sm:text-4xl">
            Willkommen in Stocksee
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-600 sm:text-lg">
            Räume der Gemeinde einfach und übersichtlich buchen — für Vereine, Gruppen und Veranstaltungen.
          </p>

          {loading ? (
            <p className="mt-8 text-sm text-slate-500">Lade Anmeldeoptionen …</p>
          ) : (
            <>
              {isOidcMode && !oidcConfigured && (
                <p className="mt-6 text-xs text-rose-700">
                  Authentik ist nicht konfiguriert. Mobile-Build mit{' '}
                  <code className="rounded bg-rose-50 px-1">npm run cap:sync</code> erstellen und in{' '}
                  <code className="rounded bg-rose-50 px-1">frontend/.env.mobile</code> die Werte{' '}
                  <code className="rounded bg-rose-50 px-1">VITE_AUTHENTIK_OIDC_ISSUER</code> und{' '}
                  <code className="rounded bg-rose-50 px-1">VITE_AUTHENTIK_OIDC_CLIENT_ID</code> setzen.
                </p>
              )}
              {authError && <p className="mt-4 text-sm text-rose-700">{authError}</p>}

              {!devRolePickerOpen ? (
                <button
                  type="button"
                  className="mt-8 min-h-11 w-full max-w-sm rounded-xl bg-[#1b5e3b] px-6 py-3.5 text-base font-medium text-white shadow-sm transition hover:bg-[#164d31] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b5e3b]"
                  onClick={onLogin}
                >
                  Anmelden
                </button>
              ) : (
                <div className="mx-auto mt-8 max-w-sm space-y-3 text-left">
                  <p className="text-center text-sm font-medium text-slate-800">Als welche Rolle anmelden?</p>
                  <p className="text-center text-xs text-slate-500">
                    Nur für lokale Entwicklung; es werden feste Dev-Konten verwendet.
                  </p>
                  <div className="space-y-2">
                    {(['USER', 'EXTENDED_USER', 'ADMIN'] as Role[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => onDevRoleChoice(role)}
                        className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                      >
                        {roleLabels[role]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                    onClick={onDevRolePickerClose}
                  >
                    Zurück
                  </button>
                </div>
              )}

              <p className="mt-4 text-xs text-slate-500">
                {isOidcMode
                  ? 'Mit Authentik oder im Entwicklungsmodus per Demo-Login.'
                  : 'Entwicklungsmodus (DEV=true): Demo-Login ohne Authentik.'}
              </p>
            </>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-200/80 bg-white/50 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-600 underline-offset-2 hover:text-[#1b5e3b] hover:underline"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <img
            src={bmlehLogo}
            alt="BMLEH – Bundesministerium für Landwirtschaft, Ernährung und Heimat"
            className="mx-auto h-24 w-auto shrink-0 object-contain sm:ml-auto sm:h-32 md:h-40"
          />
        </div>
      </footer>
    </div>
  )
}

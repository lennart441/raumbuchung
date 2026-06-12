# Raumbuchungssystem (MVP)

## Stack
- Frontend: React + Vite + Tailwind + PWA shell (+ Capacitor Android-App)
- Backend: NestJS + Prisma
- DB: PostgreSQL (Docker Compose)
- Auth: Authentik (OIDC/JWT) wenn `DEV=false`; bei `DEV=true` Mock-Login ohne Authentik (Header `x-dev-role`)

## Docker Start (nativ in Containern)
1. Optional `.env` für Compose anlegen:
   - `cp .env.example .env`
   - `DEV=true` oder `DEV=false`; bei `DEV=false` u. a. `FRONTEND_ORIGIN`, `VITE_API_URL`, `AUTHENTIK_OIDC_*` und ggf. Mailcow SMTP (`MAIL_*`) setzen
2. Starten:
   - `docker compose up --build -d`
3. Aufrufen:
   - Frontend: `http://localhost:8080`
   - Backend: `http://localhost:3000/api`
4. Logs:
   - `docker compose logs -f frontend backend db`
5. Stoppen:
   - `docker compose down`

Beim Backend-Start werden Migrationen automatisch ausgeführt und Seed-Daten angelegt.

## Auth Konfiguration (Production-Ready)
- `DEV=false` fuer echte Anmeldung ueber Authentik (OIDC)
- `DEV=true` fuer lokalen Mock-Login (Rollenwahl im UI, feste Konten `dev-user`, `dev-extended-user`, `dev-admin`); dann sind keine gueltigen `AUTHENTIK_OIDC_*` Werte fuer den Login erforderlich
- Das Frontend liest den Modus von `GET /api/auth/config` (gleiche `DEV`-Variable wie das Backend)
- Pflichtwerte fuer OIDC nur wenn `DEV=false`:
  - `AUTHENTIK_OIDC_ISSUER`
  - `AUTHENTIK_OIDC_CLIENT_ID`
  - `AUTHENTIK_OIDC_AUDIENCE`
  - `AUTHENTIK_OIDC_APP_ORIGIN`
- Optional:
  - `AUTHENTIK_OIDC_JWKS_URL` (ueberschreibt automatisch abgeleitete URL `${AUTHENTIK_OIDC_ISSUER}/jwks/`)
  - `AUTHENTIK_OIDC_USERINFO_URL` (Default `${AUTHENTIK_OIDC_ISSUER}/userinfo/`)
  - `AUTHENTIK_OIDC_ENABLE_USERINFO_FALLBACK` (Default `false`)
  - `AUTHENTIK_OIDC_JWKS_TIMEOUT_MS` (Default 5000)
  - `AUTHENTIK_OIDC_CLOCK_TOLERANCE_SEC` (Default 0)
  - `AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI` (Default `${AUTHENTIK_OIDC_APP_ORIGIN}`)
  - `AUTHENTIK_OIDC_SCOPE` (Default `openid profile email phone`; mit `offline_access` fuer Refresh Tokens / dauerhafte Anmeldung)

### Android-App (Capacitor + Authentik)
- Separater Authentik Public Client fuer die App (PKCE, Refresh Token); Redirect: `de.stocksee.raumbuchung://oauth/callback`
- Mobile-Build: `cp frontend/.env.mobile.example frontend/.env.mobile` (OIDC-Werte, gitignored) → `cd frontend && npm run cap:sync && npm run cap:open`
- Die Server-`.env` nutzt `AUTHENTIK_OIDC_*`; die App braucht `VITE_AUTHENTIK_OIDC_*` in `frontend/.env.mobile` (oder AUTHENTIK_* dort — werden beim mobile-Build gemappt)
- Production API: `VITE_API_URL=https://raum.stocksee.de/api`
- Play-Store-Release: siehe `frontend/scripts/play-store-release.md`
- Production `FRONTEND_ORIGIN` sollte `https://raum.stocksee.de` enthalten; Capacitor-Origins (`https://localhost`) erlaubt das Backend automatisch

## Lokaler Dev-Mode (ohne Container)
- `cp backend/.env.example backend/.env` und `DEV=true` setzen
- `cp frontend/.env.example frontend/.env` (optional `VITE_DEV=true`, falls `/api/auth/config` nicht erreichbar)
- `docker compose up -d db`
- `cd backend && npm run prisma:generate && npm run prisma:migrate && npm run prisma:seed && npm run start:dev`
- `cd frontend && npm run dev`

### Frontend und Backend auf verschiedenen Ports (ohne Reverse-Proxy)
- Vite laedt Umgebungsvariablen aus **Projektwurzel** `.env` und aus **`frontend/.env`** (letztere ueberschreibt).
- **Variante A:** direkte URL zum API-Prefix, z. B. `VITE_API_URL=http://localhost:3000/api`. CORS: in Development sind die gaengigen lokalen Origins (Vite `:5173`, Docker-UI `:8080`, `localhost` und `127.0.0.1`) immer erlaubt, zusaetzlich zu `FRONTEND_ORIGIN`.
- **Variante B:** relativer Pfad; Vite-Dev-Server proxied `/api` zum Backend (Standardziel `http://127.0.0.1:3000`, uebersteuerbar):
  - `VITE_API_URL=/api` und optional `VITE_BACKEND_ORIGIN=http://localhost:3000`

## Rollen
- `USER`: Buchung immer `PENDING`
- `EXTENDED_USER`: konfliktfreie Buchung direkt `APPROVED`
- `ADMIN`: kann freigeben, ablehnen, nachträglich blocken, Raum/User sperren

## E-Mail Benachrichtigungen (Mailcow SMTP)
- Aktivierung über `MAIL_ENABLED=true`
- SMTP Variablen:
  - `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`
  - `MAIL_USERNAME`, `MAIL_PASSWORD`
  - `MAIL_FROM`, `MAIL_APP_URL`
- Versandregeln:
  - Bei neuer Buchung: Nutzer bekommt Anfrage- oder Sofort-Bestätigung (rollenabhängig)
  - Bei Admin-Freigabe: Nutzer bekommt Bestätigung
  - Bei Admin-Ablehnung oder Sperrung: Nutzer bekommt Absage
  - Bei Admin-Änderung oder Löschung: Nutzer bekommt Änderungs-/Löschhinweis

## Wichtige Endpunkte
- `POST /api/bookings`
- `GET /api/bookings/me`
- `DELETE /api/bookings/:id`
- `GET /api/rooms/:id/availability?from&to`
- `GET /api/admin/bookings`
- `PATCH /api/admin/bookings/:id/approve`
- `PATCH /api/admin/bookings/:id/reject`
- `POST /api/admin/rooms/:id/blocks`
- `POST /api/admin/users/:id/ban-global`
- `POST /api/admin/users/:id/ban-room/:roomId`

## Auth Smoke-Checks
- Modus:
  - `curl http://localhost:3000/api/auth/config` liefert `{"dev":true}` oder `{"dev":false}`
- Gueltiger Token (nur `DEV=false`):
  - `curl -H "Authorization: Bearer <token>" http://localhost:3000/api/auth/me`
- Falsche Audience oder abgelaufener Token:
  - erwartet `401`
- Mock-Rolle (nur `DEV=true`):
  - `curl -H "x-dev-role: ADMIN" http://localhost:3000/api/auth/me`
- Mock-Header bei `DEV=false`:
  - `curl -H "x-dev-role: ADMIN" http://localhost:3000/api/auth/me`
  - erwartet `401`

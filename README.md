# Raumbuchungssystem (MVP)

## Stack
- Frontend: React + Vite + Tailwind + PWA shell
- Backend: NestJS + Prisma
- DB: PostgreSQL (Docker Compose)
- Auth: Authentik (OIDC/JWT), lokal optional `x-dev-user` Header im `AUTH_MODE=dev`

## Docker Start (nativ in Containern)
1. Optional `.env` für Compose anlegen:
   - `cp .env.example .env`
   - Werte für `AUTHENTIK_OIDC_ISSUER`, `AUTHENTIK_OIDC_CLIENT_ID`, `AUTHENTIK_OIDC_AUDIENCE`, `AUTHENTIK_OIDC_APP_ORIGIN` und ggf. Mailcow SMTP (`MAIL_*`) setzen
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
- `AUTH_MODE=oidc` fuer Produktion (dev-header login ist dann deaktiviert)
- `AUTH_MODE=dev` nur fuer lokale Entwicklung
- Pflichtwerte fuer OIDC (compose):
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
  - `AUTHENTIK_OIDC_SCOPE` (Default `openid profile email phone`)

## Lokaler Dev-Mode (ohne Container)
- `cp backend/.env.example backend/.env`
- `cp frontend/.env.example frontend/.env`
- `docker compose up -d db`
- `cd backend && npm run prisma:generate && npm run prisma:migrate && npm run prisma:seed && npm run start:dev`
- `cd frontend && npm run dev`

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
- Gueltiger Token:
  - `curl -H "Authorization: Bearer <token>" http://localhost:3000/api/auth/me`
- Falsche Audience oder abgelaufener Token:
  - erwartet `401`
- Dev-Header in OIDC-Modus:
  - `AUTH_MODE=oidc`
  - `curl -H "x-dev-user: test" http://localhost:3000/api/auth/me`
  - erwartet `401`

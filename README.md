# Raumbuchungssystem (MVP)

## Stack
- Frontend: React + Vite + Tailwind + PWA shell
- Backend: NestJS + Prisma
- DB: PostgreSQL (Docker Compose)
- Auth: Authentik (OIDC/JWT), lokal zusätzlich `x-dev-user` Header

## Docker Start (nativ in Containern)
1. Optional `.env` für Compose anlegen:
   - `cp .env.example .env`
   - Werte für `AUTHENTIK_ISSUER` und `AUTHENTIK_AUDIENCE` setzen
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

## Wichtige Endpunkte
- `POST /api/bookings`
- `GET /api/bookings/me`
- `GET /api/rooms/:id/availability?from&to`
- `GET /api/admin/bookings`
- `PATCH /api/admin/bookings/:id/approve`
- `PATCH /api/admin/bookings/:id/reject`
- `POST /api/admin/rooms/:id/blocks`
- `POST /api/admin/users/:id/ban-global`
- `POST /api/admin/users/:id/ban-room/:roomId`

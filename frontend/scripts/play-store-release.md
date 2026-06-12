# Play Store Release (Android)

## Voraussetzungen

- Authentik-Client `raumbuchung-android` konfiguriert (siehe `.env.mobile.example`)
- `frontend/.env.mobile` mit Production-Werten
- JDK 17+ (empfohlen: JDK 21 LTS) und Android Studio
- Release-Keystore (`.jks`) — Passwörter sicher aufbewahren

## Build

```bash
cd frontend
cp .env.mobile.example .env.mobile   # falls noch nicht vorhanden
npm run cap:sync
npm run cap:open
```

In Android Studio: **Build → Generate Signed App Bundle / APK** → AAB wählen.

Alternativ per CLI (nach Konfiguration von `android/keystore.properties`):

```bash
cd frontend/android
./gradlew bundleRelease
```

Ausgabe: `android/app/build/outputs/bundle/release/app-release.aab`

## Play Console Checkliste

- [ ] Internal Testing Track: AAB hochladen
- [ ] App-Name: Raumbuchung Stocksee
- [ ] Datenschutz-URL: https://www.stocksee.de/datenschutz/index.php
- [ ] Screenshots: Phone + 7"-Tablet
- [ ] `targetSdkVersion` aktuell (API 35)
- [ ] Production-`FRONTEND_ORIGIN` enthält `https://raum.stocksee.de` (CORS für Capacitor ergänzt `https://localhost` automatisch im Backend)

## Gerätetest vor Upload

1. Login → Chrome Custom Tab → Authentik → Deep Link zurück
2. App beenden und neu starten → noch angemeldet
3. Buchung anlegen
4. Abmelden
5. Tablet-Emulator (7" und 10")

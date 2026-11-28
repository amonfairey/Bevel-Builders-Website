# CoParent Hub for iPhone

The iPhone app for CoParent Hub: the same co-parenting record as the web portal (custody schedule with approvals, calendar, activities, expenses, tone-checked messages, call tracking, exchange check-ins, records), plus push notifications and one-tap check-ins from your phone.

It is an [Expo](https://expo.dev) (React Native) app written in TypeScript, using Expo Router for navigation. It talks to the same server as the web portal (`custody-app/server`) and signs in with a bearer token instead of a cookie. The server's API is documented in [`../API.md`](../API.md) and deployment in [`../DEPLOY.md`](../DEPLOY.md).

> Status: this is the **foundation**: sign-in, sign-up, family setup, the tab bar, the More menu, push registration, notification routing and the shared UI kit are done. The other screens are placeholders ("Coming soon") that later work fills in. See [Project structure](#project-structure).

## Prerequisites

- **Node.js 22** and npm.
- **The CoParent Hub server** running somewhere the phone can reach: deployed on HTTPS (see `DEPLOY.md`), or on your computer for local development.
- **An iPhone** with the free **Expo Go** app from the App Store, for development.
- For real builds (TestFlight / App Store): a free **Expo account** and an **Apple Developer Program** membership (US$99/year). You do **not** need a Mac; EAS builds in the cloud.

```bash
cd custody-app/mobile
npm install
```

## Run it on your iPhone with Expo Go

1. Start the server on your computer: `cd custody-app && npm start` (port 3000).
2. Find your computer's LAN IP address (macOS: System Settings → Wi-Fi → Details; Windows: `ipconfig`). Example: `192.168.1.20`.
3. Start Metro, pointing the app at that address:

   ```bash
   cd custody-app/mobile
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start
   ```

4. Scan the QR code with the iPhone Camera app. It opens in Expo Go. Phone and computer must be on the same Wi-Fi; allow incoming connections if your firewall asks.

**Never use `localhost` on a phone**: on the phone, `localhost` is the phone itself. Use the LAN IP for local development, or your deployed `https://` URL. The sign-in screen shows which server the app is using at the bottom.

The app reads `EXPO_PUBLIC_API_URL` first, then `expo.extra.apiUrl` in `app.json` (default `http://localhost:3000`, which only works for the web preview).

Push notifications are limited in Expo Go. Use a development or preview build (below) to test them properly.

## Web preview (desktop browser)

Handy for quick UI work and automated tests. It is not what you ship.

```bash
# terminal 1: the server must allow the preview's origin (exact match, development only)
cd custody-app && CORS_ORIGINS=http://localhost:8081 npm start

# terminal 2
cd custody-app/mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start --web
```

In the web preview the session token is kept in `localStorage` (on iPhone it is in the Keychain via `expo-secure-store`). Date and time fields render as real `<input type="date|time|datetime-local">` elements there. Pushes, haptics and the camera are no-ops.

## Checks

```bash
npm run typecheck   # tsc --noEmit (strict) for the app and for the unit tests
npm test            # lib/format.ts + link mapping tests, plain Node (node --experimental-strip-types --test)
npx expo export --platform web --output-dir /tmp/coparent-web   # full production bundle; keep dist/ out of the repo
```

The format tests also cross-check the app's time-zone math against `../server/time.js` over a grid of dates (including DST changes) and zones.

## Build for TestFlight and the App Store (EAS)

```bash
npm install -g eas-cli
eas login                      # your Expo account
eas init                       # creates the EAS project and writes expo.extra.eas.projectId into app.json
```

`eas init` fills `extra.eas.projectId`. **Push notifications need it**: without a project id the app skips push registration and logs one warning.

Then set your server URL for builds: in `eas.json`, replace `https://REPLACE-WITH-YOUR-SERVER` in each profile's `EXPO_PUBLIC_API_URL` with your deployed HTTPS origin (no trailing slash, no `/api`).

| Profile | What it is | Command |
|---|---|---|
| `development` | Dev client for your own devices (fast refresh against Metro). First run `npx expo install expo-dev-client`; after that `npx expo start` targets the dev build (use `npx expo start --go` for Expo Go). | `eas build -p ios --profile development` |
| `preview` | Internal build installed directly on registered iPhones (register them with `eas device:create`). | `eas build -p ios --profile preview` |
| `production` | App Store build; the build number auto-increments. | `eas build -p ios --profile production` |

Submit to TestFlight / App Store Connect:

```bash
eas submit -p ios --latest
```

EAS asks for your Apple ID and creates the certificates, provisioning profile and push key for you. The first submission creates the app record in App Store Connect; testers get it through TestFlight once Apple's beta review passes.

## Before you submit to the App Store

- **Bundle identifier**: `ios.bundleIdentifier` (and `android.package`) are the placeholder `com.example.coparenthub`. Change them to a reverse-DNS id you own (for example `com.yourname.coparenthub`) **before the first build**. It can't change after the app is in App Store Connect.
- **Name, icon and splash**: replace `assets/icon.png` (1024×1024 PNG, no transparency) and `assets/splash-icon.png`; adjust `name` in `app.json`.
- **Server URL**: `EXPO_PUBLIC_API_URL` in `eas.json` must be your HTTPS server.
- **Privacy policy URL**: App Store Connect requires one. Host a page that says what is stored (name, email, family records, messages, notes, receipts and photos you attach, check-in locations you choose to attach, push tokens), where, and how to delete it.
- **App Privacy labels** (App Store Connect → App Privacy): declare Contact Info (name, email), User Content (messages, notes, photos), Location (precise, only when attached to a check-in), Identifiers (device push token), all linked to the user and not used for tracking.
- **Account deletion**: Apple guideline 5.1.1(v) requires in-app account deletion. The server supports it (`POST /api/account/delete`); make sure the Settings → Account screen (`app/settings/account.tsx`, still a placeholder in the foundation) exposes it before you submit. After deleting, call `useSession().signOutLocally()`.
- **Permission texts** (location, camera, photos) are set in `app.json` (`ios.infoPlist` and the `expo-location` / `expo-image-picker` plugins). Keep them accurate if features change.
- **Export compliance**: `ITSAppUsesNonExemptEncryption` is `false` (the app only uses standard HTTPS).
- **App Review**: give the reviewer a demo account that already has a family (ideally with a second parent account) in the review notes.
- **Claims**: don't describe the records as "court-admissible" in the listing; see the limitations in `../README.md`.

## Push notifications

- **Flow**: once signed in, the app asks for permission on a physical device, gets an Expo push token for `extra.eas.projectId`, and registers it with `POST /api/push-tokens`. Signing out removes it (`POST /api/push-tokens/remove`).
- **Delivery**: the server sends through Expo's push service, which forwards to Apple (APNs). EAS creates the APNs key during `eas build` / `eas credentials`.
- **Taps**: each push carries `data.link` (for example `messages/12`). `lib/links.ts` maps it to a screen (`/thread/12`) and the app opens it, including when a tap launches the app from a closed state, and marks that notification read.
- **While open**: banners still show; the tab badges refresh. The app icon badge equals unread notifications (`unread_notifications` from `GET /api/me`).
- **Requirements**: a physical iPhone (the simulator can't receive remote pushes), an EAS project id, and a server that can reach `exp.host` over HTTPS. For local development you can run the server with `PUSH_DISABLED=1`; the in-app inbox still works.

## Project structure

```
app/                     Expo Router routes (each file is a screen)
  _layout.tsx            providers, auth gate (Stack.Protected), push registration, notification-tap routing
  (auth)/                sign-in, sign-up
  setup.tsx              create a family or join with an invite code
  (tabs)/                Home, Calendar, Messages, Money, More (tab bar with badges)
  ...                    the other screens (see the route table)
components/
  ui/                    shared UI kit (documented in components/ui/index.ts)
  auth/                  sign-in/sign-up chrome
  <area>/                screen owners' own components
lib/
  api.ts                 typed fetch client (bearer token, ApiError, 401 -> sign out)
  session.tsx            AuthProvider / useSession(): status, me, signIn, signUp, signOut, refreshMe
  hooks.ts               useApi(path) (refetches on focus), useMe(), usePeople(), nameOf/colorOf/...
  badges.tsx             tab, menu and app-icon badge counts
  types.ts               every API response shape
  format.ts              family-time-zone date/time helpers (unit tested)
  status.ts              status labels and tones (same words as the web portal)
  links.ts / routes.ts   notification link -> route, typed route builders
  push.ts                push registration and tap routing
  storage.ts             Keychain (native) / localStorage (web) token storage
  theme.ts               light/dark palettes matching the web portal, spacing, type scale
  config.ts              API base URL, EAS project id
```

### Conventions

- **Time zones**: custody times are in the **family** time zone (`me.family.timezone`), never the phone's. Use `lib/format.ts` (`fmtDT(ms, tz)`, `todayLocal(tz)`, `daySegments(timeline, date, tz)`...). Form values are strings: `'YYYY-MM-DD'`, `'HH:MM'`, `'YYYY-MM-DDTHH:MM'`.
- **Data**: `const q = useApi<Dashboard>('/api/dashboard')`, which refetches when the screen regains focus. Mutate with `api.post(...)` wrapped in `useAttempt()` for error toasts. After approving or reading something, call `useBadges().refresh()`.
- **Navigation**: build hrefs with `routes` from `lib/links.ts` (`router.push(routes.thread(id))`). Typed routes are off on purpose, so hrefs are plain strings and the build doesn't depend on generated files.
- **UI**: use `components/ui` (Screen, Card, Section, Button, Field, Select, DateField, Dialog, Toast, NotesPanel, useToneGate...). Dialogs use `useDialog()`, never `Alert.alert` (a no-op in the web preview). Tab roots pass `title` to `Screen`; pushed screens pass `headerTitle`.

### Route ownership

Files marked "foundation" are done. The others are placeholders for later work: each is a default-exported screen that already reads its params.

| Route file | Owner |
|---|---|
| `app/_layout.tsx`, `app/(auth)/*`, `app/setup.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/more.tsx` | foundation |
| `app/(tabs)/index.tsx`, `app/(tabs)/calendar.tsx`, `app/day/[date].tsx`, `app/notifications.tsx` | HOME |
| `app/schedule/index.tsx`, `[id].tsx`, `change.tsx`, `pattern.tsx`, `holiday.tsx`, `primary.tsx` | SCHEDULE |
| `app/(tabs)/messages.tsx`, `app/thread/[id].tsx`, `app/thread/new.tsx`, `app/calls/index.tsx`, `log.tsx`, `rule.tsx` | MESSAGES |
| `app/(tabs)/money.tsx`, `app/expense/new.tsx`, `app/expense/[id].tsx`, `app/payment/new.tsx`, `app/activities/index.tsx`, `[id].tsx`, `edit.tsx` | MONEY |
| `app/exchanges/index.tsx`, `check-in.tsx`, `app/records.tsx`, `app/sync.tsx`, `app/settings/index.tsx`, `app/settings/child/[id].tsx`, `app/settings/account.tsx` | SETTINGS |

Shared code is owned by the foundation, and screen owners don't edit it: `lib/**`, `components/ui/**`, `app.json`, `package.json`, `tsconfig.json`, `eas.json`, this README. Screen owners add their own components under `components/<area>/`.

**Route params**: `/schedule/change?date=YYYY-MM-DD` · `/activities/edit?id=<eventId>` (no id = new) · `/expense/new?eventId=&description=&amount=` · `/thread/[id]` · `/day/[date]` · `/schedule/[id]` (rule id) · `/expense/[id]` · `/activities/[id]` · `/settings/child/[id]`.

**Notification links** (`lib/links.ts`): `dashboard` → `/` · `calendar` → `/calendar` · `schedule` → `/schedule` · `activities` → `/activities` · `expenses` → `/money` · `messages` → `/messages` · `messages/<id>` → `/thread/<id>` · `calls` → `/calls` · `exchanges` → `/exchanges` · `records` → `/records` · `settings` → `/settings`.

Form screens (change requests, new expense, new message, log a call, check-in...) open as iOS sheets with a Cancel button; this is set in `app/_layout.tsx`.

## Known limitations

- PDF attachments (receipts, notes) open in the web portal; on iPhone the app shows images in-app and lists PDFs by name.
- The printable report is meant to open in Safari through a short-lived report link (`POST /api/report-link`, then `expo-web-browser`), since Safari can't carry the app's token.
- Calendar sync is subscription-based (see `../README.md`).

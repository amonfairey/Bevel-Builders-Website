# CoParent Hub API reference

One server (`server/`, Node 22, no dependencies) serves both clients:

- the **web portal** (`public/`, same origin, cookie session), and
- the **iPhone app** (`mobile/`, bearer token).

Every shape below comes from the code in `server/api.js`, `server/notify.js`, `server/account.js` and `server/index.js`. If this document and the code disagree, the code wins and this file should be fixed.

## Conventions

- **Base URL**: the server origin, e.g. `https://coparent.example.com`. All paths below are relative to it.
- **Bodies**: every `POST`/`PUT` body is JSON. Send `Content-Type: application/json`; anything else with a non-empty body gets `415 {"error":"JSON required"}`. Bodies over 12 MB get `413`. Malformed JSON gets `400 {"error":"Invalid JSON"}`. An empty body is treated as `{}`.
- **Responses**: JSON unless noted. Success is `200`. Endpoints that return nothing in particular return `{"ok":true}`.
- **Errors**: always `{"error":"<message for a person>"}` with a status code. Messages are written to be shown to the user as-is.

| Status | Meaning |
|---|---|
| 400 | Validation failed (the message says what to fix) |
| 401 | Not signed in, or the session/bearer token is invalid or expired |
| 403 | Signed in but not allowed: `Set up or join a family first`, `View-only access`, or "the other parent has to do this" |
| 404 | Not found, or it belongs to another family (never distinguished) |
| 413 / 415 | Body too large / not JSON |
| 429 | Rate limited (login, sign-up, password checks) |
| 500 | `Something went wrong` (logged on the server) |

- **Dates**: `YYYY-MM-DD` dates and `YYYY-MM-DDTHH:MM` *local* stamps are in the **family time zone** (`family.timezone`). Fields named `*_ms`, `start`/`end` on timeline intervals and `at` are UTC epoch milliseconds. Fields named `*_at` are ISO 8601 UTC strings set by the server.
- **Money**: request fields `amount`/`cost` are dollars (number or string, e.g. `"120.00"`); response fields end in `_cents` and are integers.
- **IDs** are integers. `entity_id` in notifications and audit entries is a string.

### Access levels used below

| Level | Meaning |
|---|---|
| public | No sign-in needed |
| user | Signed in (any account) |
| member | Signed in and in a family (parents and view-only members) |
| parent | Signed in as one of the family's two parents (not view-only) |

## Authentication

### Web portal: cookie

`POST /api/register` and `POST /api/login` set an `HttpOnly; SameSite=Lax` cookie named `sid` (plus `Secure` when `NODE_ENV=production`). The browser sends it automatically. Nothing else to do.

### iPhone app: bearer token

1. Sign up or sign in with `"client": "mobile"` in the body:
   ```http
   POST /api/login
   Content-Type: application/json

   {"email":"sam@example.com","password":"correct-horse-1","client":"mobile"}
   ```
   ```json
   {"ok":true,"token":"Vt0kq0...43 chars"}
   ```
   No cookie is set.
2. Store the token in the iOS Keychain (Expo SecureStore), never in plain storage.
3. Send it on every request, including `GET /report` and `GET /api/files/:hash`:
   ```http
   Authorization: Bearer Vt0kq0...
   ```
4. Sessions last **30 days** (same table as web sessions). Any `401` means the token is no longer valid: delete it and show sign-in.
5. `POST /api/logout` with the bearer deletes that session (and any push token registered with it). Other devices stay signed in.

Rules:

- A bearer header takes precedence over a cookie.
- An invalid, expired or empty bearer gets `401 {"error":"Session expired. Sign in again."}` on every route except `POST /api/register`, `POST /api/login` and `GET /api/public-config`, so a stale token never blocks signing in again.
- `GET /api/me` with **no** credentials returns `200 {"user":null}` (not 401).
- Changing the password signs out every other session (see `POST /api/account/password`).

### CORS (development only)

Only for the Expo web preview of the iPhone app. When the request's `Origin` exactly matches an entry in the server's `CORS_ORIGINS` (e.g. `http://localhost:8081`), responses (including errors) carry:

```
Access-Control-Allow-Origin: <that origin>
Vary: Origin
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 600
```

`OPTIONS /api/*` returns `204`. There is never `*` and never `Access-Control-Allow-Credentials`, so CORS requests must use the bearer token, not cookies. Native iOS requests are not subject to CORS.

### Rate limits

| What | Limit | Response |
|---|---|---|
| `POST /api/login` | 8 failed attempts per IP + email per 15 minutes | 429 |
| `POST /api/register` | 10 attempts per IP per hour | 429 |
| Wrong current password on `/api/account/password` or `/api/account/delete` | 8 per account per 15 minutes | 429 |

The client IP is the socket address, or the first `X-Forwarded-For` entry when the server runs with `TRUST_PROXY=1`.

## Notifications

Every notable action by one parent creates an inbox entry for the **other** parent (never the person who did it, never view-only members), and a push to their iPhone if one is registered. Exchange reminders go to **both** parents.

### Notification object

```json
{
  "id": 24,
  "kind": "exchange_checkin",
  "title": "Sam checked in at an exchange",
  "body": "Drop-off at 6:05 PM (5 min late)",
  "link": "exchanges",
  "entity": "exchange",
  "entity_id": "1",
  "created_at": "2026-11-28T04:08:09.768Z",
  "read_at": null
}
```

### `link` values (shared by both clients)

`link` says which screen to open. It is always one of:

| link | Screen |
|---|---|
| `dashboard` | Home / dashboard |
| `calendar` | Calendar |
| `schedule` | Custody schedule and its requests |
| `activities` | Activities / events |
| `expenses` | Expenses and payments |
| `messages` | Message threads list |
| `messages/<threadId>` | One thread, e.g. `messages/12` |
| `calls` | Calls and call schedules |
| `exchanges` | Exchange check-ins |
| `records` | Records / report / audit |
| `settings` | Family settings and members |

Clients should fall back to `dashboard` for anything they don't recognise.

### Kinds

| kind | Sent when | To | link | entity |
|---|---|---|---|---|
| `rule_requested` | A parent proposes a custody rule or change request (only once a co-parent has joined) | other parent | `schedule` | `rule` |
| `rule_decided` | A rule is approved or declined | the requester | `schedule` | `rule` |
| `rule_retire_requested` | A parent asks to end an active rule | other parent | `schedule` | `rule` |
| `rule_retire_decided` | That request is approved or declined | the requester | `schedule` | `rule` |
| `call_rule_requested` | A call schedule is proposed, or ending one is requested | other parent | `calls` | `call_rule` |
| `call_rule_decided` | A call schedule (or ending it) is approved or declined | the requester | `calls` | `call_rule` |
| `event_proposed` | An activity is created or edited while a co-parent exists | other parent | `activities` | `event` |
| `event_responded` | An activity is accepted or declined | the event's creator | `activities` | `event` |
| `expense_requested` | An expense is created with reimbursement requested, or requested later | other parent | `expenses` | `expense` |
| `expense_decided` | An expense is approved or disputed | the payer | `expenses` | `expense` |
| `payment_sent` | A payment is recorded | the recipient | `expenses` | `payment` |
| `payment_confirmed` | The recipient confirms it, or says it wasn't received | the sender | `expenses` | `payment` |
| `call_logged` | A call is logged | other parent | `calls` | `call` |
| `call_confirmed` | The other parent agrees with or disputes a call log | the logger | `calls` | `call` |
| `message` | A message is sent (also the first message of a new thread). `body` is the first 120 characters | other parent | `messages/<threadId>` | `message` |
| `exchange_checkin` | An exchange check-in (drop-off, pick-up, no-show, late) | other parent | `exchanges` | `exchange` |
| `member_joined` | A co-parent or view-only member joins | existing parents | `settings` | `member` |
| `member_left` | A member deletes their account | remaining parents | `settings` | `member` |
| `exchange_reminder` | 24 hours and 1 hour before each custody hand-off | both parents | `calendar` | `exchange` (`entity_id` = hand-off time in ms) |

Titles are short and neutral ("Sam requested a schedule change", "New message from Jordan", "Exchange in 1 hour", "Exchange tomorrow"). Treat `title`/`body` as display text; branch on `kind` and `link`.

### Reading and the badge

- `GET /api/me` includes `unread_notifications`. Use it for the app icon badge and the web bell.
- Opening a thread with `GET /api/threads/:id` marks that thread's `message` notifications read.
- Otherwise clients mark notifications read with `POST /api/notifications/read`.

### Push (iPhone)

The server sends through the Expo push service (which relays to Apple Push Notification service). Each push looks like:

```json
{
  "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "title": "New message from Jordan",
  "body": "Running 10 minutes late today.",
  "sound": "default",
  "badge": 3,
  "data": { "link": "messages/12", "notification_id": 57 }
}
```

`badge` is the recipient's unread count after this notification. On tap, open `data.link` and mark `data.notification_id` read. Pushes only go to devices whose session is still valid. When Expo reports `DeviceNotRegistered`, the server forgets that token.

## Endpoint reference

### Platform

#### `GET /healthz`
Public. Checks the database. → `200 {"ok":true}`. Used by Docker `HEALTHCHECK` and hosting platforms.

#### `GET /api/public-config`
Public. → `{"appStoreUrl": string|null, "testflightUrl": string|null}` from the server's `APP_STORE_URL` / `TESTFLIGHT_URL`. The web portal uses it to show "Get the iPhone app".

### Account

#### `POST /api/register`
Public. Body: `{ email, name, password, client? }`

| Field | Rules |
|---|---|
| `email` | valid address, max 200 chars, stored lowercase |
| `name` | required, max 100 chars |
| `password` | at least 10 characters |
| `client` | `"mobile"` to get a token instead of a cookie |

→ web: `{"ok":true}` + `Set-Cookie`. mobile: `{"ok":true,"token":"..."}`, no cookie.
Errors: 400 `Enter a valid email`, `Enter your name`, `Password must be at least 10 characters`, `An account with that email exists`; 429.

#### `POST /api/login`
Public. Body: `{ email, password, client? }` → same as register.
Errors: 401 `Wrong email or password` (same message whether or not the email exists); 429 `Too many attempts. Try again in 15 minutes.`

#### `POST /api/logout`
User. → `{"ok":true}`. Deletes the session that authenticated the request (bearer or cookie). Cookie requests also get the cookie cleared. Push tokens registered with that session are removed.

#### `GET /api/me`
Public (signed out) / user.

Signed out: `{"user":null}`.

Signed in, no family yet:
```json
{ "user": { "id": 1, "name": "Sam", "email": "sam@example.com" }, "family": null, "unread_notifications": 0 }
```

Signed in, in a family:
```json
{
  "user": { "id": 1, "name": "Sam", "email": "sam@example.com" },
  "family": { "id": 1, "name": "Smith", "timezone": "America/Los_Angeles", "default_split": 50,
              "invite_code": "C9D62D33F6", "viewer_code": "18D8D369C6" },
  "unread_notifications": 3,
  "role": "parent",
  "members": [ { "id": 1, "name": "Sam", "email": "sam@example.com", "role": "parent", "color": "#2f6f9f", "deleted": false } ],
  "children": [ { "id": 1, "name": "Ava", "birthdate": "2016-04-02", "info": { "school": "Oak" } } ],
  "primary": 1,
  "icsBase": "/ics/uWFaN-DVuPvVmUFCMb8VY2zI8HxlADQX.ics"
}
```
- `invite_code` and `viewer_code` are only present for parents. `invite_code` becomes `null` once both parent places are taken, and a fresh one is issued when a parent deletes their account (see `POST /api/account/delete`).
- `default_split` is **one family-wide value, the same for both parents**: the share (percent) of a new expense covered by **the parent who paid it**. The other parent's share on a new expense (`other_share_pct`) defaults to `100 - default_split`, whoever paid. It is not "your share": with `default_split: 70`, Sam paying $100 pre-fills Jordan's share as 30%, and Jordan paying $100 pre-fills Sam's share as 30%.
- `primary` is the user id of the primary custodial parent (the background default), or `null`.
- `icsBase` is this user's private calendar subscription path. Prefix with the server origin; add `?include=custody`, `?include=events` or `?include=custody,events`. Use `webcal://` for one-tap subscribe on iPhone.
- `members[].deleted` is `true` for a parent who deleted their account. They stay in `members` with name `Deleted user` (and email `deleted-<id>@invalid`) so past records still resolve, but they are **not** a live parent: clients should skip them when looking for "the co-parent", in parent pickers and in approval wording. A view-only member who deletes their account is removed from `members`.

#### `POST /api/account/password`
User. Body: `{ current, next }` → `{"ok":true}`.
Signs out every **other** session of the account (the session making this request keeps working), removes push tokens of those sessions and any open report links. Recorded in the family audit log as `change_password` (no password data).
Errors: 400 `Current password is wrong`, `New password must be at least 10 characters`; 429.

#### `POST /api/account/delete`
User. Body: `{ password }` → `{"ok":true}` and the cookie is cleared. This is the in-app account deletion Apple requires (App Store Review Guideline 5.1.1(v)). The client should confirm first and then discard its token.
Errors: 400 `Password is wrong`; 429.

What happens:
- Always removed: the account's sessions, push tokens, report links, imported calendars it owns, and its notifications.
- **Nobody else is left in the family** (or no family): the whole family is erased, including messages, notes, the audit log, files and every other record. This cannot be undone.
- **A co-parent or view-only member remains**: messages, notes and approvals are also the other parent's records, so the account is **anonymized**, not erased: name becomes `Deleted user`, email `deleted-<id>@invalid`, the password and calendar link stop working. A parent's past records stay attributed to `Deleted user`; a view-only member is removed from the family. The remaining parents get a `member_left` notification and the audit log records `delete_account`. The email address can be used to sign up again.
- **After a parent is anonymized** they no longer count as a parent: they can't approve anything, can't be assigned new custody time, calls or driving, and don't hold a parent place. The family gets a **fresh `invite_code`** so a new co-parent can join. Until one does, the remaining parent's new requests are `unconfirmed` (in effect, like before a co-parent first joined), activities are `accepted`, and ending an item applies at once. Requests the remaining parent made earlier stay `pending`; they can withdraw them, or the new co-parent decides them after joining (and confirms or disputes the `unconfirmed` ones). Existing rules that assign time to the deleted parent stay in effect until they are ended or replaced. Their expenses and payments still count in `/api/balance`.

### Family

#### `POST /api/family`
User without a family. Body: `{ name?, timezone?, children?: [{ name, birthdate? }] }`. Defaults: `name` "Our family", `timezone` `America/Los_Angeles` (any IANA zone).
→ `{"ok":true,"family_id":1}`. The creator becomes primary custodial parent (rule status `unconfirmed` until the co-parent confirms).
Errors: 400 `You already belong to a family`, `Unknown time zone`.

#### `POST /api/family/join`
User without a family. Body: `{ code }` (invite code → parent, viewer code → view-only). → `{"ok":true,"role":"parent"|"viewer"}`. Existing parents get `member_joined`.
Errors: 400 `You already belong to a family`, `Invite code not found`, `This family already has two parents` (a parent who deleted their account does not count).

#### `PUT /api/family`
Parent. Body: `{ name?, timezone?, default_split? (0-100) }` → `{"ok":true}`. `default_split` is family-wide: the share covered by whichever parent paid an expense (see `GET /api/me`). Errors: 400 `Unknown time zone`.

#### `POST /api/family/viewer-code`
Parent. Rotates the view-only invite code. → `{"viewer_code":"A1B2C3D4E5"}`.

#### `POST /api/children`
Parent. Body: `{ name, birthdate? }` → `{"id":2}`. Errors: 400 `Enter a name`.

#### `PUT /api/children/:id`
Parent. Body: `{ name?, birthdate?, info? }`. `info` is a flat object of strings (school, doctor, allergies, medications, sizes, emergency contact...; up to 30 keys, keys 40 chars, values 1000 chars) and replaces the stored one. → `{"ok":true}`. Errors: 404.

### Custody schedule

#### Rule object (`GET /api/rules`)
```json
{
  "id": 2, "family_id": 1, "type": "pattern", "name": "Alternating weekends",
  "config": { "...": "see below" }, "priority": 0, "reason": "",
  "status": "pending", "requested_by": 1, "requested_at": "2026-11-28T04:08:09.604Z",
  "decided_by": null, "decided_at": null, "decision_note": null,
  "retire_requested_by": null, "retire_requested_at": null, "supersedes": null,
  "requested_by_name": "Sam", "decided_by_name": null, "supersedes_name": null
}
```
`supersedes` is the id of the rule this one replaces (it is retired when this one takes effect); `supersedes_name` is that rule's name. Clients show it as "Replaces: <name>".
`status`: `pending` (awaiting the other parent), `unconfirmed` (made while there was no live co-parent: before they joined, or after they deleted their account; in effect), `active`, `rejected`, `withdrawn`, `retired`. Only `active` and `unconfirmed` affect the schedule. A non-null `retire_requested_by` means someone asked to end it.

`type` and `config`:

| type | config |
|---|---|
| `default` | `{ "parent": userId }` (primary custodial parent, lowest layer) |
| `pattern` | `{ "anchorDate": "YYYY-MM-DD", "cycleDays": 1-56, "segments": [{ "startDay", "startTime": "HH:MM", "endDay", "endTime", "parent" }], "effectiveFrom"?, "effectiveTo"?, "template"? }` |
| `holiday` | `{ "rule": { "type": "fixed", "month", "day" } \| { "type": "nth_weekday", "month", "weekday" (0=Sun), "n" (-1 = last) } \| { "type": "easter" } \| { "type": "range", "startMonth", "startDay", "endMonth", "endDay" } \| { "type": "once", "startDate", "endDate"? }, "start": { "dayOffset", "time" }, "end": { "dayOffset", "time" }, "assignment": { "mode": "fixed", "parent" } \| { "mode": "alternate", "evenYears", "oddYears" } }` |
| `override` | `{ "periods": [{ "start": "YYYY-MM-DDTHH:MM", "end": "...", "parent" }] }` (one-time change or swap; highest layer) |

#### `GET /api/rules`
Member. → `Rule[]` ordered by id.

#### `POST /api/rules`
Parent. Body: `{ type, name?, config?, template?, priority?, reason?, supersedes? }`.
For `type: "pattern"` you can send `template` instead of `config`. `template` is an **object** (the template name goes in its own `template` field):
```json
{ "type": "pattern", "name": "School year",
  "template": { "template": "alternating_weekends", "anchorDate": "2026-12-04", "parentA": 1, "parentB": 2,
                "exchangeTime": "18:00", "options": { "midweek": true }, "effectiveFrom": null, "effectiveTo": null },
  "supersedes": 2 }
```
`template.template`: `"alternating_weekends"|"every_weekend"|"week_on_week_off"|"2-2-3"|"2-2-5-5"|"3-4-4-3"|"custom"`; `anchorDate` required; `parentA`/`parentB` are user ids of live parents; `exchangeTime` default `"18:00"`; `options`, `effectiveFrom`, `effectiveTo` optional.
Options: `alternating_weekends` and `every_weekend` take `weekendStart`/`weekendEnd`; `alternating_weekends` also takes `midweek: true`, `midweekStart`, `midweekEnd`; `custom` takes `days`: an array (1-56) of parent ids or `null`, one per day.
`supersedes`: id of a rule this one replaces. It is retired when this one is approved, or at once if this one is `unconfirmed`. If an `unconfirmed` replacement is later disputed, the rule it replaced is put back (audit action `restore`). Use it when changing the regular schedule, or the old pattern keeps applying alongside the new one.
→ `{"id":3}`. Status is `pending` (co-parent notified with `rule_requested`) or `unconfirmed` if there is no live co-parent (not joined yet, or deleted their account).
Errors: 400 with the validation message (e.g. `Pattern needs an anchor date`, `Change request periods need start and end date/times`).

#### `POST /api/rules/:id/decide`
Parent who did **not** request it. Body: `{ decision: "approve"|"reject", note? }` → `{"ok":true,"status":"active"|"rejected"}`. Requester gets `rule_decided`.
Errors: 400 `Decision must be approve or reject`, `This request has already been decided`; 403 `The other parent has to approve your request`; 404.

#### `POST /api/rules/:id/withdraw`
Parent, own pending request. → `{"ok":true}`. Errors: 400 `Only your own pending requests can be withdrawn`; 404.

#### `POST /api/rules/:id/retire`
Parent. Body: `{ note? }`. Asks to end an active rule.
→ no live co-parent: `{"ok":true,"status":"retired"}`; otherwise `{"ok":true,"status":"active","retire_pending":true}` and the other parent gets `rule_retire_requested`.
Errors: 400 `Only active items can be ended`, `Ending this is already requested`; 404.

#### `POST /api/rules/:id/retire-decide`
Parent who did not ask. Body: `{ decision: "approve"|"reject", note? }` (anything other than `approve` rejects) → `{"ok":true}`. Asker gets `rule_retire_decided`.
Errors: 403 `The other parent has to approve this`; 404 `No end request`.

#### `GET /api/rules/:id/impact?start=&end=`
Member. Time share with and without the rule (default: today + 365 days). → `{ start, end, before: Share, after: Share }`.
If the rule has `supersedes`, the replaced rule counts in `before` and not in `after` (for a rule already in effect, `before` puts back the rule it retired), so the comparison shows the actual change.

#### `POST /api/schedule/preview`
Member. Body: `{ type, config? | template?, priority?, supersedes?, start?, end? }` (default 28 days from today, max 800). `template` is the same object as for `POST /api/rules`. With `supersedes`, the preview leaves out that rule, as it would be once replaced. → `{ timeline: Interval[], share: Share }`. Nothing is saved.
Errors: 400 with the validation message (e.g. `Unknown template: weekly`, `Pattern needs an anchor date`, `Custom cycle needs 1-56 days`, `Unknown rule type`, `Range must be 1-800 days`).

#### `GET /api/timeline?start=&end=`
Member. Default today + 42 days; max 800 days. → `{ start, end, timezone, timeline: Interval[], share: Share, transitions: Transition[] }`.
Errors: 400 `Range must be 1-800 days`.

Shared shapes:
```jsonc
// Interval: who has the children, contiguous and non-overlapping
{ "start": 1764986400000, "end": 1765159200000, "parent": 2, "src": { "type": "pattern", "id": 2, "name": "Alternating weekends" } }
// Transition: a hand-off
{ "at": 1764986400000, "from": 1, "to": 2, "src": { "type": "pattern", "id": 2, "name": "Alternating weekends" } }
// Share: keys of hours/pct/overnights/nightPct are parent ids (or "unassigned")
{ "hours": { "1": 576, "2": 96 }, "pct": { "1": 85.7, "2": 14.3 }, "overnights": { "1": 24, "2": 4 }, "nightPct": { "1": 85.7, "2": 14.3 },
  "totalHours": 672, "totalNights": 28,
  "byParent": [ { "parent": 1, "name": "Sam", "hours": 576, "pct": 85.7, "overnights": 24, "nightPct": 85.7 } ] }
```
An overnight is credited to whoever has the children at 2:00 AM.

#### `GET /api/holiday-presets`
User. → `[{ key, name, rule }]` (New Year's Day, MLK Day, ..., Winter Break, Summer Vacation, Child's Birthday).

### Activities (events)

#### `GET /api/events?start=&end=`
Member. Default today + 42 days. → `{ events: EventInstance[], external: FeedEvent[] }`.
```jsonc
// EventInstance: one occurrence (recurring events are expanded)
{ "id": 1, "family_id": 1, "title": "Soccer", "category": "activity", "child_ids": [1],
  "start_local": "2026-12-01T17:00", "end_local": "2026-12-01T18:00", "location": "Park", "transport_parent": 2,
  "recurrence": { "freq": "weekly", "interval": 1, "byday": [2], "until": null, "exdates": ["2026-12-08"] },
  "details": "", "cost_cents": null, "status": "proposed", "created_by": 2, "created_at": "...",
  "responded_by": null, "responded_at": null, "response_note": null, "updated_at": null,
  "instance_date": "2026-12-01", "start": 1764637200000, "end": 1764640800000,
  "custody_parent": 1, "note_count": 0 }
// FeedEvent: from an imported calendar (read-only)
{ "id": 1, "feed_id": 1, "uid": "w1", "title": "Work", "start_ms": 0, "end_ms": 0, "all_day": 0, "location": "",
  "feed_name": "Work", "provider": "google", "owner": 2 }
```
`status`: `proposed` (awaiting the other parent), `accepted`, `declined`. Cancelled events are not returned. `custody_parent` is who has the children at the start time; flag it when it differs from `transport_parent`.

#### `POST /api/events`
Parent. Body:

| Field | Rules |
|---|---|
| `title` | required, max 200 |
| `start`, `end` | `YYYY-MM-DDTHH:MM`, end after start |
| `category` | default `activity` |
| `child_ids` | array of child ids |
| `location`, `details` | text |
| `transport_parent` | parent id or null |
| `recurrence` | `{ freq: "daily"|"weekly"|"monthly", interval?: 1-8, byday?: [0-6], until?: "YYYY-MM-DD", exdates?: [] }` or null |
| `cost` | dollars, optional |

→ `{"id":1}`. Status `proposed` (co-parent gets `event_proposed`) or `accepted` if no co-parent.
Errors: 400 `Enter a title`, `Enter a valid start and end`, `Repeat must be daily, weekly or monthly`, `Unknown parent`, `Unknown child`.

#### `PUT /api/events/:id`
Parent. Same fields, all optional (missing = unchanged). Resets to `proposed` and notifies the co-parent. → `{"ok":true}`. Errors: as above, 404.

#### `POST /api/events/:id/respond`
Parent who did not create or last edit it. Body: `{ response: "accepted"|"declined", note? }` → `{"ok":true}`. The creator gets `event_responded`.
Errors: 400 `Response must be accepted or declined`; 403 `The other parent responds to this`; 404.

#### `POST /api/events/:id/cancel`
Parent. Body: `{ date?, note? }`. With `date` on a recurring event, cancels that one occurrence; otherwise cancels the event. → `{"ok":true}`.

### Calendar feeds

#### `GET /api/feeds`
Member. Feeds you imported plus feeds others shared with the family. → `[{ id, name, provider, visibility: "me"|"family", last_sync, last_error, user_id, events }]` (`events` = number of imported events).

#### `POST /api/feeds`
Member. Body: `{ url, name?, provider?: "google"|"apple"|"outlook"|"other", visibility?: "me"|"family" }`. `url` is the calendar's secret iCal address (`https://` or `webcal://`); private network addresses are refused. The first sync runs immediately.
→ `{"id":1,"ok":true,"count":12}` or, if the sync failed, still `200` with `{"id":1,"ok":false,"error":"Calendar server returned 404"}`.
Errors: 400 `Paste the calendar's secret iCal address`.

#### `POST /api/feeds/:id/sync`
Member, feed owner. → `{"ok":true,"count":12}` or `{"ok":false,"error":"..."}`. Errors: 404.

#### `DELETE /api/feeds/:id`
Member, feed owner. → `{"ok":true}`. Errors: 404.

#### `POST /api/ics-token/rotate`
User. Invalidates the old subscription URL. → `{"ok":true}`; read the new `icsBase` from `/api/me`.

### Expenses and payments

#### `GET /api/expenses`
Member. → newest first:
```json
{ "id": 1, "family_id": 1, "description": "Cleats", "category": "other", "amount_cents": 5000, "date": "2026-11-27",
  "child_ids": [1], "event_id": null, "paid_by": 1, "other_share_pct": 50, "receipt_hash": "9f86d0...",
  "status": "requested", "created_at": "...", "decided_by": null, "decided_at": null, "decision_note": null,
  "receipt_name": "r.png", "receipt_type": "image/png", "owed_cents": 2500, "note_count": 0 }
```
`status`: `logged` (not asking for money), `requested`, `approved`, `disputed`, `reimbursed`. `owed_cents` is the other parent's share.

#### `POST /api/expenses`
Parent. Body: `{ description, amount, date?, category?, child_ids?, event_id?, other_share_pct?, receipt?, request_reimbursement? }`.
- `other_share_pct` 0-100: the share owed by the parent who did **not** pay. Default `100 - family.default_split` (the payer covers `default_split`), whichever parent paid.
- `receipt`: `{ name, type: "image/png"|"image/jpeg"|"image/gif"|"image/webp"|"image/heic"|"application/pdf", data: "<base64>" }`, under 8 MB. Stored once by SHA-256.
- `request_reimbursement: false` logs it without asking (status `logged`); otherwise `requested` and the co-parent gets `expense_requested`.

→ `{"id":1}`. Errors: 400 `Describe the expense`, `Enter an amount greater than zero`, `Attach an image or PDF`, `File must be under 8 MB`, `Unknown child`.

#### `POST /api/expenses/:id/request`
The parent who paid; status `logged`. → `{"ok":true}`. Errors: 400 `Already requested`; 404.

#### `POST /api/expenses/:id/decide`
The parent who did **not** pay; status `requested` or `disputed`. Body: `{ decision: "approve"|"dispute", note }` (`note` required to dispute). → `{"ok":true}`. Payer gets `expense_decided`.
Errors: 400 `Nothing to decide`, `Decision must be approve or dispute`, `Say why you are disputing it`; 403 `The other parent approves reimbursement`; 404.

#### `GET /api/balance`
Member. → `{ net_cents, pending_to_me, pending_from_me, disputed_cents, unconfirmed_payments }`. `net_cents > 0` means the co-parent owes you; `< 0` means you owe. `unconfirmed_payments` = payments to you awaiting your confirmation.

#### `GET /api/payments`
Member. → `[{ id, family_id, from_user, to_user, amount_cents, date, method, note, expense_ids: number[], status: "sent"|"confirmed"|"disputed", created_at, confirmed_at }]`.

#### `POST /api/payments`
Parent, co-parent must have joined. Body: `{ amount, date?, method? (e.g. "Zelle", max 60), note?, expense_ids? }` → `{"id":1}`. Recipient gets `payment_sent`.
Errors: 400 `Your co-parent has not joined yet`, `Unknown expense`, `Enter an amount greater than zero`.

#### `POST /api/payments/:id/confirm`
The recipient; status `sent`. Body: `{ received?: boolean, note? }` (`received: false` disputes it). → `{"ok":true}`. Confirming marks linked approved expenses `reimbursed`. Sender gets `payment_confirmed`.
Errors: 400 `Already handled`; 404 (also if you are not the recipient).

### Files

#### `GET /api/files/:hash`
Member. Raw bytes of a receipt or note attachment, with its `Content-Type` and `Content-Disposition: inline`. The iPhone app must send the bearer header (e.g. `Image source={{ uri, headers: { Authorization } }}`). Errors: 404.

### Notes (append-only)

#### `GET /api/notes?target_type=&target_id=`
Member. With a target: that item's notes, oldest first. Without: latest 500, newest first.
→ `[{ id, family_id, target_type, target_id, body, author, created_at, attachment_hash, content_hash, attachment_name, attachment_type, author_name }]`.

#### `POST /api/notes`
Parent. Body: `{ target_type, target_id, body, attachment? }`.
`target_type`: `event`, `expense`, `rule`, `call`, `exchange`, `payment`, `call_rule` (with that item's id), `day` (`target_id` = `YYYY-MM-DD`) or `general` (journal; `target_id` = `""`). `body` max 10,000 chars. `attachment` as for receipts. Notes can never be edited or deleted.
→ `{"id":1}`. Errors: 400 `Unknown note target`, `Bad date`, `Write a note`; 404 `Item not found`.

### Messages (append-only)

#### `POST /api/tone-check`
User. Body: `{ text }` → `{ ok: boolean, issues: [{ id, label, tip, matches: string[] }], wordCount }`. Issue ids: `insult`, `profanity`, `absolute`, `blame`, `threat`, `kids`, `sarcasm`, `caps`, `punct`, `long`. Advisory only; sending is never blocked.

#### `GET /api/threads`
Member. → `[{ id, family_id, subject, topic, created_by, created_at, last_at, count, unread }]`, most recent activity first. `unread` counts messages from others you haven't opened. Always `0` for view-only members (they don't record read receipts).

#### `POST /api/threads`
Parent. Body: `{ subject (max 150), topic?: "general"|"schedule"|"expenses"|"school"|"medical"|"activities"|"other", body }` → `{"id":12}`. Creates the thread with its first message; co-parent gets `message`.
Errors: 400 `Add a subject`, `Write a message`.

#### `GET /api/threads/:id`
Member. → `{ thread: { id, family_id, subject, topic, created_by, created_at }, messages: [{ id, thread_id, family_id, author, body, created_at, content_hash, author_name, reads: [{ user: "Jordan", at: "<iso>" }] }] }`.
Side effects (parents only): records a read receipt for every message from the other parent, and marks this thread's `message` notifications read. Errors: 404.

#### `POST /api/threads/:id/messages`
Parent. Body: `{ body }` (max 8,000) → `{"id":34}`. Messages can never be edited or deleted. Co-parent gets `message`.
Errors: 400 `Write a message`; 404.

### Calls and video

#### `GET /api/call-rules`
Member. → `[{ id, family_id, name, entitled_parent, method, count, period, duration_min, window: { days, start, end, only_other_parents_time }, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, retire_requested_by, retire_requested_at, entitled_name, requested_by_name }]`. Statuses as for rules.

#### `POST /api/call-rules`
Parent. Body: `{ entitled_parent, count (1-50), period?: "day"|"week"|"month", method?: "phone"|"video"|"either", duration_min? (0-600, default 15), window?: { days?: [0-6], start?: "HH:MM", end?: "HH:MM", only_other_parents_time? }, name?, reason? }` → `{"id":1}`. Co-parent gets `call_rule_requested`.
Errors: 400 `Choose which parent the calls are for`, `Calls per period must be 1-50`.

#### `POST /api/call-rules/:id/decide` · `/withdraw` · `/retire` · `/retire-decide`
Same bodies, responses and errors as the custody rule versions. Notifications: `call_rule_decided` to the requester; asking to end one sends `call_rule_requested`; deciding that sends `call_rule_decided`.

#### `GET /api/calls`
Member. Latest 500. → `[{ id, family_id, rule_id, child_ids, started_local, duration_min, status, method, details, logged_by, created_at, confirm_result: null|"agreed"|"disputed", confirmed_by, confirmed_at, logged_by_name }]`.

#### `POST /api/calls`
Parent. Body: `{ started: "YYYY-MM-DDTHH:MM", status, rule_id?, method?: "phone"|"video", duration_min?, child_ids?, details? }`.
`status`: `completed`, `short`, `missed_not_facilitated` (child not made available), `missed_not_called`, `declined_by_child`, `rescheduled`, `cancelled`. → `{"id":1}`. Co-parent gets `call_logged`.
Errors: 400 `Enter when the call was (or was supposed to be)`, `Choose what happened`.

#### `POST /api/calls/:id/confirm`
Parent who did not log it. Body: `{ agree: boolean, note? }` → `{"ok":true}`. Logger gets `call_confirmed`.
Errors: 400 `Already answered`; 403 `The other parent confirms this`; 404.

#### `GET /api/calls/compliance?start=&end=`
Member. Default the last 28 days. → per active call rule:
`[{ rule: { id, name, entitled, count, period, duration_min, method, window }, periods: [{ start, end, allowed, completed, short, missed_not_facilitated, missed_not_called, declined_by_child, disputed, outside_window }], totals: { allowed, completed, missed_not_facilitated, missed_not_called, short, disputed, outside_window } }]`.

### Exchanges

#### `GET /api/exchanges`
Member. Latest 500. → `[{ id, family_id, kind, at_ms, scheduled_ms, location, lat, lng, accuracy, child_ids, details, logged_by, created_at, logged_by_name, minutes_late }]`. `minutes_late` is null when no scheduled hand-off was within 8 hours.

#### `POST /api/exchanges`
Parent. Body: `{ kind?: "dropoff"|"pickup"|"no_show_other"|"late_other" (default pickup), at?: "YYYY-MM-DDTHH:MM" (default now, server time), location?, lat?, lng?, accuracy? (metres), child_ids?, details? }` → `{ id, scheduled_ms: number|null }`. Co-parent gets `exchange_checkin`.

### Dashboard

#### `GET /api/dashboard`
Member. →
```jsonc
{
  "now": { "parent": 1 },                    // who has the children right now
  "next_exchange": Transition | null,
  "share_year": Share, "share_ytd": Share,
  "pending": { "rules": 0, "call_rules": 0, "events": 1, "expenses": 0, "payments": 0, "calls": 0, "messages": 2 }, // all 0 for viewers
  "balance": Balance | null,                 // null for viewers
  "upcoming": EventInstance[],               // next 14 days, at most 8 (no note_count)
  "compliance": Compliance[]                 // this week (Monday start)
}
```

### Notifications

#### `GET /api/notifications?limit=50&before=<id>`
User. Your notifications, newest first. `limit` default 50, max 200. `before` returns only ids lower than it (for paging: pass the last id you have). → `Notification[]`.

#### `POST /api/notifications/read`
User. Body: `{ ids: number[] }` or `{ all: true }` → `{"ok":true,"unread":4}`. Only your own notifications are affected; ids that aren't yours are ignored.
Errors: 400 `ids must be an array of notification ids`.

#### `POST /api/push-tokens`
User. Body: `{ token, platform: "ios"|"android" }` → `{"ok":true}`.
`token` must match `^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$` (from `Notifications.getExpoPushTokenAsync()`). Upsert: registering a token another account had moves it to you. The token is tied to the session that registered it, so signing out stops pushes to that device. Call it after every sign-in and app launch.
Errors: 400 `Not a valid Expo push token`, `platform must be 'ios' or 'android'`.

#### `POST /api/push-tokens/remove`
User. Body: `{ token }` → `{"ok":true}`. Only removes the token if it is yours. Call it before signing out.

### Records

#### `GET /api/audit?limit=200`
Member. Newest first, `limit` max 1000. → `[{ id, family_id, seq, ts, user_id, action, entity, entity_id, data: object, prev_hash, hash, user_name }]`. `user_name` is `Deleted user` for anyone who deleted their account (including a former view-only member, who is no longer in `members`).

#### `GET /api/audit/verify`
Member. → `{ ok: boolean, entries: number, head: "<sha256>", problems: string[] }`. `head` is the fingerprint parents should keep.

#### `POST /api/report-link`
Member. Body: `{ start?: "YYYY-MM-DD", end?: "YYYY-MM-DD" }` (default 1 January of this year to today, family time). →
```json
{ "url": "/report?rt=Xoh-z_Q7AXAACASt8hjhdlbbsOkyUBaCSbpWtYfukYI&start=2026-01-01&end=2026-11-27", "expires_at": "2026-11-28T04:23:09.790Z" }
```
A link the iPhone app can open in Safari (`WebBrowser.openBrowserAsync(origin + url)`), which has no session. Valid for 15 minutes and reusable within that time; it opens the report as you.
Errors: 400 `Dates must be YYYY-MM-DD`, `The end date is before the start date`; 403 `Set up or join a family first`.

#### `GET /report?start=&end=[&rt=]`
Member (cookie or bearer), or a valid `rt` from `/api/report-link` instead. Returns the printable HTML report (time share, schedule history, exchanges, calls, expenses, payments, messages with read receipts, notes, integrity check). `end` is inclusive. If `rt` is present it is the only credential considered.
Errors: 401 `{"error":"Sign in required"}` or `{"error":"This report link has expired. Open the report again from the app."}`; 403 (text) `No family`.

### Calendar subscription

#### `GET /ics/<token>.ics?include=custody,events`
Public (the token is the secret). iCalendar feed for Google, Apple and Outlook Calendar: custody blocks ("Kids with me" / "Kids with Sam") and activities, from 90 days ago to 400 days ahead. Get the path from `icsBase` in `/api/me`. The server must be on public HTTPS for Google and Outlook to fetch it.

### Web portal pages

`GET /` and any other extension-less path serve the single-page app from `public/`.

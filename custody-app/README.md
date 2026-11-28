# CoParent Hub

A co-parenting app for two households: custody schedule with approvals, calendar sync, kids' activities, shared expenses and reimbursement, a tone-checked message record, court-ordered call tracking, exchange check-ins, and a printable records report.

Runs on Node.js 22.13+ with **no npm dependencies** (uses the built-in `node:sqlite`).

```bash
cd custody-app
npm start            # http://localhost:3000
npm test             # engine + full two-parent API workflow
```

Environment variables: `PORT` (default 3000), `DB_PATH` (default `data/coparent.db`), `NODE_ENV=production` (adds the Secure cookie flag; required behind HTTPS).

## What it does

| Area | How it works |
|---|---|
| **Custody schedule** | Four layers, lowest to highest: **primary parent** (background default) → **regular pattern** (alternating weekends with optional midweek visit, every weekend, week on/off, 2-2-3, 2-2-5-5, 3-4-4-3, or a custom 1–56 day cycle) → **holidays & periods** (fixed date, Nth weekday, Easter, yearly ranges like summer/winter break, one-off dates; fixed parent or even/odd-year alternation; start/end offsets such as "Wed 6pm to Sun 6pm") → **one-time changes / swaps** (with optional make-up periods). All math runs in the family time zone, so a 6pm exchange stays 6pm across daylight saving changes. A pattern never applies before its start date. |
| **Approvals** | Every schedule item, change request, call schedule and request to end an item is *pending* until the other parent approves. The approver can open **"See impact on time share"** first. Decisions record who, when, and an optional note. Before the co-parent joins, items take effect as **"not yet confirmed"**; the co-parent confirms or disputes them on joining. |
| **Time share** | Hours and overnights per parent for any date range (overnight = who has the children at 2:00 AM). Shown on the dashboard, the calendar (monthly) and the schedule page. |
| **Calendar sync** | **Out:** each parent gets a private subscription URL (custody blocks, activities, or both) that Google Calendar, Apple Calendar and Outlook subscribe to. **In:** paste the secret iCal address of any Google, iCloud, Outlook, TeamSnap or school calendar, and its events show on the calendar (read-only), private to you or shared with the co-parent. |
| **Activities** | Extracurriculars and appointments with repeats, location, driver, cost and children. Each shows whose custody time it falls in and flags when the driver isn't the custodial parent. New or edited activities need the other parent's acknowledgement. |
| **Expenses** | Receipt upload (image/PDF, SHA-256 fingerprinted), per-expense split, approve/dispute (a dispute requires a reason), payments recorded by the sender and confirmed by the recipient, and a running balance. |
| **Notes** | Attach to any schedule item, activity, expense, payment, call, exchange or calendar day, plus free-standing journal entries. Append-only, with optional attachments. |
| **Messages** | Threads by topic. Messages can't be edited or deleted, and read times are recorded. Before sending, a tone check flags name-calling, profanity, always/never statements, blame, threats, using the kids as leverage, sarcasm, all caps and very long messages. The sender can still send anyway; the app never blocks. |
| **Calls & video** | Court-ordered contact rules (N calls per day/week/month, minimum length, allowed days and time window). Either parent logs what happened (completed, cut short, child not made available, parent didn't call, …), the other agrees or disputes, and a per-period compliance table results. |
| **Exchanges** | One-tap check-in at a hand-off with optional GPS. The server timestamps it and computes minutes late against the scheduled exchange. |
| **Records** | Every action goes into a per-family SHA-256 hash chain. Messages and notes are blocked from UPDATE/DELETE at the database level, and their text hashes are cross-checked. The **report** (Records → Open report → Print to PDF) covers time share, the approval history, exchanges, call compliance, expenses, payments, messages with read receipts, notes, and the integrity result. |
| **Roles** | Two parents plus any number of **view-only** members (attorney, mediator, GAL, step-parent) via a separate, rotatable code. |
| **Child info bank** | School, doctor, allergies, medications, sizes and emergency contact per child, shared and change-logged. |

## Limitations (read before relying on this)

1. **Calendar sync is subscription-based, not live two-way sync.** Google refreshes subscribed calendars on its own schedule (often every 8–24 hours, and Google controls it). Apple and Outlook are faster. Events created in Google/Outlook don't write back into this app. True two-way sync needs a registered Google Cloud OAuth app (with Google's verification review for calendar scopes) and a Microsoft Entra app for Microsoft Graph. That is the next big piece of work.
2. **Your subscription URL must be reachable from the internet over HTTPS** for Google or Outlook to fetch it. `localhost` won't work for them, so you have to deploy it first.
3. **"Court-usable" is not the same as "admissible".** The hash chain shows that records weren't changed after the fact, *relative to a fingerprint someone kept*. Whoever controls the server could rebuild the whole chain, so parents should periodically email the fingerprint (shown in Records) to themselves or their attorneys. A court decides admissibility under local evidence rules. Commercial apps courts already order (OurFamilyWizard, TalkingParents, AppClose) have a track record and can supply business-records affidavits; a self-hosted app has neither. Ask your attorney whether your court will accept it.
4. **One schedule per family.** If siblings follow different schedules, that is not modeled yet.
5. **The tone check is keyword-based.** It catches obvious hostility and misses subtle hostility. An AI rewrite suggestion would be better (see roadmap).
6. **No email or push notifications yet.** Parents see pending items when they open the app.
7. **Not yet hardened for public hosting.** Missing pieces: password reset, two-factor login, email verification, and backups. The basics are in place: scrypt password hashing, HttpOnly SameSite cookies, login rate limiting, per-family authorization on every query, a CSP, and an SSRF guard on calendar imports.

## Suggested next features

- **Notifications** (email/SMS/push) for approvals, unread messages and upcoming exchanges, with a 24-hour reminder before each exchange.
- **Google and Microsoft OAuth two-way sync** (see limitation 1).
- **AI-assisted message rewrite** ("make this more neutral") on top of the rule-based check.
- **Per-child schedules**, and **step-parent or new-partner households** as separate homes.
- **Reimbursement deadlines** (e.g. "within 30 days" per the order) with overdue flags, plus **Venmo/Zelle/PayPal deep links**.
- **Child support tracking** alongside reimbursements.
- **Shared document vault** for report cards, medical records and the custody order itself, with expiry reminders for passports and insurance cards.
- **Trade-day bank**: tracks swaps owed in either direction, so make-up time doesn't get lost.
- **Right of first refusal** rule: if the custodial parent will be away more than N hours, the other parent is offered the time first.
- **Holiday calendar import** from the school district's ICS so spring break dates fill in automatically each year.
- **Mobile app wrapper** (PWA install) for faster exchange check-ins.

## Layout

```
server/time.js      time-zone safe date math, holiday date rules
server/schedule.js  custody engine: templates, layering, time share, transitions
server/ics.js       iCalendar reader (TZID, RRULE, EXDATE) and writer
server/tone.js      message tone check
server/db.js        schema, append-only triggers, hash-chained audit log
server/api.js       all endpoints and approval workflows
server/report.js    printable records report
public/             single-page app (vanilla JS, no build step)
test/               engine unit tests + end-to-end two-parent API test
```

# Deploying CoParent Hub

The server in `custody-app/` serves the web portal, the API for the iPhone app, calendar subscription feeds and the printable report. It is one Node.js process with one SQLite file and no npm dependencies.

## Before you start

### HTTPS is mandatory

Run it behind HTTPS on a real domain (e.g. `https://coparent.example.com`) before anyone relies on it:

- **iPhone app**: iOS App Transport Security blocks plain `http://` connections, and App Review expects HTTPS. The app also sends the session token on every request, so it must be encrypted.
- **Web portal**: with `NODE_ENV=production` the session cookie is marked `Secure`, so browsers only send it over HTTPS. Over plain HTTP, sign-in appears to work and then every request is signed out.
- **Calendar subscriptions**: Google Calendar and Outlook only fetch subscription feeds from a public HTTPS URL. `localhost` and private addresses never work for them.
- Messages, receipts and passwords travel in these requests.

All three recipes below give you HTTPS automatically.

### Run exactly one instance

SQLite lives on one disk, and reminders and rate limits run inside the process. Run **one** instance with **one** persistent volume. Do not scale out or enable multi-region replicas. One small instance (256-512 MB RAM) is enough for many families.

### What persists

Everything lives in `DB_PATH` (default `/app/data/coparent.db` in Docker), plus the `-wal`/`-shm` files next to it and `backups/`. Mount a persistent volume at `/app/data`. Without one, every deploy wipes all accounts and records.

Upgrading is safe on an existing database: new tables are created on start (`CREATE TABLE IF NOT EXISTS`). Back up first anyway.

## The Docker image

```bash
cd custody-app
docker build -t coparent-hub .
docker run -d --name coparent -p 127.0.0.1:3000:3000 -v coparent-data:/app/data --restart unless-stopped coparent-hub
curl http://127.0.0.1:3000/healthz   # {"ok":true}
```

- Base `node:22-slim`, `NODE_ENV=production`, data volume at `/app/data`, `HEALTHCHECK` on `/healthz`, `CMD npm start`.
- **Non-root**: the server runs as the image's `node` user (uid 1000). Fly.io volumes and Render disks are mounted owned by root, so the container starts as root only long enough for `server/privileges.js` to hand `/app/data` to `RUN_AS_USER` (`node`). It then permanently switches user before opening the database or the port. If your volume is already writable by uid 1000, `docker run --user node ...` works too and the switch is skipped.
- `docker stop` shuts down cleanly: in-flight requests finish and SQLite closes.
- `.dockerignore` keeps `mobile/`, `test/`, `data/` and `node_modules/` out of the image.

## Recipe 1: Fly.io (volume)

Create `custody-app/fly.toml`:

```toml
app = "coparent-hub-yourname"        # must be globally unique
primary_region = "sjc"               # pick one near you

[build]
  dockerfile = "Dockerfile"

[env]
  # Fly's edge sets Fly-Client-IP to the real client address and overwrites any value the client sent.
  TRUST_PROXY_HEADER = "fly-client-ip"
  # APP_STORE_URL = "https://apps.apple.com/app/id0000000000"
  # TESTFLIGHT_URL = "https://testflight.apple.com/join/XXXXXXXX"

[mounts]
  source = "coparent_data"
  destination = "/app/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"         # reminders run inside the process; keep it running
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "15s"
    interval = "30s"
    timeout = "5s"
    method = "GET"
    path = "/healthz"
```

Then:

```bash
cd custody-app
fly apps create coparent-hub-yourname
fly volumes create coparent_data --region sjc --size 1
fly deploy --ha=false                # one machine: SQLite is single-writer
fly scale count 1
fly certs add coparent.example.com   # optional custom domain; follow the DNS instructions
```

The app is then at `https://coparent-hub-yourname.fly.dev`. Fly also takes daily volume snapshots (`fly volumes snapshots list`). Keep your own backups as well (see Backups).

## Recipe 2: Render (persistent disk)

Persistent disks need a paid instance type. Add `render.yaml` at the repository root (the app lives in `custody-app/`):

```yaml
services:
  - type: web
    name: coparent-hub
    runtime: docker
    rootDir: custody-app
    dockerfilePath: ./Dockerfile
    dockerContext: .
    plan: starter
    numInstances: 1
    healthCheckPath: /healthz
    disk:
      name: coparent-data
      mountPath: /app/data
      sizeGB: 1
    envVars:
      # Render's proxy appends the client address to X-Forwarded-For: TRUST_PROXY=1 reads the right-most entry.
      - key: TRUST_PROXY
        value: "1"
      # - key: APP_STORE_URL
      #   value: https://apps.apple.com/app/id0000000000
```

In the dashboard choose **New → Blueprint**, pick the repository and apply. Or create a **Web Service** by hand with the same settings: Docker runtime, root directory `custody-app`, a disk mounted at `/app/data`, health check path `/healthz`. Render issues the HTTPS certificate for `*.onrender.com` and for custom domains. A service with a disk can't do zero-downtime deploys, so expect a few seconds of downtime per deploy.

## Recipe 3: A plain VPS with Caddy

Any small Linux VPS (1 vCPU, 1 GB) with a DNS `A`/`AAAA` record pointing `coparent.example.com` at it.

1. Install Docker and Caddy (Debian/Ubuntu: `apt install docker.io caddy`, or follow caddyserver.com/docs/install).
2. Run the app on localhost only:
   ```bash
   git clone <your repo> && cd <repo>/custody-app
   docker build -t coparent-hub .
   docker run -d --name coparent --restart unless-stopped \
     -p 127.0.0.1:3000:3000 -v coparent-data:/app/data \
     -e TRUST_PROXY=1 coparent-hub
   ```
3. `/etc/caddy/Caddyfile`:
   ```
   coparent.example.com {
       encode gzip
       reverse_proxy 127.0.0.1:3000
   }
   ```
   `systemctl reload caddy`. Caddy gets and renews the Let's Encrypt certificate itself. Caddy (2.5 and later, without a `trusted_proxies` setting) replaces any `X-Forwarded-For` the client sent with the real client address, so the right-most (only) entry is the client, which is what `TRUST_PROXY=1` reads.
4. Firewall: allow 22, 80 and 443 only (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).

Without Docker: install Node 22.13+, then run `npm start` from `custody-app/` under systemd as an unprivileged user with `Environment=NODE_ENV=production TRUST_PROXY=1 DB_PATH=/var/lib/coparent/coparent.db`.

To update: `git pull && docker build -t coparent-hub . && docker rm -f coparent && docker run ...` (same command as above; the volume keeps the data).

## Client IP behind a proxy

Rate limits (sign-in, sign-up, invite codes) are keyed on the client's IP address. Behind a reverse proxy the TCP peer is the proxy, so the server has to be told where the real address is, and only a value the proxy itself writes can be trusted: whatever a client puts in `X-Forwarded-For` is passed along, so the **left-most** entries can be forged and are never used.

| Where you run | Setting | Why |
|---|---|---|
| Fly.io | `TRUST_PROXY_HEADER=fly-client-ip` | Fly's proxy sets `Fly-Client-IP` and overwrites any client-supplied value. |
| Render | `TRUST_PROXY=1` | Render's proxy appends the address it received the connection from; that right-most entry is the client. |
| VPS with Caddy | `TRUST_PROXY=1` | Caddy replaces the client's `X-Forwarded-For` with the real address (right-most and only entry). |
| nginx | `TRUST_PROXY_HEADER=x-real-ip` with `proxy_set_header X-Real-IP $remote_addr;` (or `TRUST_PROXY=1` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) | nginx writes the address it sees. |
| Two proxies in a row (e.g. a CDN in front of Caddy) | the CDN's client-IP header via `TRUST_PROXY_HEADER` (e.g. `cf-connecting-ip` for Cloudflare), and only if the origin accepts connections from the CDN alone | the right-most `X-Forwarded-For` entry would be the CDN, so every client would share one limit. |
| Clients connect directly | neither | the socket address is used. |

To check: sign in once and look at what the proxy sends (temporarily log `req.headers` in `server/index.js`, or ask the platform's docs). The address used must change when you connect from another network and must not change when you send your own `X-Forwarded-For: 1.2.3.4` header.

The limiter keeps its counters in memory (one server instance), prunes expired entries, and caps itself at 50,000 keys per limit.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `DB_PATH` | `data/coparent.db` (Docker: `/app/data/coparent.db`) | SQLite database file. Must be on persistent storage. |
| `NODE_ENV` | unset (Docker: `production`) | `production` marks the session cookie `Secure` and turns exchange reminders on. |
| `TRUST_PROXY_HEADER` | unset | Name of a header your platform's edge sets to the client address **and overwrites** if a client sends it, e.g. `fly-client-ip` on Fly.io or `x-real-ip` behind an nginx that sets it. Takes precedence over `TRUST_PROXY`. See [Client IP behind a proxy](#client-ip-behind-a-proxy). |
| `TRUST_PROXY` | off | `1`: use the **right-most** `X-Forwarded-For` entry (the one the nearest proxy appended) as the client IP for rate limiting. Set it behind Render or Caddy; leave it off when clients connect directly. |
| `CORS_ORIGINS` | empty | Comma-separated exact origins allowed to call the API from a browser, only for the iPhone app's Expo web preview in development (e.g. `http://localhost:8081`). Leave empty in production; the web portal is same-origin and the native app doesn't need CORS. |
| `PUSH_URL` | `https://exp.host/--/api/v2/push/send` | Expo push service endpoint. |
| `PUSH_DISABLED` | off | `1` stops sending pushes. The in-app inbox still works. |
| `EXPO_ACCESS_TOKEN` | unset | Only needed if "Enhanced Push Security" is on in your Expo project. Sent as a bearer token to the push service. Keep it secret (use the platform's secret store). |
| `REMINDERS` | on when `NODE_ENV=production` | Exchange reminders (24 h and 1 h before each hand-off, swept every 5 minutes). `1` forces on, `0` forces off. |
| `APP_STORE_URL` | unset | App Store link, returned by `GET /api/public-config` so the web portal can show "Get the iPhone app". |
| `TESTFLIGHT_URL` | unset | TestFlight public link, same purpose, for the beta. |
| `ALLOW_PRIVATE_FEEDS` | off | `1` lets calendar imports use `http://` and private-network addresses. Testing only: it turns off the SSRF guard. |
| `RUN_AS_USER` | unset (Docker: `node`) | If the process starts as root, give the database folder to this user and switch to it before doing anything else. |
| `BACKUP_DIR` | `<folder of DB_PATH>/backups` | Where `npm run backup` writes. |
| `BACKUP_KEEP` | `0` (keep all) | `npm run backup` keeps only the newest N backups. |

Booleans accept `1`, `true`, `yes` or `on`.

## Backups

The database holds every message, receipt, note and the audit chain. Back it up, keep copies off the server, and encrypt them (they contain everything).

`npm run backup` makes a consistent copy with SQLite `VACUUM INTO` while the server keeps running, checks it with `PRAGMA integrity_check`, and writes `data/backups/coparent-<UTC timestamp>.db` (e.g. `coparent-20261128T153000Z.db`). Never copy the live `.db` file with `cp`: it can catch a half-written state and misses the `-wal` file.

| Where | Make a backup | Get it off the server |
|---|---|---|
| Docker / VPS | `docker exec coparent npm run backup` | `docker cp coparent:/app/data/backups ./backups` |
| Fly.io | `fly ssh console -C "sh -c 'cd /app && RUN_AS_USER=node npm run backup'"` | `fly ssh sftp get /app/data/backups/coparent-<stamp>.db` |
| Render | Shell tab: `cd /app && RUN_AS_USER=node npm run backup` | download over SSH (`scp`) from the service |
| No Docker | `npm run backup` in `custody-app/` | any file copy |

Nightly on a VPS (root crontab), keeping two weeks:

```cron
17 3 * * * docker exec -e BACKUP_KEEP=14 coparent npm run backup --silent && docker cp coparent:/app/data/backups /srv/coparent-backups
```

Then sync `/srv/coparent-backups` to off-site storage (restic, rclone, Backblaze B2, S3...).

**Restore**: stop the app, replace `coparent.db` in the data volume with the backup file, delete `coparent.db-wal` and `coparent.db-shm`, start the app, sign in and open Records → integrity check (`GET /api/audit/verify` should say `ok: true`). Practise a restore once before you need it.

Parents should also keep the audit fingerprint shown in Records (emailed to themselves or their attorney). It shows the records weren't changed after the fact.

## Pointing the iPhone app at the server

The app lives in `custody-app/mobile/` (Expo / React Native). See `mobile/README.md` for building and submitting it. For the server side:

1. **Deploy first** and note the HTTPS origin, e.g. `https://coparent.example.com` (no trailing slash, no `/api`).
2. **Set the URL for builds**: in `mobile/eas.json`, replace `https://REPLACE-WITH-YOUR-SERVER` in each build profile's `EXPO_PUBLIC_API_URL`. The app reads `EXPO_PUBLIC_API_URL` first, then `expo.extra.apiUrl` in `mobile/app.json`.
3. **Local development**:
   - On a phone with Expo Go or a dev build: `EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:3000 npx expo start`, with the server running on that computer (`npm start`). `localhost` on the phone means the phone itself.
   - Expo web preview in a desktop browser: start the server with `CORS_ORIGINS=http://localhost:8081 npm start`.
4. **Push notifications** need:
   - an EAS project (`cd mobile && eas init`, which fills in `expo.extra.eas.projectId`),
   - an Apple Developer account and an APNs key (`eas credentials`, or let `eas build` create one),
   - a physical iPhone (the simulator can't get pushes),
   - a deployed HTTPS server. The server only needs outbound HTTPS to `exp.host`; set `EXPO_ACCESS_TOKEN` only if you enabled enhanced push security.
5. **Link the web portal to the app**: set `APP_STORE_URL` (and `TESTFLIGHT_URL` during the beta).
6. **Check it**: sign in on the phone, then from another account send a message. The phone should get a push, and the badge should match `unread_notifications` from `GET /api/me`.

The API the app uses, including the bearer-token flow and notification links, is in [API.md](API.md).

## Health and monitoring

- `GET /healthz` returns `{"ok":true}` after checking the database. All three recipes use it.
- Logs go to stdout/stderr (`docker logs coparent`, `fly logs`, Render's Logs tab). Push failures are logged and never affect requests.

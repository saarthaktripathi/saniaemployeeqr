# Deployment

> **Status: not deployed.** No hosting, database, DNS or domain has been created or purchased. Everything below is a proposal awaiting the owner's approval.

## What the app needs from a host

- A **long-running Node.js 22+ process** (SSE streams stay open; the real-time hub keeps one `LISTEN` connection to PostgreSQL).
- Managed **PostgreSQL** with backups (a direct, non-pooled connection is needed for `LISTEN`).
- HTTPS + custom domain, secret storage, health checks (`/api/health` liveness, `/api/ready` readiness).
- A daily scheduled job: `npm run maintenance:retention`.

## Platform comparison

Prices were read from the official pricing pages on **2026-10-29** and are USD. Items marked *unverified* must be confirmed in the provider console before committing.

| | **Render** (recommended) | Railway | Vercel | AWS (App Runner/ECS + RDS) |
| --- | --- | --- | --- | --- |
| Next.js 16 server | Native Node web service | Native (Nixpacks/Docker) | Native, serverless functions | Container |
| Long-lived SSE + `LISTEN` | Yes (persistent process) | Yes (persistent process) | Poor fit: functions have max durations and no persistent `LISTEN`; would need a managed pub/sub | Yes |
| PostgreSQL | Managed Render Postgres | Railway Postgres (container + volume) | External (e.g. Neon) | RDS |
| Region near India | Singapore (third-party sources; no India region) — *confirm in console* | Asia region — *unverified* | Mumbai functions available — *unverified* | Mumbai (ap-south-1) |
| Free tier usable? | No: free web services sleep after 15 min idle; free Postgres **expires after 30 days** | Free: 0 custom domains | Hobby is **non-commercial only** | Free tier only 12 months |
| Small production estimate | Web <1 CPU/512 MB **$7** + Postgres 256 MB **$6** (1 GB storage incl.; extra $0.30/GB) ≈ **$13/mo** on the $0 Hobby workspace; Postgres 1 GB RAM tier $19 → ≈ $26/mo | Hobby **$5/mo** incl. $5 usage; CPU ≈ $20/vCPU-mo, RAM ≈ $10/GB-mo, volume $0.15/GB → app 0.5 GB + DB 0.5 GB ≈ **$10–15/mo** (estimate) | Pro **$20/mo** + external DB (Neon pricing *unverified*) | ≈ $40–80/mo *(estimate, not verified)* |
| Higher traffic | Web 1 CPU/2 GB $25, Postgres 1 CPU/2 GB $40, Pro workspace $25 → ≈ $90/mo | Pro $20/workspace + usage | Usage-based | Scales furthest; most operational work |
| Custom domain + TLS | Yes, automatic certificates | Hobby: 2 domains | Yes | Yes (ACM) |
| Backups | Paid Postgres backups / PITR — *confirm retention per plan* | Volume backups — *confirm* | Depends on DB vendor | RDS automated backups |
| Ops complexity / lock-in | Low / low (plain Node + Postgres) | Low / low | Low / medium | High / medium |

**Recommendation: Render**, Singapore region, Node web service ($7) + paid Render Postgres ($6–19) — roughly **$13–26 per month** for a small company. Reasons: persistent process (real-time works as designed and tested), managed Postgres with backups, simplest setup, plain Node + Postgres so moving to AWS later is straightforward. Railway is a close second (similar cost, usage-based billing is less predictable). Vercel is not recommended because of the SSE/`LISTEN` model, and its free plan forbids commercial use.

Open points to confirm in the Render console before purchase: Singapore availability for both services, backup retention on the chosen Postgres plan, and that the Hobby workspace terms suit company use.

## Domain

Registry RDAP lookups on 2026-10-29 found **no existing registration** for any of:

| Domain | Registry | Lookup result |
| --- | --- | --- |
| `saniaemployees.com` | Verisign | not registered (HTTP 404; control `google.com` → 200) |
| `saniaemployees.in` | NIXI (.IN registry) | not registered (404; control `google.co.in` → 200) |
| `saniaemployees.co.in` | NIXI | not registered (404) |

"Not registered" is not a guarantee of purchase: availability, premium status and price are confirmed only at a registrar's checkout. Prices vary by registrar (typical .com and .in first-year prices are low, but renewals cost more — check the **renewal** price). Prefer a registrar with free WHOIS privacy and DNSSEC (e.g. Cloudflare Registrar sells .com at cost; .in must be bought from an accredited .IN registrar).

**Domain vs subdomain:** `saniaemployees` alone is not a domain — it needs a top-level domain (`saniaemployees.com`). Once you own a domain you can create unlimited subdomains for free, e.g. `verify.saniaemployees.com` for QR links and `hr.saniaemployees.com` for the dashboard (both can point to the same app). The QR codes embed `APP_BASE_URL`, so **choose the final domain before printing ID cards**.

## Free-tier trial deployment (chosen for now)

The owner chose to start on free tiers for a small number of users, with a free subdomain, and to move to paid plans later.

| Piece | Service | Free-tier limits (official pages, 2026-10-29) |
| --- | --- | --- |
| App | Render free web service, Singapore (`render.yaml`) | Sleeps after **15 min** without inbound traffic; next request waits **~1 minute** while it wakes. 750 instance-hours/month per workspace. Render: "Do not use them for production applications." |
| Database | **Neon** free Postgres (permanent, no card) — choose region *AWS Asia Pacific (Singapore)* | 1 GB storage, **100 compute-hours/month**, suspends after 5 min idle, restore history 6 h, 1 manual snapshot |
| Domain | `https://<service>.onrender.com` | Free, HTTPS included. No free real domain is recommended (free-domain registries are unreliable) |

Render's own free Postgres is **not** used: it is deleted 30 days after creation.

What this means in practice:
- The first QR scan or login after a quiet period takes about a minute. Later requests are fast.
- Live dashboard updates work while the app is awake. Background tabs release their stream after a minute, and the server releases its database listener 30 s after the last dashboard closes, so Neon can sleep and stay within 100 compute-hours.
- Backups are minimal (6 h history). Export the directory (CSV) regularly until you move to a paid database.
- **QR codes embed the onrender.com address.** Before printing ID cards for real use, move to the final domain and reissue credentials.

Steps (accounts must be created by the owner; nothing is paid):
1. Neon → create a project (Postgres 17+, Singapore) → copy the **direct** connection string (host without `-pooler`).
2. Render → **New + → Blueprint** → connect GitHub → select this repository. Render reads `render.yaml`.
3. Enter the prompted values: `DATABASE_URL` (Neon string), `APP_BASE_URL` (`https://sania-employees.onrender.com`, or the URL Render shows if that name is taken), `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD` (12+ chars). The three secrets are generated automatically.
4. Deploy. The start command applies migrations and creates the owner once.
5. Open the URL, sign in, enrol MFA (Account Security), then delete `OWNER_PASSWORD` in Render → Environment.
6. If the final URL differs from `APP_BASE_URL`, fix the variable and redeploy before issuing QR codes.

Upgrading later: switch the Render plan to Starter ($7) and Neon to a paid plan or Render Postgres — no code changes.

## Deployment plan (paid production, after approval)

1. **Code hosting:** commit and push to the existing GitHub repository (`origin`). Render deploys from GitHub on every push to `main` after CI passes.
2. **PostgreSQL:** create Render Postgres (Singapore, paid plan, backups on). Create a second, non-owner role for the app if the plan allows (protects the audit trigger).
3. **Web service:** Node, Singapore.
   - Build: `npm ci && npm run build`
   - Pre-deploy / start: `npm run db:deploy && npm start`
   - Health check path: `/api/ready`
4. **Environment variables** (Render secret env vars; generate fresh values — never reuse local ones):
   `DATABASE_URL` (internal URL), `DATABASE_DIRECT_URL` (same, non-pooled), `APP_BASE_URL=https://<final-domain>`, `BETTER_AUTH_SECRET` (`openssl rand -base64 48`), `CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`, **back it up securely** — losing it means QRs can't be re-displayed, only reissued), `IP_HASH_SECRET`, `LOG_LEVEL=info`, `NODE_ENV=production`.
5. **Migrations:** run automatically by `db:deploy` (non-destructive `prisma migrate deploy`; never `migrate reset` in production).
6. **First owner:** Render shell → `OWNER_EMAIL=… OWNER_NAME=… OWNER_PASSWORD=… npm run owner:create`; sign in, enrol MFA.
7. **Custom domain + HTTPS:** add domain in Render; at the registrar create the records Render shows (typically `CNAME verify → <service>.onrender.com`, apex via `A`/`ALIAS`); Render issues the TLS certificate.
8. **Retention job:** Render Cron Job (daily) running `npm run maintenance:retention` — *price to confirm* — or a scheduled GitHub Action.
9. **Smoke tests:** `/api/health` 200, `/api/ready` 200, login, create test employee, issue QR, scan from a phone, deactivate → scan shows Inactive, revoke → Revoked, archive test employee.
10. **Monitoring:** Render logs + metrics; set an uptime check on `/api/ready`; optional error tracking via `ERROR_MONITORING_DSN` integration point.
11. **Rollback:** Render "rollback to previous deploy"; migrations are additive — write a forward fix rather than reverting schema. Take a manual DB snapshot before any migration that alters existing columns.
12. **Backup validation:** after day one, restore the latest backup into a new temporary database, run `npx prisma migrate status` and spot-check counts, then delete it. Repeat quarterly.

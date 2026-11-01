# Security

This document describes what the platform protects, the threats considered, the controls implemented, and what is **not** yet assured. It is not a certification: automated tests are not a substitute for a professional penetration test before handling real employee data.

## Assets

1. Employee personal data (names, work email, phone, job details).
2. Credential tokens (anyone holding one can see that employee's public status).
3. HR/owner accounts and sessions (full control of records and credentials).
4. Audit trail integrity.
5. Secrets: `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `IP_HASH_SECRET`, database credentials.

## Trust boundaries

| Boundary | Untrusted side | Controls |
| --- | --- | --- |
| Internet → public verification | Anyone with or guessing a URL | 256-bit tokens, hash lookup, allow-listed fields, per-client rate limit, `no-store`/`no-referrer`/`noindex` |
| Browser → dashboard/API | Authenticated but possibly malicious HR users; CSRF from other sites | Server-side permission check in every service function, Zod strict schemas, Origin check on mutations, SameSite cookies |
| App → database | — | Parameterized queries only (Prisma / tagged templates); least-privilege DB user recommended (see Deployment) |
| SSE stream | Authenticated users | Auth required, per-event permission scope, ids-only payloads, periodic session re-check |

## Threats and mitigations (OWASP-oriented)

| Threat | Mitigation | Verified by |
| --- | --- | --- |
| Broken access control / IDOR | Permission checks inside services (not just UI); UUID ids; denied attempts audited (`authz.denied`) | Integration tests per role; e2e direct-API calls as HR Staff |
| Privilege escalation via mass assignment | `.strict()` Zod schemas; role/status/code/version never accepted from create input; `extraPermissions` limited to a grantable allow-list | Unit tests (unknown keys rejected); permission tests |
| SQL injection | Prisma parameterization; raw SQL only via tagged templates; LIKE wildcards escaped | Malformed/injection tokens test; `%` search test |
| XSS | React escaping; no user HTML rendered; only server-generated QR SVG uses `dangerouslySetInnerHTML`; CSP with per-request nonce and `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'` | e2e header test |
| CSRF | SameSite=Lax HTTP-only cookies; mutations require `Origin` equal to `APP_BASE_URL`; Better Auth origin checks | Unit + smoke tests (cross-origin POST → 403) |
| Brute force / credential stuffing | Login 5/min, TOTP 5/min (DB-backed, shared across instances); Argon2id (m=19 MiB, t=2); 12+ char passwords | Smoke tests |
| Account enumeration | Identical error for unknown email and wrong password; failed-login audit stores only `knownAccount` | e2e |
| Session theft / fixation | HTTP-only, Secure (production), SameSite cookies; 8 h expiry; sessions revoked on role/permission/password change and on disable; sign-out invalidates server-side | e2e cookie-replay test; integration test |
| Disabled user keeps access | Role/status re-read from DB on every request; session creation blocked for disabled users | Integration test |
| Credential guessing/enumeration | 2^256 token space; verification rate-limited per IP hash; unknown and malformed tokens reveal nothing; no listing endpoint is public | Integration tests |
| Token leakage | Only SHA-256 hash + AES-GCM ciphertext stored; ciphertext erased on revocation; logger redacts token/cookie/password keys; `Referrer-Policy: no-referrer` on verify pages | Unit tests |
| Sensitive data in errors | Central error mapper returns generic 500 + request id; details only in server logs | Unit test |
| CSV/formula injection | Export cells starting with `= + - @` are prefixed with `'`; phone never exported | Integration test |
| Malicious image uploads | Photo uploads require `employee:update` (or `employee:create` for records you created); declared type must be JPEG/PNG/WebP; content is decoded by `sharp` with a pixel limit, size ≤ 5 MB, min 128 px; re-encoded to WebP, which drops EXIF/GPS and any embedded payload; served with `nosniff`, `default-src 'none'` CSP and `private` caching | Integration + e2e tests |
| Photo enumeration | HR photo API needs a session and `employee:read`. The public page never exposes a photo URL — the image is inlined only after the opaque QR token resolves, and only if System Rules allow it | Integration test |
| DoS via large/expensive requests | 64 KB JSON / 1 MB CSV body limits; page size ≤ 100; query length ≤ 100; 15 s statement timeout; bulk ≤ 200/500 rows; rate limits on creation, issuance, bulk, export | Unit tests |
| Audit tampering | DB triggers block UPDATE/DELETE on `audit_log`; purge requires `SET LOCAL app.audit_purge='on'` | Integration tests |
| Open redirect / SSRF | No user-controlled redirects; no server-side URL fetching | Design |
| Host header poisoning | QR/verification URLs built from configured `APP_BASE_URL`, never the request host | Design |

## Known limits and residual risks

- **Database-level immutability is limited.** A database superuser or the table owner can disable the audit trigger. In production, run the app with a role that does not own the tables (see Deployment), and stream logs to a separate store if tamper-evidence matters legally.
- **Client IP comes from `X-Forwarded-For`.** This is correct only behind a reverse proxy that overwrites the header (Render, Railway, Vercel, AWS ALB do). Exposing the Node server directly would let clients spoof IPs and evade per-IP verification limits.
- **The verification token is in the URL path.** Hosting access logs may record it. Treat platform logs as sensitive, or revoke and reissue a credential if logs leak.
- **A valid QR proves record status, not identity.** Someone holding another employee's printed ID will verify as that employee. The public page says so; high-assurance uses need a photo ID check.
- **MFA is enforced only when "Require MFA" is on** (default on; off in the local demo seed). Recovery for lost authenticators = owner resets the password and the user re-enrols; backup codes are shown once.
- **No email flows yet** (password reset, verification). Owners reset passwords manually. If email is added, tokens must be single-use and expiring.
- **`style-src 'unsafe-inline'`** is allowed (toast library, inline style props). Scripts are nonce-locked.
- **Dependencies**: `npm audit --omit=dev` reported 0 known vulnerabilities on 2026-10-29. Re-run in CI on every change.

## Operational requirements before production

1. Generate fresh secrets in the host's secret store (never reuse local `.env`).
2. HTTPS only (`APP_BASE_URL` must be `https://` — enforced at startup).
3. Create the first owner with `npm run owner:create`; enrol MFA immediately.
4. Keep "Require MFA for privileged users" on.
5. Schedule `npm run maintenance:retention` daily.
6. Enable automated database backups and test a restore (see Deployment).
7. Commission an external penetration test before loading real employee data at scale.

## What was tested vs not

**Tested automatically:** cross-role access (service + HTTP + UI), direct API bypass, malformed/unknown/expired/revoked tokens, injection-shaped input, oversize bodies, rate limits (verification), CSRF origin checks, unauthenticated SSE, session invalidation on sign-out, audit immutability, data minimization in public responses and events.

**Not tested:** real-world attacker tooling (DAST/fuzzing), TOTP enrolment via a real authenticator in e2e, multi-instance deployment, behaviour under network partitions, infrastructure configuration of the eventual host.

## Reporting

Report suspected vulnerabilities privately to the company owner; do not open public issues.

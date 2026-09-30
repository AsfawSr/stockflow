# StockFlow

A multi-tenant inventory and procurement platform built with Next.js, NestJS,
and PostgreSQL.

## Purpose

Help businesses track stock across locations, manage suppliers and purchase
orders, approve purchases, and record deliveries with an auditable inventory
history.

## Architecture

- `apps/web`: Next.js frontend with TypeScript and the App Router.
- `apps/api`: NestJS modular monolith for permissions and business workflows.
- PostgreSQL and Prisma 7: persistence with organization, user, and membership models.
- npm workspaces: one repository and one root dependency lockfile.

## Requirements

- Node.js 22.12 or newer in the 22.x line, or Node.js 24+ (verified with Node.js 24).
- npm 10 or newer (initial setup uses npm 11).
- A running PostgreSQL server and an existing database.

## Database Configuration

Create `apps/api/.env` using `apps/api/.env.example` as a reference. Set
`DATABASE_URL` to your PostgreSQL connection URL with the correct host, port,
database, username, and password. URL-encode special characters in credentials.
The example targets `stockflow` on `127.0.0.1:5432`; replace its password placeholder.
Real environment files are ignored by Git and must never be committed.

The API requires `DATABASE_URL` at startup and opens database connections lazily.
This allows liveness to remain available during a database outage. The database
pool has bounded connection and statement timeouts and closes on application shutdown.
Prisma connections use UTC explicitly. This avoids timestamp decoding offsets when
PostgreSQL's server timezone differs, including incorrect session-expiry decisions.
The default `postgres` account is suitable only for initial local setup; use a
dedicated, least-privilege database account before deployment.

The initial migration creates `organizations`, `users`, `memberships`, and the
`organization_role` enum. Run `npm run db:migrate` to apply committed migrations
to the configured database and `npm run db:status` to inspect migration history.
The first migration expects no conflicting tables or enum. For an existing schema,
review and baseline it before migrating; never reset a database to bypass a conflict.
The migration is transaction-wrapped and does not seed any application records.
The second migration adds separate `password_credentials` and `sessions` tables
without changing existing users or memberships.
The third adds `account_tokens`, email verification state, and credential versions.
Existing users remain unverified until they complete verification or password reset;
the migration does not silently verify any account.

Prisma's CLI is a root development dependency shared by the workspace scripts.
The generated client is ignored by Git and regenerated before API builds, tests,
type checks, and development startup.

## Identity Data Model

- `Organization`: company name, one currency, UUID, and timestamps.
- `User`: global unique email, display name, UUID, and timestamps. A user can belong
	to several organizations. Password hashes are stored in a separate credential table.
- `Membership`: links one user to one organization with an explicit, non-empty set
	of roles: `ADMIN`, `PURCHASER`, `MANAGER`, and `WAREHOUSE`. There is no default role.

PostgreSQL rejects duplicate memberships, missing parent records, blank names,
null or duplicate roles, and deletion of users or organizations with memberships.
Emails must be non-empty, lowercase, whitespace-free, and unique. This is a storage
normalization rule, not full email validation or proof of email ownership.
Currency codes must be three uppercase letters; the organization API also validates
them against ISO 4217 through `class-validator`.

Custom checks live in the SQL migration because Prisma does not express them in
the model schema. Preserve these checks in future migrations. Adding a role also
requires updating the `memberships_roles_valid_set` check, which uses the enum's
four current values. Use migrations, not `prisma db push`, to reproduce the schema.
UUID defaults and `updatedAt` updates are handled by Prisma Client.

These relationships alone do not enforce request-level permissions. Organization
API routes additionally use current membership guards and scoped database queries.

## Authentication API

All endpoints are under `/api`. Routes require a bearer session by default;
registration, login, email-link confirmation, reset requests, liveness, and readiness
are explicitly public.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/auth/register` | Create a user and a session atomically; returns 201. |
| POST | `/auth/login` | Check credentials and issue a new session; returns 200. |
| GET | `/auth/me` | Return the user's id, email, display name, and `emailVerifiedAt`. |
| POST | `/auth/logout` | Revoke the current session immediately; returns 204. |
| POST | `/auth/email/verification` | Authenticated resend request; returns 200, or 503 on delivery failure. |
| POST | `/auth/email/verify` | Consume `{ token }` and verify its account; returns 200. |
| POST | `/auth/password/reset-request` | Accept `{ email }`; always returns the same 202 message for known/unknown accounts. |
| POST | `/auth/password/reset` | Consume `{ token, password }`, replace credentials, and revoke sessions; returns 200. |

Registration accepts only `email`, `displayName`, and `password`; login accepts only
`email` and `password`. Emails are trimmed and lowercased. New passwords must contain
12-128 characters; they are never trimmed. Passwords use Argon2id with 64 MiB memory,
three iterations, and parallelism one. Unknown-user login verifies a dummy hash and
returns the same 401 response as a wrong password. Duplicate registration returns
409 and does not claim an existing user or change their credentials.

Registration and login return `{ user, accessToken, expiresAt }`; registration also
reports `verificationEmailSent`. Email failure leaves the created account unverified
and allows a later resend. Send the session token only
in `Authorization: Bearer <accessToken>`, never a URL. Tokens have 256 bits of entropy,
expire after eight hours, and are stored only as SHA-256 digests. These are opaque,
revocable sessions, not JWTs. Responses are marked `Cache-Control: no-store`.
Expiry is enforced on every authenticated request; a new login is required after
expiry. Logout affects only the current session. Existing users without a password
credential cannot log in or be taken over through registration.

Registration and login are limited to five attempts per minute per IP and route;
other API routes are limited to 120 per minute. Health checks are exempt. These
counters are in memory for the current single-process deployment; production scaling
requires shared rate-limit storage and a carefully configured trusted proxy.

The Next.js interface uses server actions and HTTP-only session cookies; bearer
tokens are never returned to client components or stored in localStorage.
Use HTTPS outside local development. Signed-in password changes, scheduled expired
record cleanup, shared rate limiting, and production mail monitoring are still
required before public deployment. Registration alone does not prove email ownership;
organization access requires completing an email link. Its conflict response can
still reveal account existence.

## Verification and Recovery Email

New accounts are redirected to `/verify-email`, which allows resend and sign-out.
Verification links expire after 24 hours; reset links expire after 30 minutes. Only
SHA-256 token digests are stored in the database. Each link is bound to its purpose,
user, email address, and credential version. Completing verification invalidates
other verification links. Reset changes the password, verifies control of the email,
deletes existing sessions and outstanding account links, and increments the credential
version. A login already in flight with the old password cannot create a usable session.
Concurrent token claims are serialized and tested using real PostgreSQL transactions.

Links use URL fragments, which are not sent with the page GET request. The frontend
removes the fragment from the address bar after loading and submits the token only
after explicit form confirmation. GET requests do not consume links. Tokens and
passwords are not returned in action error state, and recovery pages set no-referrer
and no-index metadata. Missing, expired, reused, and wrong-purpose links are rejected.
Resends/reset requests are limited to three per minute per IP and route; reset
confirmation is limited to five, and verification confirmation to ten.

Development defaults to `MAIL_TRANSPORT=file`. Messages are saved as private local
JSON files under `apps/api/.local/mail`, never served by an HTTP endpoint. After signup
or a reset request, open the generated message and use its `actionUrl` in the browser.
These files contain live bearer links: keep the directory private and delete messages
after testing. Git ignores the entire directory. No external email is sent in this mode.

For SMTP, configure the API's ignored environment file using `.env.example`:

```dotenv
NODE_ENV=production
WEB_ORIGIN=https://stockflow.example.com
MAIL_TRANSPORT=smtp
MAIL_FROM=StockFlow <no-reply@your-domain.example>
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
```

Use real provider credentials only in local/server environment configuration, never
in Git or chat. Port 465 uses implicit TLS; other ports require STARTTLS. Production
rejects file delivery and requires an HTTPS `WEB_ORIGIN`. Links are built from that
configured origin, not client headers. Real SMTP delivery has not been exercised in
the local test suite. Mail sending is currently synchronous: reset responses conceal
account existence in their body, but timing differences can remain. Before public
launch, add a durable mail queue, retry/monitoring, and appropriate abuse controls.

## Frontend Account Workflow

- `/` opens sign-in or the last selected organization, with access checked by NestJS.
- `/login` and `/signup` include validated fields, password visibility controls,
	matching password confirmation, pending states, and safe API error messages.
- `/organizations` lists only current memberships, supports name search, and creates
	organizations with a currency selected from the platform's supported currencies.
- `/workspace/:organizationId` shows the real organization and current roles.
	Admins can rename the organization and inspect its members; other members cannot.
- `/status` remains public and displays web, API, and PostgreSQL health.
- `/verify-email` gates unverified accounts; `/verify-email/confirm` consumes email links.
- `/forgot-password` requests recovery; `/reset-password` accepts a new password from a valid link.

Authentication cookies are HTTP-only, SameSite=Lax, and expire with the API session.
Production uses Secure cookies with `__Host-` names and requires HTTPS; local
`next dev` uses unprefixed cookies over HTTP. The selected-organization cookie is
only a navigation preference: every selection and workspace request revalidates
membership with the API. It never grants authorization by itself.

Only Next.js server code sends bearer tokens to NestJS. Server actions use Next.js's
same-origin checks; do not broaden allowed origins without reviewing the deployment.
Upstream requests are uncached, have bounded timeouts, reject redirects, and validate
response shapes. API error bodies are not exposed to users. An unavailable API keeps
the session cookie and offers retry, whereas a 401 sends the user to sign-in.
Logout clears local cookies even if the API is down and warns when revocation could
not be confirmed. No password or token is included in form error state.

Server-to-server requests currently share the Next.js server's source IP for NestJS
rate limiting. Before public deployment, add trusted-ingress client attribution and
appropriate shared/per-client abuse limits; do not blindly trust forwarded headers.
Production mail reliability and the hardening items above remain outstanding.
No simulated inventory screens are presented in this milestone.

## Organization Access

Every organization route requires a valid bearer session and verified email. The identity comes from
the server-side session, never a submitted user id. A user selects an organization
using its URL id; arbitrary headers cannot change the authorization scope.

| Method | Path | Required access |
| --- | --- | --- |
| GET | `/organizations` | Lists only the caller's organizations and roles. |
| POST | `/organizations` | Any verified authenticated user; creates their `ADMIN` membership atomically. |
| GET | `/organizations/:organizationId` | Current membership in that organization. |
| PATCH | `/organizations/:organizationId` | Current `ADMIN` role; renames the organization only. |
| GET | `/organizations/:organizationId/members` | Current `ADMIN` role; returns safe member profiles and roles. |

Create accepts only `name` and `currency`; rename accepts only `name`. Clients cannot
assign themselves roles, provide an owner id, or change currency through rename.
Unknown body properties are rejected rather than silently used. The current
collection endpoints return complete lists; pagination is needed before large-scale use.

Membership and roles are read from PostgreSQL for each organization request and are
not stored in access tokens. An admin role in one organization grants no access to
another. Revoking membership or changing roles takes effect on subsequent requests
without requiring logout. Missing membership returns 404; insufficient permissions
for an existing member returns 403. Missing, expired, or revoked authentication
returns 401. Organization reads and writes also include membership conditions in
their database queries, including the admin requirement on updates and member lists.

The creator is the initial admin. Invitations, adding/removing members, role-change
APIs, and last-admin protection are not exposed yet; tests change membership records
directly to verify authorization behavior. There is no global administrator role.
Future inventory and purchasing endpoints must apply these guards and scope every
query by the authenticated membership; the current guards do not automatically
secure arbitrary future queries, exports, or background jobs. PostgreSQL row-level
security is not configured in this milestone.

## Local Development

Run these commands from the repository root:

```sh
npm install
npm run db:migrate
npm run dev:api
```

In a second terminal, also from the repository root:

```sh
npm run dev:web
```

Open `http://127.0.0.1:3000` to sign in or create an account, then create or select an
organization after verification. In development, use the verification message in
`apps/api/.local/mail`. `http://127.0.0.1:3000/status` remains the system-status screen, with
fresh server-side checks on refresh.

The API runs at `http://127.0.0.1:3001`. `GET /api/health` returns
`{"status":"ok","service":"stockflow-api"}`. This is a liveness check independent
of database availability. `GET /api/health/ready` executes `SELECT 1` through Prisma
and returns `{"status":"ok","service":"stockflow-api","database":"connected"}`.
It returns HTTP 503 with `database: "unavailable"` on connection or query failure,
without exposing connection strings or database error details.
The API port can be overridden with the `PORT` environment variable.

To override the API address, create `apps/web/.env.local` using
`apps/web/.env.example` as a reference and set `API_BASE_URL`. This is a server-only
setting; it does not need a `NEXT_PUBLIC_` prefix. Restart Next.js after changing it.
Both development servers bind to the local machine only.

## Verification

```sh
npm run db:validate
npm test
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs these checks on Node.js 22 and 24 for pull requests and pushes
to `main`. Each matrix job starts an isolated PostgreSQL 17 service, applies the
committed migrations, and runs `npm run test:db` against it. The service credentials
are disposable test values, not development or production secrets.
The workflow does not deploy either application. Local checks have been run with
Node.js 24; the Linux/PostgreSQL 17 matrix will be verified by GitHub after push.

The API tests exercise liveness, readiness success and failure, error redaction,
and the route prefix. They mock the Prisma provider and do not require PostgreSQL
or local credentials, so CI does not need access to your development database.
Frontend tests cover healthy, unavailable, failed HTTP, wrong-service, and malformed
JSON responses. Lint currently covers the frontend; type checks cover both apps.

Run real PostgreSQL integration tests separately against a local development or
dedicated test database, never production:

```sh
npm run db:migrate
npm run test:db
```

The `.db-spec.ts` tests are excluded from `npm test`. They verify Prisma mappings,
memberships across organizations, uniqueness, foreign keys, role sets, normalization,
restricted deletes, real Argon2 verification, expiry, and logout revocation over HTTP.
They also verify cross-tenant denial, admin-only actions, request-field spoofing,
and live permission changes using the same session token. Recovery coverage includes
purpose binding, expiry, replay, generic responses, mail failures, session versioning,
and concurrent token consumption. Most fixture writes run in rollback transactions;
the concurrency test commits a uniquely identified temporary user and deletes it in
`finally`. The tests neither reset nor truncate tables. Unit/database tests capture
emails in memory instead of contacting SMTP.

For the persistent browser workflow test, install Chromium once and run:

```sh
npm exec --workspace=@stockflow/web -- playwright install chromium
npm run test:e2e
```

Playwright starts or reuses local servers on ports 3000 and 3001. Use a development
or test database with migrations applied and `MAIL_TRANSPORT=file`, never production
or external SMTP. It verifies signup, verification/resend, reset and replay rejection,
login, logout, expiry, cookie privacy, cross-origin action rejection, organization
creation/selection/renaming, and permission revocation. It checks desktop, tablet,
and mobile widths, including long organization names, and saves ignored screenshots
under `apps/web/test-results`. Browser fixture records are committed during the
workflow, then removed in `afterAll` using unique run-specific names and ids; the
cleanup refuses organizations with non-test members. It never resets or truncates
the database. It also deletes only outbox files matching its own test recipients.
Browser tests are opt-in and separate from `npm test` and `test:db`.

ESLint stays on 9.39.x for compatibility with the React plugin shipped by the current
Next.js lint configuration. ESLint 10 currently fails with a removed `getFilename`
API. npm marks ESLint 9 as unsupported; reassess this pin when the plugin is updated.
Root overrides pin patched releases of `deepmerge-ts` and `mysql2`, which are
transitive dependencies of the Prisma CLI. Prisma generation, API tests, and builds
are checked against these versions; the current dependency audit reports no known
vulnerabilities. Reassess the overrides when upgrading Prisma.

## Current Status

Milestone 1 is complete: both applications run, the frontend checks the real API,
and the connection behavior has automated tests. PostgreSQL connectivity through
Prisma and the API readiness endpoint are implemented. Organization, user, and
membership models now have a committed migration and database constraint tests.
Backend registration, login, and revocable sessions are implemented. No inventory
data is mocked or stored yet. Organization creation, scoped access, and admin guards
are implemented and tested. Frontend signup, login, logout, organization selection,
and the initial workspace are connected to the real API. Email verification and
password reset are implemented with local-file and configurable SMTP delivery.
Invitations, inventory features, and production mail hardening are still pending.

## Commit Workflow

Keep each change focused, run the relevant checks, and commit it locally with a
message such as `feat(api): add product creation`. Review changes with `git diff`
and history with `git log --oneline`. Do not include secrets or generated build
output. Push to GitHub only as a separate, explicit step.

## Delivery Milestones

1. Application foundation and frontend-to-backend connectivity.
2. Database model, authentication, and organization isolation.
3. Products, suppliers, and inventory locations.
4. Purchase orders, approvals, and partial receipts.
5. Stock transfers, adjustments, reports, and deployment.

Each completed change is verified and committed locally as a focused milestone.
Pushing commits to GitHub is a separate, explicit step.

## Initial Scope

One currency per organization, one stock unit per product, immediate stock
transfers, and no negative inventory. Payments, accounting integrations, and
forecasting are outside the first release.
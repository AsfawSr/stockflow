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
The default `postgres` account is suitable only for initial local setup; use a
dedicated, least-privilege database account before deployment.

The initial migration creates `organizations`, `users`, `memberships`, and the
`organization_role` enum. Run `npm run db:migrate` to apply committed migrations
to the configured database and `npm run db:status` to inspect migration history.
The first migration expects no conflicting tables or enum. For an existing schema,
review and baseline it before migrating; never reset a database to bypass a conflict.
The migration is transaction-wrapped and does not seed any application records.

Prisma's CLI is a root development dependency shared by the workspace scripts.
The generated client is ignored by Git and regenerated before API builds, tests,
type checks, and development startup.

## Identity Data Model

- `Organization`: company name, one currency, UUID, and timestamps.
- `User`: global unique email, display name, UUID, and timestamps. A user can belong
	to several organizations; no passwords or authentication endpoints exist yet.
- `Membership`: links one user to one organization with an explicit, non-empty set
	of roles: `ADMIN`, `PURCHASER`, `MANAGER`, and `WAREHOUSE`. There is no default role.

PostgreSQL rejects duplicate memberships, missing parent records, blank names,
null or duplicate roles, and deletion of users or organizations with memberships.
Emails must be non-empty, lowercase, whitespace-free, and unique. This is a storage
normalization rule, not full email validation or proof of email ownership.
Currency codes must be three uppercase letters; validation against the supported
currency list will belong to the application layer.

Custom checks live in the SQL migration because Prisma does not express them in
the model schema. Preserve these checks in future migrations. Adding a role also
requires updating the `memberships_roles_valid_set` check, which uses the enum's
four current values. Use migrations, not `prisma db push`, to reproduce the schema.
UUID defaults and `updatedAt` updates are handled by Prisma Client.

These relationships do not enforce request-level tenant isolation or permissions.
Authentication, organization selection, and membership guards are the next milestone.

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

Open `http://127.0.0.1:3000` for the Next.js system-status page. Refresh status
performs a new server-side API check. A stopped API displays an unavailable state
instead of breaking the page. Authentication is not configured yet.

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
to `main`. The workflow does not deploy either application. Local checks have been
run with Node.js 24; the Linux/Node.js 22 matrix will be verified by GitHub after push.

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
and restricted deletes. All fixture writes run inside transactions that roll back,
including the Prisma success path. The tests neither reset nor truncate tables.

The initial UI was also checked in a browser at desktop, tablet, and mobile sizes,
including refresh recovery after starting the API. These manual browser checks are
not yet part of the automated test suite.

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
No inventory data is mocked or stored yet. The next steps are authentication and
server-side tenant isolation before exposing organization-owned business data.

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
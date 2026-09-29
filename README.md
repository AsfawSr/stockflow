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
- PostgreSQL and Prisma: planned persistence layer.
- npm workspaces: one repository and one root dependency lockfile.

## Requirements

- Node.js 22 or newer (initial setup verified with Node.js 24).
- npm 10 or newer (initial setup uses npm 11).

## Local Development

Run these commands from the repository root:

```sh
npm install
npm run dev:api
```

In a second terminal, also from the repository root:

```sh
npm run dev:web
```

Open `http://127.0.0.1:3000` for the Next.js system-status page. Refresh status
performs a new server-side API check. A stopped API displays an unavailable state
instead of breaking the page. Database and authentication are not configured yet.

The API runs at `http://127.0.0.1:3001`. `GET /api/health` returns
`{"status":"ok","service":"stockflow-api"}`. This is a liveness check, not a
database readiness check. No database connection is required at this milestone.
The API port can be overridden with the `PORT` environment variable.

To override the API address, create `apps/web/.env.local` using
`apps/web/.env.example` as a reference and set `API_BASE_URL`. This is a server-only
setting; it does not need a `NEXT_PUBLIC_` prefix. Restart Next.js after changing it.
Both development servers bind to the local machine only.

## Verification

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs these checks on Node.js 22 and 24 for pull requests and pushes
to `main`. The workflow does not deploy either application. Local checks have been
run with Node.js 24; the Linux/Node.js 22 matrix will be verified by GitHub after push.

The API tests exercise the health endpoint over HTTP and verify its route prefix.
Frontend tests cover healthy, unavailable, failed HTTP, wrong-service, and malformed
JSON responses. Lint currently covers the frontend; type checks cover both apps.

The initial UI was also checked in a browser at desktop, tablet, and mobile sizes,
including refresh recovery after starting the API. These manual browser checks are
not yet part of the automated test suite.

ESLint stays on 9.39.x for compatibility with the React plugin shipped by the current
Next.js lint configuration. ESLint 10 currently fails with a removed `getFilename`
API. npm marks ESLint 9 as unsupported; reassess this pin when the plugin is updated.
The initial dependency audit reported no known vulnerabilities.

## Current Status

Milestone 1 is complete: both applications run, the frontend checks the real API,
and the connection behavior has automated tests. No inventory data is mocked or
stored yet. The next milestone is PostgreSQL and Prisma, organization membership,
authentication, and server-side tenant isolation.

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
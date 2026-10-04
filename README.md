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
- PostgreSQL and Prisma 7: persistence with identity, organization, and product models.
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
The fourth migration adds the organization-owned `products` table and its constraints.
It is additive and does not seed products or change existing identity records.

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

## Product Data Model

`Product` belongs to one organization and has a UUID, SKU, name, optional description,
one stock unit, and timestamps. Field limits are 64 characters for SKU, 160 for name,
2,000 for description, and 32 for unit. Names and units cannot be whitespace-only.
The unit is a required label such as `piece` or `kg`; conversions are not modeled.

SKUs use uppercase ASCII letters, digits, dots, underscores, and hyphens, starting
with a letter or digit. The database rejects noncanonical values rather than silently
normalizing them. A SKU is unique within its organization, but another organization
may use the same value. Archived products continue to reserve their SKUs.

`archivedAt = null` means active; a timestamp means archived. Clearing that timestamp
restores the same product identity. There is no redundant status flag or editable
stock balance. Quantities will later come from the stock movement ledger.
Deleting an organization with products is restricted rather than cascading.

The `(organizationId, id)` unique key supports tenant-scoped lookups and future
composite foreign keys. An index on `(organizationId, archivedAt)` supports filtering
an organization's active or archived catalog. These keys do not replace membership
authorization: product API endpoints combine both, and every product query is
filtered by the organization in the URL after the membership guard passes.

`Supplier` and `Location` follow the same organization-owned pattern with the
fifth migration. A supplier has a name (160), optional contact name, email, phone,
and address; a location has a name (120) and optional address. Names are unique per
organization and stay reserved while archived. Optional fields reject
whitespace-only values, supplier emails must be stored lowercase without spaces,
and phone numbers allow 3-32 digits with `+ ( ) . / -` separators and at least one
digit. Both tables restrict organization deletion and use the same archive
timestamps and scoped `(organizationId, id)` keys as products.

The product database tests are included in `npm run test:db`. They exercise Prisma
create/archive/restore behavior, scoped identifiers, SKU uniqueness and format,
field limits, and referential integrity. All product test writes are rolled back.

## Product API

All product routes live under `/organizations/:organizationId/products`, require a
verified email and current membership in that organization, and return
`Cache-Control: no-store`. Any member may read the catalog; `ADMIN` or `MANAGER`
roles are required to change it. Nonmembers receive 404 for the whole subtree.

| Method | Path | Required access |
| --- | --- | --- |
| GET | `/` | Member; lists products with `search`, `status`, `page`, and `pageSize`. |
| GET | `/:productId` | Member; returns one product in this organization. |
| POST | `/` | `ADMIN`/`MANAGER`; creates a product from `sku`, `name`, `unit`, `description?`. |
| POST | `/import` | `ADMIN`/`MANAGER`; imports a CSV catalog all-or-nothing. |
| PATCH | `/:productId` | `ADMIN`/`MANAGER`; updates any of those fields, at least one required. |
| POST | `/:productId/archive` | `ADMIN`/`MANAGER`; archives an active product. |
| POST | `/:productId/restore` | `ADMIN`/`MANAGER`; restores an archived product. |

Listing defaults to active products, page 1, and 20 items per page (100 maximum);
`status` accepts `active`, `archived`, or `all`, and `search` matches names
case-insensitively and SKUs by canonical substring. Responses return
`{ items, total, page, pageSize }` ordered by name. SKUs are trimmed and uppercased
before validation, names and units are trimmed, and blank descriptions become null.
A duplicate SKU in the same organization returns 409 with a fixed message, as does
archiving an already-archived product (or restoring an active one). Unknown ids,
malformed UUIDs, and other organizations' product ids return 404. Client-supplied
`organizationId` or `archivedAt` body fields are rejected rather than trusted.
The API tests cover role denial, cross-tenant 404s, duplicate SKU conflicts across
create and update, filtering, and pagination against real PostgreSQL.

CSV import takes a `sku,name,unit` header (plus optional `description` and
`reorder_point`, any order, case-insensitive) and applies the same normalization
rules as single-product creation. Every row is validated before anything is
written: duplicates within the file, collisions with existing SKUs, and
per-field problems all come back as `{ created: 0, errors: [{ line, message }] }`
so the import dialog can point at exact lines, and a clean file is inserted in
one transaction with a single `product.imported` audit event. The products
screen offers the upload behind the same manager roles; nothing is ever
partially imported.

## Supplier and Location APIs

`/organizations/:organizationId/suppliers` and `.../locations` mirror the product
API: verified email plus current membership required, nonmembers receive 404,
listing supports the same `search`, `status`, `page`, and `pageSize` parameters,
and archive/restore behave identically with 409 on repeated changes. Duplicate
names return 409 with an entity-specific message.

Suppliers accept `name` plus optional `contactName`, `email`, `phone`, and
`address`; emails are lowercased, optional fields are trimmed with blank values
stored as null, and search matches names and emails. Any member reads suppliers;
`ADMIN` or `PURCHASER` roles manage them. Locations accept `name` and optional
`address`, search by name, and are readable by members but managed by `ADMIN`
only, matching the role model where administrators manage company settings and
purchasing officers manage supplier relationships. `MANAGER` manages products
but neither suppliers nor locations.

`GET .../suppliers/:supplierId/prices` reports the latest confirmed unit price
per product for one supplier, derived from order history rather than a separate
price table: only orders that reached `APPROVED`, `PARTIALLY_RECEIVED`, or
`RECEIVED` count, with the most recent approval winning. Draft, submitted,
rejected, and cancelled negotiations never surface. Each entry carries the
source order reference and approval date. The tests cover recency, exclusion of
unconfirmed states, per-supplier isolation, and tenant isolation.

`GET .../suppliers/:supplierId/performance` grades the same history: confirmed
and open order counts, ordered versus received units with a one-decimal fill
rate, and the average lead time in days from approval to the last receipt of
each completed order. Rates are null rather than zero when there is nothing to
measure — a new supplier has an unknown fill rate, not a bad one. The supplier
screen shows these metrics above the price list. Tests cover the empty state,
partial deliveries, completed orders with a backdated approval for a measurable
lead time, dilution by undelivered orders, and the usual access rules.

## Purchase Order and Stock Ledger Model

The sixth migration adds the procurement workflow and the beginning of the stock
ledger. A `PurchaseOrder` belongs to one organization and references a supplier and
a destination location through composite `(organizationId, id)` foreign keys, so an
order can never point at another organization's records. Orders carry a
per-organization sequential `number`, a status
(`DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `PARTIALLY_RECEIVED`, `RECEIVED`,
`CANCELLED`), optional notes, the creating user, and the deciding user with a
decision timestamp that must accompany it.

`PurchaseOrderLine` stores an ordered product, a positive quantity, a non-negative
`DECIMAL(12,2)` unit price frozen at ordering time, and a `receivedQuantity` that the
database bounds between zero and the ordered quantity. A product may appear once per
order. `GoodsReceipt` records who received a delivery and when; its lines reference
order lines of the same order only and must have positive quantities.

`StockMovement` is the append-oriented ledger: every quantity change references its
product, location, creator, and cause. Receipt movements must be positive and each
receipt line can produce exactly one movement, which makes double-posting a
constraint violation rather than a code path. `StockLevel` is the fast-read balance
per product and location; the database rejects negative balances. Deleting orders,
users, or products that appear in receipts or movements is restricted to preserve
the audit trail. Ledger tests cover order numbering, cross-tenant references,
receipt bounds, movement shape, and delete protection; all writes roll back.

## Purchase Order API

Order routes live under `/organizations/:organizationId/purchase-orders` with the
same guards as the other tenant APIs. Any member reads orders. Purchasers (or
admins) create drafts, edit draft headers and lines, submit, and cancel; managers
(or admins) approve or reject submitted orders; warehouse members (or admins)
record receipts. Rejection requires a reason; approval accepts an optional note,
and the decision records who decided and when.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Lists orders with status filter and pagination, newest first, including totals. |
| GET | `/suggestions` | Active products at or below their reorder point, with on-hand totals, a restock quantity, and the last confirmed supplier and price. |
| POST | `/` | Creates a draft against an active supplier and location; numbering is serialized per organization. |
| GET | `/:orderId` | Full detail: lines, receipts, decision, computed totals. |
| PATCH | `/:orderId` | Draft-only header changes (supplier, location, note). |
| POST/PATCH/DELETE | `/:orderId/lines[/:lineId]` | Draft-only line management; one line per product, positive quantity, `DECIMAL` price. |
| POST | `/:orderId/submit` | Draft with at least one line becomes `SUBMITTED`. |
| POST | `/:orderId/approve` `/reject` | Submitted orders only; rejection requires a note. |
| POST | `/:orderId/cancel` | Draft/submitted orders, or approved orders with no receipts. |
| POST | `/:orderId/revise` | Rejected orders reopen as drafts; the decision fields are cleared for a fresh verdict. |
| POST | `/:orderId/receipts` | Approved or partially received orders; posts the delivery to the ledger. |

Receiving locks the order row, so competing receipts for the last remaining units
resolve to exactly one success and one conflict. Each receipt line increments the
order line's received quantity, appends one `RECEIPT` stock movement, and updates
the destination location's stock level in the same transaction; order status
becomes `PARTIALLY_RECEIVED` or `RECEIVED` from the resulting sums. Over-receipt,
duplicate lines in one receipt, wrong-state transitions, archived partners or
products, and cross-tenant references are rejected. Prices are returned as fixed
two-decimal strings computed with decimal arithmetic, never floats. The tests
cover the full lifecycle, the state machine, role separation, isolation, and
committed-data concurrency for receipts and numbering.

Rejection is no longer terminal: purchasers can revise a rejected order, which
returns it to `DRAFT` with lines intact and the decision fields cleared, so the
rejection reason belongs to exactly one submission cycle and the next reviewer
starts clean. The reopened draft is fully editable and goes through submission
and approval again. Approved, cancelled, and in-flight orders cannot be revised.

Every order also has a print view: a standalone, light-styled document with the
supplier's contact block, the delivery address, dates, lines, and totals,
reachable from the order detail screen. Printing uses the browser (and its
print-to-PDF) rather than a server-side PDF dependency; screen-only controls
are hidden by print styles.

Approval also notifies the supplier: when the supplier record has an email
address, the decision sends a plain-text purchase order (lines, totals in the
organization currency, destination with address, and any order note) through
the same mail transport and delivery metrics as account email. Suppliers
without an address are skipped silently, rejection never notifies anyone, and
a failed send is logged but never rolls back the approval. Order emails carry
no action link, so account-mail tooling ignores them. Administrators can set
an organization-wide reply-to address (stored lowercase with a database check)
in the workspace profile; when present it rides along on supplier mail so
replies reach the purchasing team instead of the no-reply sender, and clearing
the field removes the header again.

`GET .../purchase-orders/suggestions` turns reorder points into a shopping list:
every active product whose summed on-hand balance is at or below its reorder
point appears with a suggested quantity that restocks to twice the reorder point
(an order-up-to rule, never below one unit). Each suggestion carries the supplier,
unit price, and order reference from the latest confirmed order for that product,
reusing the supplier price history rules; products with no confirmed history or
an archived supplier still appear, with the sourcing fields null. Any member
reads suggestions. Tests cover the threshold, the quantity rule, sourcing
provenance, archived products and suppliers, and tenant isolation.

On the suggestions screen, purchasers can turn a sourced suggestion into a draft
order in one step: a per-row dialog pre-fills the suggested quantity and last
confirmed price, asks only for the destination location, and lands on the new
draft's detail screen. The draft is created through the same purchase-order
endpoints and role checks as manual ordering, and stays fully editable before
submission. Suggestions without a usable supplier offer no shortcut.

## Stock API

Stock routes live under `/organizations/:organizationId/stock`. Any member reads
levels and movement history; warehouse members (or admins) record transfers and
adjustments. Receipts already post to the ledger automatically, so these routes
cover the remaining hand-entered movements.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/levels` | On-hand quantity per product and location with a `low` flag; filter by location or `low=true`, search by product name or SKU, paginated. |
| GET | `/levels/export` | The same report as CSV (`text/csv` attachment, up to 10,000 rows, same filters). |
| GET | `/movements` | Full movement history, newest first, with a human-readable detail per entry; filter by product or location. |
| GET | `/movements/export` | The history as CSV with the same filters; fields with commas, quotes, or line breaks are escaped. |
| POST | `/transfers` | Move a positive quantity between two different locations; optional note. |
| POST | `/adjustments` | Positive or negative correction with a required reason; zero is rejected. |
| GET | `/valuation` | On-hand value per product at the weighted average receipt cost, with the organization total. |

A transfer writes one `TRANSFER_OUT` and one `TRANSFER_IN` movement plus the
transfer record in a single transaction; an adjustment writes one `ADJUSTMENT`
movement. Both lock the affected stock level rows (ordered, `FOR UPDATE`) before
checking availability, so competing requests for the same units resolve to one
success and one conflict, and no location can go negative — the database check
constraints enforce the same rules again underneath. Transfers to archived
locations are rejected, while adjustments at archived locations remain possible
for closing corrections. Movement details render as the adjustment reason or
`Source to Destination - note` for transfers; deliveries show their purchase
order number. Products carry an optional reorder point (0 to 1,000,000, enforced
by a database check); a balance at or below its product's reorder point is
flagged `low`, and `low=true` narrows the report to those rows with a SQL join,
since the comparison crosses tables. The tests cover the report shapes, filters,
every boundary
(insufficient stock, same location, zero or unreasoned adjustments, archived
destinations, cross-tenant references), role separation, and committed-data
concurrency for simultaneous transfers of the same stock.

`GET .../stock/valuation` prices what is on the shelves: every product with a
positive summed balance appears with its weighted average unit cost — total
received value divided by total received quantity across all deliveries — and
its on-hand value, computed with decimal arithmetic and returned as fixed
two-decimal strings alongside the organization total. Stock that never arrived
through a delivery (for example, opening balances entered as adjustments) has
no known cost; it is listed with null cost and value and excluded from the
total rather than silently priced at zero. The valuation screen is linked from
the stock page. Tests cover the averaging across multiple deliveries at
different prices, write-offs, cost-less stock, zero balances, and tenant
isolation.

## Invitation API

Admins manage invitations under `/organizations/:organizationId/invitations`;
accepting is a separate authenticated route because the invitee is not a member
yet.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/organizations/:id/invitations` | Pending (unexpired) invitations with roles and inviter. |
| POST | `/organizations/:id/invitations` | Invites an email with a role set and emails a single-use link; re-inviting replaces the pending link. |
| DELETE | `/organizations/:id/invitations/:invitationId` | Revokes a pending invitation; its link stops working. |
| POST | `/invitations/accept` | Consumes `{ token }` for the signed-in, verified user and creates the membership. |

Invitations store only SHA-256 token digests, expire after seven days, and are
bound to a lowercase email address; the database enforces the same normalized
email, hash format, future expiry, and valid role set rules as memberships.
Inviting a current member returns 409. Accepting requires the signed-in user's
verified email to match the invitation exactly; otherwise it is 403. A failed
invitation email removes the invitation and returns 503, so no unreachable link
stays pending. Consumption deletes the row inside a transaction with a claimed
count check, so concurrent accepts resolve to one membership; the membership
unique constraint is the final guard. The tests cover the invite-accept
lifecycle, replacement, expiry, mismatch, revocation, admin-only management,
tenant isolation, and committed-data concurrent accepts.

## Audit Log

Every consequential workspace action leaves a row in `audit_events`: purchase
order transitions (created, submitted, approved, rejected, cancelled, revised,
received), stock transfers and adjustments, invitations (created, revoked,
accepted), and member changes (roles changed, removed). Each event stores the
organization, the acting user, a stable `action` code, the entity type and id,
a human-readable summary, and a timestamp. Audit writes are best effort — a
failed insert logs a warning but never fails the action it describes — and the
actor reference is `SET NULL` on user deletion so history outlives accounts,
while the organization reference is `RESTRICT` so history cannot be orphaned.

`GET /organizations/:organizationId/audit` serves the log to administrators
only (other members get 403, outsiders 404), newest first with the standard
`page`/`pageSize` pagination. The workspace overview links admins to a
read-only audit screen with the summary, actor, and action code per event.
Tests cover event recording across all instrumented flows, ordering,
pagination, role enforcement, and tenant isolation, plus database constraints
for non-blank fields and the two deletion behaviors.

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
other API routes are limited to 120 per minute. Health checks are exempt. Counters
live in process memory by default; setting `RATE_LIMIT_STORE=database` moves them
to a PostgreSQL fixed-window table updated with a single atomic upsert, so every
API process shares the same limits and lost counts cannot occur under concurrency.
Set `TRUSTED_PROXY_HOPS` to the exact number of trusted ingress hops so client
addresses come from the right `X-Forwarded-For` entry; by default no proxy is
trusted. Signed-in users change their password at `/account`: the API verifies the
current password, rehashes the new one, increments the credential version, keeps
only the current session alive, and deletes other sessions and outstanding account
links.

The Next.js interface uses server actions and HTTP-only session cookies; bearer
tokens are never returned to client components or stored in localStorage.
Use HTTPS outside local development. Production mail monitoring is still
required before public deployment. Registration alone does not prove email ownership;
organization access requires completing an email link. Its conflict response can
still reveal account existence.

A maintenance sweep runs hourly in the API process (and once at startup) to delete
expired sessions, expired account tokens, expired invitations, and finished
rate-limit windows. It never touches
unexpired or consumed-but-live records, logs what it removed, survives database
outages by retrying on the next interval, and is disabled under `NODE_ENV=test`
so test fixtures stay deterministic. `CLEANUP_INTERVAL_MS` overrides the cadence.
Production email refuses the development file transport: outside development,
`MAIL_TRANSPORT=smtp` with `SMTP_HOST` and `MAIL_FROM` is required, and the SMTP
transport uses bounded connection, greeting, and socket timeouts.

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
	Every member sees the workspace pulse: on-hand balance, low-stock, and
	awaiting-approval counts that link to the filtered screens, plus the five most
	recent stock movements and a weekly activity table — eight ISO weeks of new
	orders, received units, and movement counts from
	`GET /organizations/:organizationId/trends`, with empty weeks kept as zeros so
	quiet periods are visible rather than skipped.
	Admins can rename the organization and inspect its members; other members cannot.
	Admins also invite members by email with a role set, see pending invitations with
	their expiry, and revoke them; `/invitations/accept` lets a signed-in, verified
	user consume an emailed invitation link and join with the invited roles. Admins
	edit each member's roles through a checkbox dialog and remove members; demoting
	or removing the only administrator shows a clear error from the API guard.- `/workspace/:organizationId/products` lists the organization's catalog with search,
  an active/archived/all filter, and pagination. Admins and managers create, edit,
  archive, and restore products through dialogs; other members see a read-only list.
  Search, filter, and paging run server-side through GET parameters, so catalog URLs
  are shareable. Product mutations are server actions that revalidate the list, map
  duplicate SKUs to a clear message, and never expose other organizations' data.- Supplier names on `/workspace/:organizationId/suppliers` link to a per-supplier
  price history screen, and draft order lines pre-fill the unit price from the
  supplier's last confirmed order with a provenance hint the purchaser can
  override.- `/workspace/:organizationId/stock` shows on-hand balances per product and location
  with a location filter, product search, a low-stock filter, and pagination, plus
  the latest movement
  history with type badges and human-readable details. Products can carry a reorder
  point; balances at or below it show a Low badge. Admins and warehouse members
  record transfers and adjustments through dialogs whose fields are controlled state,
  so a rejected submission (such as insufficient stock) keeps the entered values;
  other members see a read-only report. `/stock/movements` is the full paginated
  history with product and location filters, and both screens offer CSV export:
  the browser downloads through a Next.js route handler that forwards the request
  to the API with the server-held session token, so bearer tokens never reach the
  client.- `/status` remains public and displays web, API, and PostgreSQL health.
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
rate limiting, so the per-IP limits act as shared platform limits for browser
traffic. With `RATE_LIMIT_STORE=database` the counters hold across all API
processes; per-end-client attribution still requires terminating ingress in front
of both applications and setting `TRUSTED_PROXY_HOPS` accordingly. Do not blindly
trust forwarded headers.
Mail delivery is observable at `GET /api/health/mail`: in-process sent/failed
counters with last success and failure times, reported as `degraded` whenever the
most recent delivery failed. The endpoint never exposes recipients or message
content, and the status page shows the same signal as an Email delivery card.

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
| GET | `/organizations/:organizationId/members` | Current `ADMIN` role; returns safe member profiles and roles, paginated. |
| PATCH | `/organizations/:organizationId/members/:memberUserId` | Current `ADMIN` role; replaces a member's role set. |
| DELETE | `/organizations/:organizationId/members/:memberUserId` | Current `ADMIN` role; removes the membership. |

Create accepts only `name` and `currency`; rename accepts only `name`. Clients cannot
assign themselves roles, provide an owner id, or change currency through rename.
Unknown body properties are rejected rather than silently used. Member and
invitation lists are paginated (`page`, `pageSize` up to 100) and the overview
screen pages through both; `GET /organizations` still returns the caller's
complete membership list, which is naturally small.

Membership and roles are read from PostgreSQL for each organization request and are
not stored in access tokens. An admin role in one organization grants no access to
another. Revoking membership or changing roles takes effect on subsequent requests
without requiring logout. Missing membership returns 404; insufficient permissions
for an existing member returns 403. Missing, expired, or revoked authentication
returns 401. Organization reads and writes also include membership conditions in
their database queries, including the admin requirement on updates and member lists.

The creator is the initial admin. Admins manage membership end to end: email
invitations, role edits, and removal. Role changes and removals lock the
organization row, count remaining administrators, and refuse to demote or remove
the last one, including under concurrent requests; changes take effect on the
member's next request without logout. There is no global administrator role.
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
`GET /api/health/mail` reports email delivery counters and a degraded flag.
The API port can be overridden with the `PORT` environment variable.

To override the API address, create `apps/web/.env.local` using
`apps/web/.env.example` as a reference and set `API_BASE_URL`. This is a server-only
setting; it does not need a `NEXT_PUBLIC_` prefix. Restart Next.js after changing it.
Both development servers bind to the local machine only.

### Demo data

With both development servers running, `npm run demo:seed` builds a ready-to-tour
workspace through the real API — no direct database writes — so every ledger
entry, audit event, price history row, and metric is produced by the same code
paths the application uses. The script signs in as `demo@example.test` (creating
and self-verifying the account from the file mail transport if needed) and seeds
a catalog, three suppliers, three locations, five purchase orders in different
states, transfers, and adjustments; it prints the credentials and workspace URL
when done. Each run creates a fresh organization for the demo user. Override
`DEMO_EMAIL`, `DEMO_PASSWORD`, `STOCKFLOW_API`, or `STOCKFLOW_WEB` to retarget it.

## Deployment

Both applications ship as production container images built from the repository
root: `apps/api/Dockerfile` (multi-stage; the `runtime` target carries only
production dependencies and the compiled output, and runs as the unprivileged
`node` user) and `apps/web/Dockerfile` (Next.js standalone output). Containers
bind to `0.0.0.0` through the `HOST`/`HOSTNAME` variables; local development
stays loopback-only.

For a single-host deployment, copy `.env.example` to `.env`, replace every
placeholder, and run:

```sh
docker compose up -d --build --wait
```

The stack starts PostgreSQL 17 with a persistent volume, runs
`prisma migrate deploy` as a one-shot `migrate` service after the database is
healthy, starts the API only after migrations complete, and starts the web
server once the API readiness probe (which checks the database) passes. A Caddy
ingress is the only published entry point (ports 80 and 443): it redirects HTTP
to HTTPS, provisions certificates automatically (ACME for the configured
`DOMAIN`, a local CA for the `localhost` default), and proxies to the web tier;
the web server, API, and database stay on the internal network. Production
requires SMTP mail settings and an HTTPS `WEB_ORIGIN` whose host matches
`DOMAIN`; the API refuses to boot with the development file transport.

In production the API emits one JSON log line per request with a request id,
method, path, status, and duration; health probes are tagged but not logged. An
inbound `X-Request-Id` header is kept when well-formed and is always echoed on
the response, so logs correlate across the proxy, web, and API tiers.

Tagging a release (`v*`) builds both images for linux/amd64 and pushes them to
GitHub Container Registry as `<repository>-api` and `<repository>-web` with
semver and commit tags; the `docker-compose.yml` file can point at those images
instead of building locally.

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
creation/selection/renaming, permission revocation, and the product catalog:
creation, duplicate-SKU errors, search, editing, archive/restore, and hidden manage
controls for non-manager members. It also creates a supplier with normalized contact
details, rejects a duplicate supplier name, creates a location, and verifies that a
purchaser manages suppliers but not products or locations. It then runs a purchase
order from draft through line editing, submission, approval, and two partial
deliveries to `RECEIVED`, checking the stock level in PostgreSQL afterwards.
On the stock screen it verifies the delivered balance, rejects an oversized
transfer while keeping the entered values, records a transfer with a note and a
negative adjustment with a reason, filters by location, confirms the resulting
balances in PostgreSQL, and checks that a purchaser can read stock but sees no
transfer or adjustment controls. It also invites an address before its account
exists, revokes and re-issues the invitation, and later has the invited user
accept through the emailed link, land in the workspace with the invited role,
and get a clear error on link reuse. It sets a reorder point on the product and
verifies the Low badge and the low-stock filter on the stock screen. It verifies
that the only administrator can be neither demoted nor removed, changes the
account password from the account screen, confirms the old password stops
working, and signs back in with the new one.
It checks desktop, tablet,
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
The Product schema and migration are implemented and tested, and the product API
now provides listed, searchable, role-protected create/edit/archive/restore
endpoints with a matching workspace catalog interface. Suppliers and inventory
locations complete milestone 3 with the same schema, API, and interface pattern.
Milestone 4 adds the purchase order workflow end to end: draft, approval,
rejection, cancellation, and partial receipts that post to the stock ledger and
per-location stock levels, all covered by constraint, workflow, concurrency, and
browser tests. Milestone 5 completes the ledger: stock transfers between locations
and reasoned adjustments with row-level locking and no-negative guarantees, plus a
stock overview screen with balances, filters, movement history, and role-guarded
transfer and adjustment dialogs. Member invitations now work end to end: admins
invite, list, and revoke by email, and invitees join through single-use emailed
links bound to their verified address. Products carry optional reorder points
that flag low balances and power a low-stock report. An hourly maintenance sweep
removes expired sessions, account tokens, invitations, and rate-limit windows,
and production email delivery requires SMTP with bounded timeouts. Milestone 7
completes account and access hardening: signed-in password changes from the
account screen, admin role editing and member removal with last-admin protection,
and optional PostgreSQL-backed rate limiting with configurable trusted proxy
hops. Milestone 8 makes the platform deployable: production container images
for both applications, a compose stack with ordered migrations and health
checks verified end to end, structured JSON access logs with request ids, and
a tagged-release pipeline that publishes images to GitHub Container Registry.
Milestone 9 finishes the operational checklist: mail delivery health is
monitored at `/api/health/mail` and on the status page, member and invitation
lists are paginated end to end, and a Caddy TLS ingress with automatic
certificates fronts the compose stack as its only published entry point.
Milestone 10 rounds out day-to-day visibility: a workspace pulse dashboard with
live counts and recent activity, a full paginated stock movement history with
filters, and CSV exports for levels and movements proxied through the web
session. Milestone 11 adds supplier price memory: the latest confirmed price
per product is derived from approved order history, shown on a per-supplier
price screen, and pre-filled with a provenance hint when adding draft order
lines. Milestone 12 closes the restocking loop: a reorder suggestions screen
lists products at or below their reorder point with an order-up-to-twice-the-
reorder-point quantity and the last confirmed supplier and price for each.
Milestone 13 makes rejection recoverable: purchasers reopen rejected orders as
editable drafts with the decision cleared, then resubmit them for a fresh
verdict. Milestone 14 completes the restocking shortcut: a one-click dialog on
the suggestions screen creates a pre-filled draft order for the suggested
quantity at the last confirmed price. Milestone 15 reaches outside the team:
approving an order emails it to the supplier contact through the monitored
mail transport, without ever blocking the approval itself. Milestone 16 adds
accountability: order transitions, stock movements, invitations, and member
changes are recorded in a tenant-scoped audit log that administrators browse
from the workspace overview. Milestone 17 prices the warehouse: an inventory
valuation report derives weighted average costs from receipt history and shows
per-product and total on-hand value, excluding stock whose cost is unknown.
Milestone 18 grades the partners: each supplier screen now shows confirmed and
open order counts, the unit fill rate, and the average approval-to-delivery
lead time, all derived from existing order history. Milestone 19 adds a
printable purchase order document — a standalone print view with supplier and
delivery details rendered for the browser's print-to-PDF, with no server-side
PDF dependency. Milestone 20 adds time to the dashboard: the overview shows an
eight-week activity table of new orders, received units, and stock movements,
bucketed by ISO week in UTC. Milestone 21 closes the supplier email loop: each
organization can set a reply-to address in its profile, enforced lowercase by
a database check and attached to outgoing order mail. Milestone 22 makes the
project easy to show: `npm run demo:seed` builds a complete demo workspace
through the public API with orders in every state, stock history, and metrics.
Milestone 23 speeds up onboarding: managers import whole product catalogs from
CSV with all-or-nothing semantics and line-numbered error reports. Possible
next steps: archiving entire organizations, or saved low-stock email digests.

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
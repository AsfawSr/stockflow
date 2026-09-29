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
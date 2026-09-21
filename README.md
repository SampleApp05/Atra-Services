# ATRA — Backend Monorepo

An npm workspaces + Turborepo monorepo for the ATRA platform backend.  
All services are TypeScript-first, ESM, and share common packages via workspace aliases.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Workspace Structure](#workspace-structure)
- [Apps](#apps)
- [Packages](#packages)
- [Testing](#testing)
- [Environment Variables](#environment-variables)

---

## Getting Started

```bash
# 1. Install all dependencies
npm install

# 2. Build all packages and apps
npm run build

# 3. Run all tests
npm test
```

To run a single app in development mode:

```bash
npm run dev -w @atra/auth-service
npm run dev -w apps/market-service
```

---

## Workspace Structure

```
apps/
  auth-service/         # Wallet-based authentication & session management
  market-service/       # Real-time market data aggregation (Binance)
  api-gateway/          # (planned) Unified API proxy & rate limiting
  notification-service/ # (planned) Push / email notifications
  portfolio-service/    # (planned) Portfolio tracking
  worker-service/       # (planned) Background job processor

packages/
  database/             # Drizzle ORM schema, migrations, and query types
  blockchain/           # (planned) On-chain interaction utilities
  config/               # (planned) Typed environment config loader
  logger/               # (planned) Structured JSON logger (pino)
  sdk/                  # (planned) TypeScript client SDK
  shared-types/         # (planned) Shared TypeScript type definitions
  shared-utils/         # (planned) Shared utility functions
```

---

## Apps

<details>
<summary><strong>auth-service</strong> — Wallet-based authentication, sessions, roles &amp; recovery</summary>

Handles the full authentication lifecycle for ATRA wallet accounts. Authentication is challenge/signature based — no passwords. Includes JWT session management, multi-wallet role assignment, ownership transfer, account recovery, and a public `GET /config` endpoint that tells the frontend which chains are enabled.

- **182 tests across 18 test files**
- Stack: Express, ethers.js, jsonwebtoken, Drizzle ORM, postgres.js
- Port: `3001` (default)

[Full documentation →](./apps/auth-service/README.md)

</details>

<details>
<summary><strong>market-service</strong> — Real-time market data aggregation</summary>

Aggregates live Binance market data and exposes it to clients via a REST API and WebSocket feed. Supports symbol search, live price streams, OHLCV candles, order book snapshots, and recent trades.

- **84 tests**
- Stack: Express, ws, Binance REST + WebSocket streams
- Port: `3000` (default)

[Full documentation →](./apps/market-service/README.md)

</details>

<details>
<summary><strong>api-gateway</strong> — (planned) Unified API proxy &amp; routing</summary>

Will provide a single entry point for all ATRA backend services — request routing, rate limiting, and JWT validation at the edge.

[Full documentation →](./apps/api-gateway/README.md)

</details>

<details>
<summary><strong>notification-service</strong> — (planned) Push &amp; email notifications</summary>

Will handle event-driven notifications (email, WebSocket push) triggered by account and market events.

[Full documentation →](./apps/notification-service/README.md)

</details>

<details>
<summary><strong>portfolio-service</strong> — (planned) Portfolio tracking</summary>

Will provide per-account portfolio snapshots, P&L calculations, and asset allocation views.

[Full documentation →](./apps/portfolio-service/README.md)

</details>

<details>
<summary><strong>worker-service</strong> — (planned) Background job processor</summary>

Will run scheduled and event-driven background tasks (e.g. session cleanup, price snapshots, report generation).

[Full documentation →](./apps/worker-service/README.md)

</details>

---

## Packages

<details>
<summary><strong>@atra/database</strong> — Drizzle ORM schema, migrations &amp; query types</summary>

Single source of truth for the Postgres database schema. Exports typed Drizzle table definitions, enums, and inferred row types consumed by all services.

- Tables: `accounts`, `wallets`, `sessions`, `nonces`, `audit_logs`
- Enums: `wallet_role`, `nonce_purpose`, `audit_action`

[Full documentation →](./packages/database/README.md)

</details>

<details>
<summary><strong>@atra/blockchain</strong> — (planned) On-chain interaction utilities</summary>

Will expose typed wrappers around ethers.js for contract calls, event subscriptions, and address utilities.

[Full documentation →](./packages/blockchain/README.md)

</details>

<details>
<summary><strong>@atra/config</strong> — (planned) Typed environment config loader</summary>

Will provide a `loadConfig()` helper that validates and types `.env` values at startup, failing fast on missing required variables.

[Full documentation →](./packages/config/README.md)

</details>

<details>
<summary><strong>@atra/logger</strong> — (planned) Structured JSON logger</summary>

Will wrap pino to provide a consistent structured logging interface across all services, outputting newline-delimited JSON.

[Full documentation →](./packages/logger/README.md)

</details>

<details>
<summary><strong>@atra/sdk</strong> — (planned) TypeScript client SDK</summary>

Will provide type-safe wrappers for all ATRA REST and WebSocket APIs, with automatic token refresh and pagination helpers.

[Full documentation →](./packages/sdk/README.md)

</details>

<details>
<summary><strong>@atra/shared-types</strong> — (planned) Shared TypeScript type definitions</summary>

Pure `.d.ts` package exporting common types (accounts, sessions, market data, pagination) used across all apps and packages.

[Full documentation →](./packages/shared-types/README.md)

</details>

<details>
<summary><strong>@atra/shared-utils</strong> — (planned) Shared utility functions</summary>

Zero-dependency utility functions for pagination cursors, address normalisation, duration parsing, and API response helpers.

[Full documentation →](./packages/shared-utils/README.md)

</details>

---

## Testing

```bash
# Run all tests across the monorepo
npm test

# Run tests for a specific app
npm test -w @atra/auth-service
npm test -w apps/market-service

# Watch mode
npm test -w @atra/auth-service -- --watch
```

| App / Package | Tests | Framework |
|---|---|---|
| `auth-service` | 182 (18 files) | Vitest |
| `market-service` | 84 | Vitest |

---

## Environment Variables

Each app has its own `.env.example`. Copy it to `.env` before running:

```bash
cp apps/auth-service/.env.example apps/auth-service/.env
cp apps/market-service/.env.example apps/market-service/.env
```

See each app's README for the full variable reference.

# `@atra/database`

Shared Drizzle ORM schema, type exports, and database client used by every ATRA service.

---

## Contents

- [Installation / Usage](#installation--usage)
- [Schema](#schema)
  - [wallets](#wallets)
  - [accounts](#accounts)
  - [account\_wallet\_roles](#account_wallet_roles)
  - [nonce\_challenges](#nonce_challenges)
  - [sessions](#sessions)
  - [audit\_logs](#audit_logs)
- [Enums](#enums)
- [Exported Types](#exported-types)
- [Dependencies](#dependencies)

---

## Installation / Usage

This is an internal workspace package. Import it via the `@atra/database` alias configured in each service's `tsconfig.json` and `vitest.config.ts`.

```ts
import { db } from '@atra/database'
import { wallets, accounts, accountWalletRoles } from '@atra/database'
import type { Wallet, Account, WalletRole, NoncePurpose } from '@atra/database'
```

The `db` client is a [Drizzle ORM](https://orm.drizzle.team/) instance backed by [postgres.js](https://github.com/porsager/postgres). It reads `DATABASE_URL` from the environment at startup.

---

## Schema

### `wallets`

Represents a blockchain wallet address on a specific chain. The same address may exist on multiple chains as separate wallet records.

| Column      | Type        | Notes                                                   |
|-------------|-------------|---------------------------------------------------------|
| `id`        | `uuid` PK   | Auto-generated                                          |
| `address`   | `text`      | Lowercase hex address                                   |
| `chainId`   | `integer`   | EVM chain ID (e.g. `1`, `11155111`)                     |
| `createdAt` | `timestamp` | Default `now()`                                         |

> **Unique constraint**: `UNIQUE(address, chain_id)` — the same address on different chains is a different wallet record.

---

### `accounts`

One logical account per user. Always has exactly one `ownerWalletId`.

| Column             | Type        | Notes                                      |
|--------------------|-------------|--------------------------------------------|
| `id`               | `uuid` PK   | Auto-generated                             |
| `ownerWalletId`    | `uuid` NOT NULL | FK → `wallets.id`                     |
| `recoveryWalletId` | `uuid` NULL | FK → `wallets.id`; set when RECOVERY assigned |
| `createdAt`        | `timestamp` | Default `now()`                            |
| `updatedAt`        | `timestamp` | Default `now()`                            |

---

### `account_wallet_roles`

Junction table: which wallets have which roles on which accounts.

| Column              | Type      | Notes                            |
|---------------------|-----------|----------------------------------|
| `id`                | `uuid` PK |                                  |
| `accountId`         | `uuid`    | FK → `accounts.id`               |
| `walletId`          | `uuid`    | FK → `wallets.id`                |
| `role`              | `wallet_role` enum | See [Enums](#enums)     |
| `grantedByWalletId` | `uuid` NULL | FK → `wallets.id`              |
| `createdAt`         | `timestamp` | Default `now()`                |

---

### `nonce_challenges`

Single-use, time-limited challenge nonces issued before any signature verification.

| Column      | Type            | Notes                              |
|-------------|-----------------|-------------------------------------|
| `id`        | `uuid` PK       |                                     |
| `walletId`  | `uuid`          | FK → `wallets.id`                   |
| `nonce`     | `text`          | 32-char random hex string           |
| `purpose`   | `nonce_purpose` enum | See [Enums](#enums)            |
| `expiresAt` | `timestamp`     | Set to `now() + NONCE_TTL_MINUTES`  |
| `usedAt`    | `timestamp` NULL | Set when consumed                  |
| `createdAt` | `timestamp`     | Default `now()`                     |

---

### `sessions`

Active refresh-token sessions. Refresh tokens are stored as SHA-256 hashes only.

| Column             | Type        | Notes                                   |
|--------------------|-------------|-----------------------------------------|
| `id`               | `uuid` PK   |                                         |
| `accountId`        | `uuid`      | FK → `accounts.id`                      |
| `chainId`          | `integer`   | EVM chain ID embedded in the JWT        |
| `refreshTokenHash` | `text`      | SHA-256 of the raw opaque refresh token |
| `deviceName`       | `text`      | e.g. `"iPhone 15"`                      |
| `deviceType`       | `text`      | e.g. `"mobile"`, `"desktop"`            |
| `lastIp`           | `text`      | Client IP at last use                   |
| `expiresAt`        | `timestamp` | Set from `REFRESH_TOKEN_TTL_DAYS`       |
| `revokedAt`        | `timestamp` NULL | Soft-delete on revoke               |
| `createdAt`        | `timestamp` | Default `now()`                         |

---

### `audit_logs`

Append-only record of every sensitive operation across all services.

| Column          | Type        | Notes                                |
|-----------------|-------------|--------------------------------------|
| `id`            | `uuid` PK   |                                      |
| `accountId`     | `uuid`      | FK → `accounts.id`                   |
| `actorWalletId` | `uuid`      | FK → `wallets.id`; wallet that acted |
| `action`        | `text`      | e.g. `ACCOUNT_CREATED`, `ROLE_GRANTED` |
| `metadata`      | `jsonb`     | Operation-specific detail            |
| `createdAt`     | `timestamp` | Default `now()`                      |

---

## Enums

### `wallet_role`

| Value      | Meaning                                                    |
|------------|------------------------------------------------------------|
| `OWNER`    | Full control of the account; required for role operations  |
| `AUTH`     | Can log in and create sessions                             |
| `STANDARD` | Linked wallet; no special privileges                       |
| `RECOVERY` | Can replace the OWNER via the recovery flow                |

### `nonce_purpose`

| Value            | Used by                                  |
|------------------|------------------------------------------|
| `LOGIN`          | `/identity/challenge` + `/identity/verify` |
| `LINK_WALLET`    | `/wallets/link/challenge` + `/wallets/link/verify` |
| `GRANT_AUTH`     | `/roles/challenge` + `/roles/verify` (most role ops) |
| `TRANSFER_OWNER` | `/roles/verify` with `operation: TRANSFER_OWNER` |
| `RECOVERY`       | `/recovery/challenge` + `/recovery/execute` |

---

## Exported Types

```ts
// Table row types (inferred from schema)
type Wallet            // wallets row
type Account           // accounts row
type AccountWalletRole // account_wallet_roles row
type NonceChallenge    // nonce_challenges row
type Session           // sessions row
type AuditLog          // audit_logs row

// Insert types
type NewWallet | NewAccount | NewAccountWalletRole
type NewNonceChallenge | NewSession | NewAuditLog

// Enum value unions
type WalletRole    = 'OWNER' | 'AUTH' | 'STANDARD' | 'RECOVERY'
type NoncePurpose  = 'LOGIN' | 'LINK_WALLET' | 'GRANT_AUTH' | 'TRANSFER_OWNER' | 'RECOVERY'

// Drizzle client type
type Db  // typeof db
```

---

## Dependencies

| Package          | Role                           |
|------------------|--------------------------------|
| `drizzle-orm`    | Schema definition + query builder |
| `postgres`       | postgres.js driver             |
| `drizzle-kit`    | Migration CLI (dev only)       |

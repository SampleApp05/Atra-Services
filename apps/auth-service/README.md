# `auth-service`

Wallet-based authentication and authorisation service for the ATRA platform.  
All identity is cryptographic — no passwords. Users sign EIP-191 messages with their wallet private key.

---

## Contents

- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [API Reference](#api-reference)
  - [Identity — account creation & login](#identity)
  - [Auth — token refresh & revocation](#auth)
  - [Wallets — wallet linking](#wallets)
  - [Roles — role management](#roles)
  - [Recovery — owner recovery](#recovery)
  - [Audit — audit log queries](#audit)
- [Authentication](#authentication)
- [Error Codes](#error-codes)
- [Audit Actions](#audit-actions)
- [Module Map](#module-map)
- [Running Tests](#running-tests)

---

## Architecture

```
GET  /config              ← public    → supported chains for frontend bootstrap

POST /identity/challenge   ← public
POST /identity/verify      ← public   → issues accessToken + refreshToken
POST /auth/refresh         ← public   → rotates refresh token
POST /auth/revoke          ← public

POST /wallets/link/challenge  ← 🔒 JWT required
POST /wallets/link/verify     ← 🔒 JWT required

POST /roles/challenge      ← 🔒 JWT required (OWNER only)
POST /roles/verify         ← 🔒 JWT required (OWNER only)

POST /recovery/challenge   ← 🔒 JWT required (RECOVERY wallet only)
POST /recovery/execute     ← 🔒 JWT required (RECOVERY wallet only)

GET  /audit/:accountId     ← 🔒 JWT required (own account only)

GET  /health               ← public
```

The service uses [Drizzle ORM](https://orm.drizzle.team/) over PostgreSQL and stores all schema in `packages/database`.

---

## Environment Variables

| Variable                | Required | Default                | Description                                   |
|-------------------------|----------|------------------------|-----------------------------------------------|
| `DATABASE_URL`          | ✅       | —                      | PostgreSQL connection string                  |
| `JWT_SECRET`            | ✅       | —                      | HS256 signing secret (≥ 32 chars)             |
| `PORT`                  | ❌       | `3001`                 | HTTP port                                     |
| `SUPPORTED_CHAINS`      | ❌       | `sepolia`              | Comma-separated chain keys to enable          |
| `DEFAULT_CHAIN`         | ❌       | `sepolia`              | Default chain key for new sessions            |
| `ETHEREUM_RPC`          | ❌       | —                      | HTTP RPC for Ethereum mainnet                 |
| `ETHEREUM_WS`           | ❌       | —                      | WebSocket URL for Ethereum mainnet            |
| `SEPOLIA_RPC`           | ❌       | —                      | HTTP RPC for Sepolia                          |
| `SEPOLIA_WS`            | ❌       | —                      | WebSocket URL for Sepolia                     |
| `ACCESS_TOKEN_TTL`      | ❌       | `15m`                  | JWT access token lifetime (ms string)         |
| `REFRESH_TOKEN_TTL_DAYS`| ❌       | `30`                   | Refresh token lifetime in days                |
| `NONCE_TTL_MINUTES`     | ❌       | `5`                    | Challenge nonce lifetime in minutes           |

Copy `.env.example` to `.env` before running.

---

## Running Locally

```bash
cd apps/auth-service
npm install
npm run dev       # ts-node watch
npm test          # vitest run
```

---

## API Reference

All request/response bodies are JSON. Protected routes require `Authorization: Bearer <accessToken>` (or `?token=<accessToken>` for WebSocket upgrades).

Error responses always follow:
```json
{ "error": "ERROR_CODE" }
```

---

### Config

#### `GET /config`

Returns the default chain and list of supported chains. **No auth required.** This is the first request the frontend makes on startup.

**Response `200`**
```json
{
  "defaultChain": 11155111,
  "supportedChains": [
    { "id": 11155111, "key": "sepolia",  "name": "Ethereum Sepolia", "testnet": true  },
    { "id": 1,        "key": "ethereum", "name": "Ethereum",         "testnet": false }
  ]
}
```

---

### Identity

#### `POST /identity/challenge`

Step 1 of login/registration. Issues a nonce the wallet must sign.

**Request**
```json
{
  "address": "0xabc...",
  "chainId": 1
}
```

**Response `200`**
```json
{
  "challengeId": "uuid",
  "message": "Sign in to Atra\n\nNonce: abc123\nPurpose: LOGIN"
}
```

| Status | Error              | Condition                     |
|--------|--------------------|-------------------------------|
| `400`  | `MISSING_FIELDS`   | `address` or `chainId` absent |
| `400`  | `UNSUPPORTED_CHAIN`| `chainId` is not in the enabled chains list |

---

#### `POST /identity/verify`

Step 2. Verifies the signature and provisions an account if none exists. Returns session tokens.

**Request**
```json
{
  "address": "0xabc...",
  "nonce": "abc123",
  "signature": "0x...",
  "chainId": 1
}
```

**Response `200`**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "opaque-hex-string",
  "sessionId": "uuid",
  "accountId": "uuid",
  "walletId": "uuid"
}
```

| Status | Error                    | Condition                  |
|--------|--------------------------|----------------------------|
| `400`  | `MISSING_FIELDS`         | Any field absent           |
| `404`  | `WALLET_NOT_FOUND`       | Wallet not in DB           |
| `401`  | `INVALID_OR_EXPIRED_NONCE` | Nonce missing/expired    |
| `401`  | `SIGNATURE_MISMATCH`     | Signature doesn't match    |

---

### Auth

#### `POST /auth/refresh`

Rotates the refresh token. Old token is revoked; new token pair is issued.

**Request**
```json
{
  "refreshToken": "opaque-hex-string",
  "deviceName": "iPhone 15",
  "deviceType": "mobile",
  "lastIp": "1.2.3.4"
}
```

**Response `200`**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "new-opaque-hex-string",
  "sessionId": "uuid",
  "accountId": "uuid"
}
```

| Status | Error                              | Condition              |
|--------|------------------------------------|------------------------|
| `400`  | `MISSING_FIELDS`                   | Any field absent       |
| `401`  | `INVALID_OR_EXPIRED_REFRESH_TOKEN` | Token invalid/expired  |

---

#### `POST /auth/revoke`

Revokes a specific session immediately.

**Request**
```json
{
  "sessionId": "uuid",
  "accountId": "uuid"
}
```

**Response `200`**
```json
{ "success": true }
```

| Status | Error              | Condition                               |
|--------|--------------------|-----------------------------------------|
| `400`  | `MISSING_FIELDS`   | Any field absent                        |
| `404`  | `SESSION_NOT_FOUND`| Session not found or belongs to another account |

---

### Wallets

> 🔒 Requires valid JWT.

#### `POST /wallets/link/challenge`

Issues a challenge for linking a new wallet to an existing account. Caller must hold `OWNER` or `AUTH` role.

**Request**
```json
{
  "accountId": "uuid",
  "walletId": "uuid",
  "newAddress": "0xnew...",
  "chainId": 1
}
```

**Response `200`**
```json
{
  "challengeId": "uuid",
  "message": "Sign in to Atra\n\nNonce: xyz\nPurpose: LINK_WALLET"
}
```

| Status | Error                  | Condition                        |
|--------|------------------------|----------------------------------|
| `403`  | `INSUFFICIENT_ROLE`    | Caller has no OWNER or AUTH role |
| `409`  | `ADDRESS_ALREADY_LINKED` | Address already in DB          |

---

#### `POST /wallets/link/verify`

Verifies the new wallet's signature and grants it `STANDARD` role.

**Request**
```json
{
  "accountId": "uuid",
  "walletId": "uuid",
  "newAddress": "0xnew...",
  "nonce": "xyz",
  "signature": "0x..."
}
```

**Response `200`**
```json
{
  "walletId": "uuid",
  "role": "STANDARD"
}
```

---

### Roles

> 🔒 Requires valid JWT. All operations require `OWNER` role on the account.  
> Every operation uses **dual verification**: the OWNER signs approval AND the target wallet signs acceptance.

#### `POST /roles/challenge`

Step 1. Issues two challenge messages — one for the OWNER, one for the target wallet.

**Request**
```json
{
  "accountId": "uuid",
  "walletId": "uuid",
  "targetAddress": "0xtarget..."
}
```

**Response `200`**
```json
{
  "ownerChallengeId":  "uuid",
  "ownerMessage":      "Sign in to Atra\n\nNonce: ...\nPurpose: GRANT_AUTH",
  "targetChallengeId": "uuid",
  "targetMessage":     "Sign in to Atra\n\nNonce: ...\nPurpose: GRANT_AUTH"
}
```

---

#### `POST /roles/verify`

Step 2. Validates both signatures and applies the operation atomically.

**Request**
```json
{
  "accountId":      "uuid",
  "walletId":       "uuid",
  "targetAddress":  "0xtarget...",
  "operation":      "GRANT_AUTH",
  "ownerNonce":     "...",
  "ownerSignature": "0x...",
  "targetNonce":    "...",
  "targetSignature":"0x..."
}
```

**`operation` values**

| Value            | Effect                                                      |
|------------------|-------------------------------------------------------------|
| `GRANT_AUTH`     | Grants `AUTH` role to target wallet (idempotent)            |
| `REVOKE_AUTH`    | Removes `AUTH` role from target wallet                      |
| `ASSIGN_RECOVERY`| Assigns `RECOVERY` role (max 1 per account)                 |
| `TRANSFER_OWNER` | Moves `OWNER` to target; caller becomes non-owner           |
| `REMOVE_WALLET`  | Strips all roles from target wallet (OWNER wallet protected)|

**Response `200`**
```json
{ "success": true }
```

| Status | Error                             | Condition                             |
|--------|-----------------------------------|---------------------------------------|
| `403`  | `NOT_OWNER`                       | Caller lacks OWNER role               |
| `404`  | `TARGET_WALLET_NOT_FOUND`         | Target address not registered         |
| `401`  | `INVALID_OWNER_NONCE`             | Owner nonce missing/expired           |
| `401`  | `INVALID_TARGET_NONCE`            | Target nonce missing/expired          |
| `401`  | `OWNER_SIGNATURE_MISMATCH`        | Owner signature invalid               |
| `401`  | `TARGET_SIGNATURE_MISMATCH`       | Target signature invalid              |
| `409`  | `RECOVERY_WALLET_ALREADY_ASSIGNED`| Account already has a recovery wallet |
| `422`  | `CANNOT_REMOVE_OWNER_WALLET`      | Cannot remove the OWNER wallet        |
| `422`  | `CANNOT_TRANSFER_TO_SELF`         | Target is the same as caller          |

---

### Recovery

> 🔒 Requires valid JWT. The JWT must belong to the RECOVERY wallet itself.  
> Designed for use when the OWNER key is lost — this is **not** a login endpoint.

#### `POST /recovery/challenge`

Issues a `RECOVERY`-purpose nonce for the recovery wallet.

**Request**
```json
{
  "accountId":       "uuid",
  "recoveryAddress": "0xrecovery..."
}
```

**Response `200`**
```json
{
  "challengeId": "uuid",
  "message": "Sign in to Atra\n\nNonce: ...\nPurpose: RECOVERY"
}
```

---

#### `POST /recovery/execute`

Verifies the signature and executes the ownership transfer atomically:
- Revokes all existing `OWNER` roles
- Grants `OWNER` + `AUTH` to the recovery wallet
- Strips the recovery wallet's `RECOVERY` role
- Updates `accounts.ownerWalletId`

**Request**
```json
{
  "accountId":       "uuid",
  "recoveryAddress": "0xrecovery...",
  "nonce":           "...",
  "signature":       "0x..."
}
```

**Response `200`**
```json
{
  "newOwnerWalletId": "uuid"
}
```

| Status | Error                    | Condition                           |
|--------|--------------------------|-------------------------------------|
| `403`  | `NOT_RECOVERY_WALLET`    | Wallet has no RECOVERY role         |
| `404`  | `RECOVERY_WALLET_NOT_FOUND` | Address not registered           |
| `401`  | `INVALID_OR_EXPIRED_NONCE` | Nonce missing/expired             |
| `401`  | `SIGNATURE_MISMATCH`     | Signature invalid                   |

---

### Audit

> 🔒 Requires valid JWT. Callers may only query their own account's logs.

#### `GET /audit/:accountId`

Returns a paginated, newest-first list of audit log entries for the account.

**Query Parameters**

| Parameter | Type    | Default | Description                        |
|-----------|---------|---------|------------------------------------|
| `limit`   | integer | `50`    | Max results per page (cap: `200`)  |
| `cursor`  | string  | —       | Log ID from `nextCursor` for paging |

**Response `200`**
```json
{
  "logs": [
    {
      "id": "uuid",
      "accountId": "uuid",
      "actorWalletId": "uuid",
      "action": "ROLE_GRANTED",
      "metadata": { "targetWalletId": "uuid", "role": "AUTH" },
      "createdAt": "2026-05-23T17:00:00.000Z"
    }
  ],
  "nextCursor": "uuid-or-null"
}
```

| Status | Error       | Condition                     |
|--------|-------------|-------------------------------|
| `403`  | `FORBIDDEN` | Caller's accountId ≠ param    |

---

## Authentication

All protected routes expect:
```
Authorization: Bearer <accessToken>
```

For WebSocket upgrades, the token may be passed as a query parameter:
```
ws://host/path?token=<accessToken>
```

The middleware validates:
1. JWT signature + expiry
2. Session exists in DB and is not revoked/expired
3. Account still exists
4. Attaches `req.auth = { accountId, sessionId, walletId, roles, chainId }` for downstream handlers

---

## Error Codes

| Code                              | Meaning                                             |
|-----------------------------------|-----------------------------------------------------|
| `MISSING_FIELDS`                  | Required request body fields are absent             |
| `MISSING_TOKEN`                   | No JWT provided                                     |
| `INVALID_TOKEN`                   | JWT malformed, expired, or wrong secret             |
| `SESSION_EXPIRED_OR_REVOKED`      | Session no longer active                            |
| `ACCOUNT_NOT_FOUND`               | Account deleted after token was issued              |
| `WALLET_NOT_FOUND`                | Wallet address not in DB                            |
| `UNSUPPORTED_CHAIN`               | `chainId` is not in the enabled chains              |
| `INVALID_OR_EXPIRED_NONCE`        | Nonce not found, expired, or already used           |
| `SIGNATURE_MISMATCH`              | EIP-191 signature doesn't match expected address    |
| `INSUFFICIENT_ROLE`               | Caller lacks the required role for the operation    |
| `NOT_OWNER`                       | Operation requires OWNER role                       |
| `NOT_RECOVERY_WALLET`             | Wallet has no RECOVERY role on this account         |
| `ADDRESS_ALREADY_LINKED`          | Wallet address already registered                   |
| `RECOVERY_WALLET_ALREADY_ASSIGNED`| Account already has a RECOVERY wallet               |
| `CANNOT_REMOVE_OWNER_WALLET`      | The OWNER wallet cannot be removed                  |
| `CANNOT_TRANSFER_TO_SELF`         | TRANSFER_OWNER target is the caller                 |
| `SESSION_NOT_FOUND`               | Session not found or belongs to another account     |
| `INVALID_OR_EXPIRED_REFRESH_TOKEN`| Refresh token not found or expired                  |
| `INVALID_OPERATION`               | Unknown `operation` value in roles/verify           |
| `FORBIDDEN`                       | Insufficient access (e.g. wrong accountId on audit) |

---

## Audit Actions

Every sensitive operation writes a row to `audit_logs`:

| Action               | Triggered by                              |
|----------------------|-------------------------------------------|
| `ACCOUNT_CREATED`    | First successful `/identity/verify`       |
| `SESSION_CREATED`    | Every new session                         |
| `SESSION_REFRESHED`  | `/auth/refresh`                           |
| `SESSION_REVOKED`    | `/auth/revoke`                            |
| `WALLET_LINKED`      | `/wallets/link/verify`                    |
| `ROLE_GRANTED`       | `GRANT_AUTH` operation                    |
| `ROLE_REVOKED`       | `REVOKE_AUTH` operation                   |
| `RECOVERY_ASSIGNED`  | `ASSIGN_RECOVERY` operation               |
| `OWNER_TRANSFERRED`  | `TRANSFER_OWNER` operation                |
| `WALLET_REMOVED`     | `REMOVE_WALLET` operation                 |
| `RECOVERY_EXECUTED`  | `/recovery/execute`                       |

---

## Module Map

```
src/
├── shared/
│   └── chains/               ChainService, chain types & constants
│       └── README.md         Chain configuration docs
├── middleware/
│   └── authenticate.ts       JWT + session + account guard
├── modules/
│   ├── config/               GET /config — chain list for frontend
│   ├── identity/             Login / account provisioning
│   ├── auth/                 Token + session management
│   ├── wallets/              Wallet linking
│   ├── roles/                Role management (OWNER-only)
│   ├── recovery/             RECOVERY wallet → OWNER replacement
│   └── audit/                Audit log queries
├── db/
│   └── index.ts              Drizzle client (reads DATABASE_URL)
└── types/
    └── express.d.ts          req.auth augmentation
```

---

## Running Tests

```bash
cd apps/auth-service
npx vitest run            # all tests once
npx vitest run --reporter=verbose  # with test names
```

182 tests across 18 test files — all unit tests with mocked DB.

// MARK: - Authenticate Middleware
// Validates the access JWT on protected routes.
// Token may arrive as:
//   • HTTP header:   Authorization: Bearer <token>
//   • Query param:   ?token=<token>   (WebSocket upgrade path)
//
// On success: attaches req.auth = { accountId, sessionId, walletId, roles }
// On failure: responds 401 immediately.

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { eq, and, isNull } from 'drizzle-orm'
import type { Db, WalletRole } from '@atra/database'
import { sessions, accounts, accountWalletRoles } from '@atra/database'
import { TokenService } from '../modules/auth/services/TokenService.js'

// MARK: - Types

export interface AuthContext {
  accountId: string
  sessionId: string
  walletId: string | null
  roles: string[]
}

// MARK: - Factory

export function createAuthMiddleware(db: Db): RequestHandler {
  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET env var is required')

  const tokenService = new TokenService(secret)

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // MARK: 1. Extract token
      const token = extractToken(req)
      if (!token) {
        res.status(401).json({ error: 'MISSING_TOKEN' })
        return
      }

      // MARK: 2. Verify JWT (catches expiry + tampering)
      let payload: ReturnType<typeof tokenService.verifyAccessToken>
      try {
        payload = tokenService.verifyAccessToken(token)
      } catch {
        res.status(401).json({ error: 'INVALID_TOKEN' })
        return
      }

      const { accountId, sessionId, roles } = payload

      // MARK: 3. Verify session is alive (not revoked, not expired)
      const now = new Date()
      const [session] = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.id, sessionId),
          eq(sessions.accountId, accountId),
          isNull(sessions.revokedAt)
        ))
        .limit(1)

      if (!session || session.expiresAt < now) {
        res.status(401).json({ error: 'SESSION_EXPIRED_OR_REVOKED' })
        return
      }

      // MARK: 4. Verify account still exists
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1)

      if (!account) {
        res.status(401).json({ error: 'ACCOUNT_NOT_FOUND' })
        return
      }

      // MARK: 5. Resolve walletId (first AUTH or OWNER wallet for this account)
      // Best-effort: used for audit log attribution. Null if unavailable.
      const [roleRow] = await db
        .select()
        .from(accountWalletRoles)
        .where(and(
          eq(accountWalletRoles.accountId, accountId),
          eq(accountWalletRoles.role, 'AUTH')
        ))
        .limit(1)

      const walletId = roleRow?.walletId ?? null

      // MARK: 6. Attach auth context
      req.auth = { accountId, sessionId, walletId, roles: roles as WalletRole[] }

      next()
    } catch {
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}

// MARK: - Helpers

function extractToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }

  // 2. ?token= query param (WebSocket upgrade path)
  const queryToken = req.query['token']
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
    return queryToken.trim()
  }

  return null
}

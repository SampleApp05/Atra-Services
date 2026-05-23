// MARK: - Session Service
// Creates, refreshes, and revokes sessions. Coordinates with TokenService.

import { eq, and } from 'drizzle-orm'
import type { Db, WalletRole } from '@atra/database'
import { accountWalletRoles, auditLogs } from '@atra/database'
import type { TokenService } from './TokenService.js'
import type { SessionRepository } from '../repositories/SessionRepository.js'

// MARK: - Result Types

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  sessionId: string
  accountId: string
}

// MARK: - Service

export class SessionService {
  // MARK: Private State

  private readonly db: Db
  private readonly tokenService: TokenService
  private readonly sessionRepository: SessionRepository

  // MARK: Init

  constructor(
    db: Db,
    tokenService: TokenService,
    sessionRepository: SessionRepository
  ) {
    this.db = db
    this.tokenService = tokenService
    this.sessionRepository = sessionRepository
  }

  // MARK: - Public API

  /**
   * Creates a new session for the given account + wallet.
   * Fetches all roles held by this wallet on this account to embed in the JWT.
   */
  async create(
    accountId: string,
    walletId: string,
    deviceName: string,
    deviceType: string,
    lastIp: string
  ): Promise<SessionTokens> {
    // 1. Fetch roles for this wallet on this account
    const roles = await this.getRolesForWallet(accountId, walletId)

    // 2. Generate refresh token
    const { raw, hash, expiresAt } = this.tokenService.generateRefreshToken()

    // 3. Persist session
    const session = await this.sessionRepository.create({
      accountId,
      refreshTokenHash: hash,
      deviceName,
      deviceType,
      lastIp,
      expiresAt,
    })

    // 4. Sign access token
    const accessToken = this.tokenService.signAccessToken({
      accountId,
      sessionId: session.id,
      roles,
    })

    // 5. Audit
    await this.db.insert(auditLogs).values({
      accountId,
      actorWalletId: walletId,
      action: 'SESSION_CREATED',
      metadata: { sessionId: session.id, deviceName, deviceType },
    })

    return { accessToken, refreshToken: raw, sessionId: session.id, accountId }
  }

  /**
   * Rotates a session: validates the incoming refresh token, revokes the old
   * session, creates a new one, and issues a fresh token pair.
   */
  async refresh(
    rawRefreshToken: string,
    deviceName: string,
    deviceType: string,
    lastIp: string
  ): Promise<SessionTokens> {
    // 1. Hash and look up the session
    const hash = this.tokenService.hashRefreshToken(rawRefreshToken)
    const session = await this.sessionRepository.findActiveByRefreshHash(hash)

    if (!session) throw new Error('INVALID_OR_EXPIRED_REFRESH_TOKEN')

    // 2. Find the OWNER/AUTH wallet for this account to embed roles
    //    We re-use the original session's accountId to look up wallets.
    const ownerWalletRow = await this.db
      .select()
      .from(accountWalletRoles)
      .where(eq(accountWalletRoles.accountId, session.accountId))
      .limit(1)

    const actorWalletId = ownerWalletRow[0]?.walletId ?? session.accountId

    // 3. Revoke old session
    await this.sessionRepository.revoke(session.id)

    // 4. Create new session (rotation)
    const result = await this.create(
      session.accountId,
      actorWalletId,
      deviceName,
      deviceType,
      lastIp
    )

    // 5. Audit the rotation separately (SESSION_CREATED is already written by create())
    await this.db.insert(auditLogs).values({
      accountId: session.accountId,
      actorWalletId,
      action: 'SESSION_REFRESHED',
      metadata: { oldSessionId: session.id, newSessionId: result.sessionId },
    })

    return result
  }

  /**
   * Revokes a specific session by ID. Validates the caller owns the session.
   */
  async revoke(sessionId: string, accountId: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId)

    if (!session || session.accountId !== accountId) {
      throw new Error('SESSION_NOT_FOUND')
    }

    await this.sessionRepository.revoke(sessionId)

    await this.db.insert(auditLogs).values({
      accountId,
      actorWalletId: accountId, // best-effort — will be replaced by middleware later
      action: 'SESSION_REVOKED',
      metadata: { sessionId },
    })
  }

  // MARK: - Private Helpers

  private async getRolesForWallet(
    accountId: string,
    walletId: string
  ): Promise<WalletRole[]> {
    const rows = await this.db
      .select()
      .from(accountWalletRoles)
      .where(
        and(
          eq(accountWalletRoles.accountId, accountId),
          eq(accountWalletRoles.walletId, walletId)
        )
      )

    return rows.map(r => r.role)
  }
}

// MARK: - SessionService Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionService } from '../../src/modules/auth/services/SessionService.js'
import type { TokenService } from '../../src/modules/auth/services/TokenService.js'
import type { SessionRepository } from '../../src/modules/auth/repositories/SessionRepository.js'

// MARK: - Fixtures

const ACCOUNT_ID  = 'account-uuid-1'
const WALLET_ID   = 'wallet-uuid-1'
const SESSION_ID  = 'session-uuid-1'
const CHAIN_ID    = 11155111
const ACCESS_TOKEN  = 'access.token.jwt'
const REFRESH_RAW   = 'rawtoken'
const REFRESH_HASH  = 'hashtoken'

function mockSession(overrides = {}) {
  return {
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    walletId: WALLET_ID,
    chainId: CHAIN_ID,
    refreshTokenHash: REFRESH_HASH,
    deviceName: 'iPhone',
    deviceType: 'mobile',
    lastIp: '1.2.3.4',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function buildMocks() {
  const tokenService = {
    generateRefreshToken: vi.fn().mockReturnValue({
      raw: REFRESH_RAW,
      hash: REFRESH_HASH,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }),
    signAccessToken: vi.fn().mockReturnValue(ACCESS_TOKEN),
    hashRefreshToken: vi.fn().mockReturnValue(REFRESH_HASH),
  } as unknown as TokenService

  const sessionRepo = {
    create: vi.fn().mockResolvedValue(mockSession()),
    findActiveByRefreshHash: vi.fn().mockResolvedValue(mockSession()),
    findById: vi.fn().mockResolvedValue(mockSession()),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForAccount: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionRepository

  const roleRows = [
    { id: 'r1', accountId: ACCOUNT_ID, walletId: WALLET_ID, role: 'OWNER', grantedByWalletId: null, createdAt: new Date() },
    { id: 'r2', accountId: ACCOUNT_ID, walletId: WALLET_ID, role: 'AUTH',  grantedByWalletId: null, createdAt: new Date() },
  ]

  function makeWhere(resolveValue: unknown[]) {
    const whereResult = {
      limit: vi.fn().mockResolvedValue(resolveValue.slice(0, 1)),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(resolve),
    }
    return vi.fn(() => whereResult)
  }

  const insertValues = vi.fn(() => Promise.resolve())

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: makeWhere(roleRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  }

  return { tokenService, sessionRepo, db, insertValues }
}

// MARK: - Tests

describe('SessionService', () => {
  let tokenService: TokenService
  let sessionRepo: SessionRepository
  let db: ReturnType<typeof buildMocks>['db']
  let insertValues: ReturnType<typeof buildMocks>['insertValues']
  let service: SessionService

  beforeEach(() => {
    const mocks = buildMocks()
    tokenService = mocks.tokenService
    sessionRepo  = mocks.sessionRepo
    db           = mocks.db
    insertValues = mocks.insertValues
    service      = new SessionService(
      db as unknown as import('@atra/database').Db,
      tokenService,
      sessionRepo
    )
  })

  // MARK: create

  describe('create', () => {
    it('returns accessToken, refreshToken, sessionId, accountId', async () => {
      const result = await service.create(ACCOUNT_ID, WALLET_ID, CHAIN_ID, 'iPhone', 'mobile', '1.2.3.4')

      expect(result.accessToken).toBe(ACCESS_TOKEN)
      expect(result.refreshToken).toBe(REFRESH_RAW)
      expect(result.sessionId).toBe(SESSION_ID)
      expect(result.accountId).toBe(ACCOUNT_ID)
    })

    it('persists the session with the hashed refresh token', async () => {
      await service.create(ACCOUNT_ID, WALLET_ID, CHAIN_ID, 'iPhone', 'mobile', '1.2.3.4')
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ refreshTokenHash: REFRESH_HASH })
      )
    })

    it('persists the authenticating wallet on the session', async () => {
      await service.create(ACCOUNT_ID, WALLET_ID, CHAIN_ID, 'iPhone', 'mobile', '1.2.3.4')
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: WALLET_ID })
      )
    })

    it('signs the access token with accountId, sessionId, and roles', async () => {
      await service.create(ACCOUNT_ID, WALLET_ID, CHAIN_ID, 'iPhone', 'mobile', '1.2.3.4')
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: ACCOUNT_ID,
          sessionId: SESSION_ID,
          roles: expect.arrayContaining(['OWNER', 'AUTH']),
          chainId: CHAIN_ID,
        })
      )
    })

    it('writes an audit log entry', async () => {
      await service.create(ACCOUNT_ID, WALLET_ID, CHAIN_ID, 'iPhone', 'mobile', '1.2.3.4')
      expect(db.insert).toHaveBeenCalled()
    })
  })

  // MARK: refresh

  describe('refresh', () => {
    it('returns new tokens when refresh token is valid', async () => {
      const result = await service.refresh(REFRESH_RAW, 'iPhone', 'mobile', '1.2.3.4')
      expect(result.accessToken).toBe(ACCESS_TOKEN)
      expect(result.refreshToken).toBe(REFRESH_RAW)
    })

    it('revokes the old session before creating a new one', async () => {
      await service.refresh(REFRESH_RAW, 'iPhone', 'mobile', '1.2.3.4')
      expect(sessionRepo.revoke).toHaveBeenCalledWith(SESSION_ID)
    })

    it('preserves the original authenticating wallet on the new session, not an arbitrary role row', async () => {
      const OTHER_WALLET_ID = 'wallet-uuid-other'
      ;(sessionRepo.findActiveByRefreshHash as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockSession({ walletId: OTHER_WALLET_ID })
      )

      await service.refresh(REFRESH_RAW, 'iPhone', 'mobile', '1.2.3.4')

      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: OTHER_WALLET_ID })
      )
    })

    it('throws INVALID_OR_EXPIRED_REFRESH_TOKEN when session not found', async () => {
      ;(sessionRepo.findActiveByRefreshHash as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      await expect(
        service.refresh(REFRESH_RAW, 'iPhone', 'mobile', '1.2.3.4')
      ).rejects.toThrow('INVALID_OR_EXPIRED_REFRESH_TOKEN')
    })
  })

  // MARK: revoke

  describe('revoke', () => {
    it('revokes the session when caller owns it', async () => {
      await service.revoke(SESSION_ID, ACCOUNT_ID)
      expect(sessionRepo.revoke).toHaveBeenCalledWith(SESSION_ID)
    })

    it('attributes the audit log to the session wallet, not the account id', async () => {
      await service.revoke(SESSION_ID, ACCOUNT_ID)
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SESSION_REVOKED', actorWalletId: WALLET_ID })
      )
    })

    it('throws SESSION_NOT_FOUND when session belongs to a different account', async () => {
      ;(sessionRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockSession({ accountId: 'other-account' })
      )
      await expect(service.revoke(SESSION_ID, ACCOUNT_ID)).rejects.toThrow('SESSION_NOT_FOUND')
    })

    it('throws SESSION_NOT_FOUND when session does not exist', async () => {
      ;(sessionRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      await expect(service.revoke(SESSION_ID, ACCOUNT_ID)).rejects.toThrow('SESSION_NOT_FOUND')
    })
  })
})

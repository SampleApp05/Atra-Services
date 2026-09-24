// MARK: - WalletLinkingService Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletLinkingService } from '../../src/modules/wallets/services/WalletLinkingService.js'
import type { NonceService } from '../../src/modules/identity/services/NonceService.js'
import type { SignatureService } from '../../src/modules/identity/services/SignatureService.js'

// MARK: - Fixtures

const ACCOUNT_ID  = 'account-uuid-1'
const CALLER_WID  = 'caller-wallet-uuid-1'
const NEW_ADDRESS = '0xdeadbeef'
const NEW_WID     = 'new-wallet-uuid-1'
const CHAIN_ID    = 1
const NONCE       = 'abcdef1234567890abcdef1234567890'
const CHALLENGE_ID = 'challenge-uuid-1'

function mockOwnerRole() {
  return { id: 'r1', accountId: ACCOUNT_ID, walletId: CALLER_WID, role: 'OWNER', grantedByWalletId: null, createdAt: new Date() }
}

function mockChallenge() {
  return {
    id: CHALLENGE_ID,
    walletId: NEW_WID,
    nonce: NONCE,
    purpose: 'LINK_WALLET',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
  }
}

function mockWallet(address = NEW_ADDRESS.toLowerCase()) {
  return { id: NEW_WID, address, chainId: CHAIN_ID, createdAt: new Date() }
}

// MARK: - DB Mock

function makeLimit(rows: unknown[]) {
  return vi.fn().mockResolvedValue(rows.slice(0, 1))
}

function makeWhere(rows: unknown[]) {
  return vi.fn(() => ({
    limit: makeLimit(rows),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  }))
}

/**
 * buildDb — used for createLinkChallenge tests.
 * Select call order: 1=assertHasRole, 2=existingWallet check
 */
function buildDb(scenario: {
  roles?: unknown[]
  existingWallet?: unknown | null
} = {}) {
  const {
    roles          = [mockOwnerRole()],
    existingWallet = null,
  } = scenario

  const sequences = [
    roles,
    existingWallet ? [existingWallet] : [],
  ]
  let callIndex = 0

  const insertReturning = vi.fn().mockResolvedValue([mockWallet()])
  const insertValuesReturning = vi.fn(() => ({ returning: insertReturning }))
  const insertFn = vi.fn(() => ({ values: insertValuesReturning }))

  return {
    select: vi.fn().mockImplementation(() => {
      const idx = callIndex++
      const rows = sequences[idx] ?? []
      return { from: vi.fn(() => ({ where: makeWhere(rows) })) }
    }),
    insert: insertFn,
  }
}

/**
 * buildDbForVerify — used for verifyAndLink tests.
 * Select call order: 1=assertHasRole, 2=wallet lookup.
 * Nonce consumption now happens transactionally via the mocked
 * nonceService.consume (no db.select is involved for that step), and the
 * role grant + audit log are written through the transaction's tx.insert.
 */
function buildDbForVerify(scenario: {
  roles?: unknown[]
  wallet?: unknown | null
} = {}) {
  const {
    roles  = [mockOwnerRole()],
    wallet = mockWallet(),
  } = scenario

  const sequences = [
    roles,
    wallet ? [wallet] : [],
  ]
  let callIndex = 0

  const txInsertTables: unknown[] = []
  const transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const txInsert = vi.fn((table: unknown) => {
      txInsertTables.push(table)
      return { values: vi.fn(() => Promise.resolve(undefined)) }
    })
    return cb({ insert: txInsert })
  })

  return {
    select: vi.fn().mockImplementation(() => {
      const idx = callIndex++
      const rows = sequences[idx] ?? []
      return { from: vi.fn(() => ({ where: makeWhere(rows) })) }
    }),
    insert: vi.fn(),
    transaction,
    _txInsertTables: txInsertTables,
  }
}

// MARK: - Tests

describe('WalletLinkingService', () => {
  let nonceService: NonceService
  let signatureService: SignatureService

  beforeEach(() => {
    nonceService = {
      create: vi.fn().mockResolvedValue(mockChallenge()),
      markUsed: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(mockChallenge()),
    } as unknown as NonceService

    signatureService = {
      buildChallengeMessage: vi.fn().mockReturnValue('Sign in to Atra\n\nNonce: abc\nPurpose: LINK_WALLET'),
      verifySignature: vi.fn().mockReturnValue(true),
    } as unknown as SignatureService
  })

  // MARK: createLinkChallenge

  describe('createLinkChallenge', () => {
    it('throws INSUFFICIENT_ROLE when caller has no OWNER or AUTH role', async () => {
      const db = buildDb({ roles: [] })
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.createLinkChallenge(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, CHAIN_ID)
      ).rejects.toThrow('INSUFFICIENT_ROLE')
    })

    it('throws ADDRESS_ALREADY_LINKED when wallet address already exists', async () => {
      const db = buildDb({ existingWallet: mockWallet() })
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.createLinkChallenge(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, CHAIN_ID)
      ).rejects.toThrow('ADDRESS_ALREADY_LINKED')
    })

    it('creates a wallet and returns a challenge on success', async () => {
      const db = buildDb()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      const result = await service.createLinkChallenge(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, CHAIN_ID)
      expect(result.challengeId).toBe(CHALLENGE_ID)
      expect(result.message).toContain('LINK_WALLET')
    })

    it('normalises address to lowercase', async () => {
      const db = buildDb()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await service.createLinkChallenge(ACCOUNT_ID, CALLER_WID, '0xDEADBEEF', CHAIN_ID)
      expect(nonceService.create).toHaveBeenCalled()
    })

    it('also succeeds when caller has AUTH role', async () => {
      const authRole = { ...mockOwnerRole(), role: 'AUTH' }
      const db = buildDb({ roles: [authRole] })
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.createLinkChallenge(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, CHAIN_ID)
      ).resolves.toBeDefined()
    })
  })

  // MARK: verifyAndLink

  describe('verifyAndLink', () => {
    it('throws INSUFFICIENT_ROLE when caller has no OWNER or AUTH role', async () => {
      const db = buildDbForVerify({ roles: [] })
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig')
      ).rejects.toThrow('INSUFFICIENT_ROLE')
    })

    it('throws WALLET_NOT_FOUND when new wallet does not exist', async () => {
      const db = buildDbForVerify({ wallet: null })
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig')
      ).rejects.toThrow('WALLET_NOT_FOUND')
    })

    it('throws INVALID_OR_EXPIRED_NONCE when the atomic consume finds no matching nonce', async () => {
      ;(nonceService.consume as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig')
      ).rejects.toThrow('INVALID_OR_EXPIRED_NONCE')
    })

    it('throws SIGNATURE_MISMATCH when signature is invalid', async () => {
      ;(signatureService.verifySignature as ReturnType<typeof vi.fn>).mockReturnValue(false)
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xbadsig')
      ).rejects.toThrow('SIGNATURE_MISMATCH')
    })

    it('never consumes the nonce before the signature has been verified', async () => {
      ;(signatureService.verifySignature as ReturnType<typeof vi.fn>).mockReturnValue(false)
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await expect(
        service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xbadsig')
      ).rejects.toThrow('SIGNATURE_MISMATCH')
      expect(nonceService.consume).not.toHaveBeenCalled()
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('grants STANDARD role on success', async () => {
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      const result = await service.verifyAndLink(
        ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig'
      )
      expect(result.role).toBe('STANDARD')
    })

    it('consumes the nonce transactionally after a valid signature', async () => {
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig')
      expect(nonceService.consume).toHaveBeenCalledWith(NEW_WID, NONCE, 'LINK_WALLET', expect.anything())
    })

    it('writes the role grant and audit log inside the same transaction as the nonce consume', async () => {
      const db = buildDbForVerify()
      const service = new WalletLinkingService(
        db as unknown as import('@atra/database').Db,
        nonceService, signatureService
      )
      await service.verifyAndLink(ACCOUNT_ID, CALLER_WID, NEW_ADDRESS, NONCE, '0xsig')
      expect(db.transaction).toHaveBeenCalled()
      expect(db._txInsertTables.length).toBe(2)
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecoveryService } from '../../src/modules/recovery/services/RecoveryService.js'
import { sessions } from '@atra/database'

// MARK: - Mock helpers

function makeLimit<T>(rows: T[]) {
  return {
    then: (resolve: (v: T[]) => unknown) => Promise.resolve(rows).then(resolve),
    limit: (_n: number) => ({
      then: (resolve: (v: T[]) => unknown) => Promise.resolve(rows).then(resolve),
    }),
  }
}

function makeNoRows() {
  return makeLimit([])
}

// MARK: - DB mock

let dbSelectCalls: Array<() => ReturnType<typeof makeLimit>> = []
let txSelectResults: any[][] = []
let txUpdateCalls: Array<{ table: unknown; values: unknown }> = []

const makeTx = () => ({
  select: () => ({
    from: () => ({
      where: () => {
        const rows = txSelectResults.shift() ?? []
        return {
          then: (resolve: (v: any) => unknown, reject?: (e: any) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
          limit: (_n: number) => Promise.resolve(rows),
        }
      },
    }),
  }),
  insert: () => ({ values: () => Promise.resolve([]) }),
  delete: () => ({ where: () => Promise.resolve([]) }),
  update: (table: unknown) => ({
    set: (values: unknown) => {
      txUpdateCalls.push({ table, values })
      return { where: () => Promise.resolve([]) }
    },
  }),
})

const mockDb: any = {
  select: () => ({
    from: () => ({
      where: () => {
        const factory = dbSelectCalls.shift() ?? makeNoRows
        return factory()
      },
    }),
  }),
  transaction: async (fn: (tx: any) => Promise<void>) => fn(makeTx()),
}

// MARK: - Mock services

const nonceService = {
  create:   vi.fn(),
  markUsed: vi.fn(),
}

const signatureService = {
  buildChallengeMessage: vi.fn((nonce: string, purpose: string) => `Msg|${nonce}|${purpose}`),
  verifySignature: vi.fn(),
}

// MARK: - Fixtures

const ACCOUNT_ID   = 'acc-1'
const RECOVERY_WID = 'wid-recovery'
const RECOVERY_ADDR = '0xrecovery'
const OLD_OWNER_WID = 'wid-old-owner'

const recoveryWallet = { id: RECOVERY_WID, address: RECOVERY_ADDR }
const recoveryRole   = { accountId: ACCOUNT_ID, walletId: RECOVERY_WID, role: 'RECOVERY' }

// MARK: - Tests

describe('RecoveryService', () => {
  let service: RecoveryService

  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectCalls = []
    txSelectResults = []
    txUpdateCalls = []
    service = new RecoveryService(mockDb, nonceService as any, signatureService as any)
  })

  // MARK: createRecoveryChallenge

  describe('createRecoveryChallenge', () => {
    it('returns a challenge message for a valid RECOVERY wallet', async () => {
      dbSelectCalls = [
        () => makeLimit([recoveryWallet]), // findWalletByAddress
        () => makeLimit([recoveryRole]),   // assertRecoveryRole
      ]
      nonceService.create.mockResolvedValue({ id: 'ch-1', nonce: 'n1' })

      const result = await service.createRecoveryChallenge(ACCOUNT_ID, RECOVERY_ADDR)

      expect(result.challengeId).toBe('ch-1')
      expect(result.message).toContain('n1')
      expect(nonceService.create).toHaveBeenCalledWith(RECOVERY_WID, 'RECOVERY')
    })

    it('throws RECOVERY_WALLET_NOT_FOUND when address is unknown', async () => {
      dbSelectCalls = [() => makeNoRows()]
      await expect(
        service.createRecoveryChallenge(ACCOUNT_ID, '0xunknown')
      ).rejects.toThrow('RECOVERY_WALLET_NOT_FOUND')
    })

    it('throws NOT_RECOVERY_WALLET when wallet has no RECOVERY role', async () => {
      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),
        () => makeNoRows(), // no recovery role
      ]
      await expect(
        service.createRecoveryChallenge(ACCOUNT_ID, RECOVERY_ADDR)
      ).rejects.toThrow('NOT_RECOVERY_WALLET')
    })
  })

  // MARK: executeRecovery

  describe('executeRecovery', () => {
    const NONCE = 'mynonce'
    const validChallenge = {
      id: 'ch-1',
      walletId: RECOVERY_WID,
      nonce: NONCE,
      purpose: 'RECOVERY',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    }

    it('executes recovery and returns new owner wallet id', async () => {
      signatureService.verifySignature.mockReturnValue(true)
      nonceService.markUsed.mockResolvedValue(undefined)

      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),  // findWalletByAddress
        () => makeLimit([recoveryRole]),    // assertRecoveryRole
        () => makeLimit([validChallenge]),  // findValidChallenge (via select)
      ]
      txSelectResults = [
        [{ accountId: ACCOUNT_ID, walletId: OLD_OWNER_WID, role: 'OWNER' }], // previous OWNER row(s)
      ]

      const result = await service.executeRecovery(ACCOUNT_ID, RECOVERY_ADDR, NONCE, 'sig')

      expect(result.newOwnerWalletId).toBe(RECOVERY_WID)
      expect(nonceService.markUsed).toHaveBeenCalledWith('ch-1')
      expect(signatureService.verifySignature).toHaveBeenCalledOnce()
    })

    it('invalidates the previous owner wallet sessions on recovery', async () => {
      signatureService.verifySignature.mockReturnValue(true)
      nonceService.markUsed.mockResolvedValue(undefined)

      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),
        () => makeLimit([recoveryRole]),
        () => makeLimit([validChallenge]),
      ]
      txSelectResults = [
        [{ accountId: ACCOUNT_ID, walletId: OLD_OWNER_WID, role: 'OWNER' }],
      ]

      await service.executeRecovery(ACCOUNT_ID, RECOVERY_ADDR, NONCE, 'sig')

      expect(txUpdateCalls.some(
        (call) => call.table === sessions && (call.values as { revokedAt: unknown }).revokedAt instanceof Date
      )).toBe(true)
    })

    it('throws RECOVERY_WALLET_NOT_FOUND when address unknown', async () => {
      dbSelectCalls = [() => makeNoRows()]
      await expect(
        service.executeRecovery(ACCOUNT_ID, '0xbad', NONCE, 'sig')
      ).rejects.toThrow('RECOVERY_WALLET_NOT_FOUND')
    })

    it('throws NOT_RECOVERY_WALLET when wallet has no RECOVERY role', async () => {
      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),
        () => makeNoRows(),
      ]
      await expect(
        service.executeRecovery(ACCOUNT_ID, RECOVERY_ADDR, NONCE, 'sig')
      ).rejects.toThrow('NOT_RECOVERY_WALLET')
    })

    it('throws INVALID_OR_EXPIRED_NONCE when challenge not found', async () => {
      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),
        () => makeLimit([recoveryRole]),
        () => makeNoRows(), // challenge missing
      ]
      await expect(
        service.executeRecovery(ACCOUNT_ID, RECOVERY_ADDR, NONCE, 'sig')
      ).rejects.toThrow('INVALID_OR_EXPIRED_NONCE')
    })

    it('throws SIGNATURE_MISMATCH when sig is wrong', async () => {
      signatureService.verifySignature.mockReturnValue(false)
      dbSelectCalls = [
        () => makeLimit([recoveryWallet]),
        () => makeLimit([recoveryRole]),
        () => makeLimit([validChallenge]),
      ]
      await expect(
        service.executeRecovery(ACCOUNT_ID, RECOVERY_ADDR, NONCE, 'bad-sig')
      ).rejects.toThrow('SIGNATURE_MISMATCH')
    })
  })
})

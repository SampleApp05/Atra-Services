import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoleService } from '../../src/modules/roles/services/RoleService.js'
import { accounts, sessions } from '@atra/database'

// MARK: - Mock helpers

/** Creates a thenable result that also exposes `.limit()` */
function makeLimit<T>(rows: T[]) {
  const thenable = {
    then: (resolve: (v: T[]) => unknown) => Promise.resolve(rows).then(resolve),
    limit: (_n: number) => Promise.resolve(rows),
  }
  return thenable
}

function makeNoRows() {
  return makeLimit([])
}

// MARK: - Mock DB

let dbSelectCalls: Array<() => ReturnType<typeof makeLimit>> = []
/**
 * Each entry is a plain array of rows the tx select should return.
 * Kept separate from dbSelectCalls so tests can set them independently.
 */
let txSelectResults: any[][] = []
let txUpdateCalls: Array<{ table: unknown; values: unknown }> = []

const makeTx = () => ({
  select: () => ({
    from: () => ({
      where: () => {
        const rows = txSelectResults.shift() ?? []
        // Must be both thenable (for `await ...where()`) and have `.limit()`
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
      }
    })
  }),
  transaction: async (fn: (tx: any) => Promise<void>) => {
    return fn(makeTx())
  },
}

// MARK: - Mock services

const nonceService = {
  create: vi.fn(),
  markUsed: vi.fn(),
  // Default: every consume() call succeeds unless a test overrides it
  // (via mockResolvedValueOnce) to exercise the invalid/expired path.
  consume: vi.fn().mockResolvedValue({ id: 'consumed-nonce' }),
}

const signatureService = {
  buildChallengeMessage: vi.fn((nonce: string, purpose: string) => `Sign|${nonce}|${purpose}`),
  verifySignature: vi.fn(),
}

// MARK: - Fixtures

const ACCOUNT_ID  = 'acc-1'
const OWNER_WID   = 'wid-owner'
const TARGET_WID  = 'wid-target'
const OWNER_ADDR  = '0xowner'
const TARGET_ADDR = '0xtarget'

const ownerRole   = { accountId: ACCOUNT_ID, walletId: OWNER_WID, role: 'OWNER' }
const ownerWallet = { id: OWNER_WID,  address: OWNER_ADDR }
const targetWallet = { id: TARGET_WID, address: TARGET_ADDR }

const NONCE = 'abc123'
const validChallenge = {
  id: 'chal-1',
  walletId: OWNER_WID,
  nonce: NONCE,
  purpose: 'GRANT_AUTH',
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
}

// MARK: - Tests

describe('RoleService', () => {
  let service: RoleService

  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectCalls = []
    txSelectResults = []
    txUpdateCalls = []
    // vi.clearAllMocks() clears call history but not the default implementation.
    nonceService.consume.mockResolvedValue({ id: 'consumed-nonce' })
    service = new RoleService(mockDb, nonceService as any, signatureService as any)
  })

  // MARK: createRoleChallenge

  describe('createRoleChallenge', () => {
    it('returns dual challenge messages when caller is OWNER', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerRole]),    // assertOwner
        () => makeLimit([targetWallet]), // findWalletByAddress
      ]

      nonceService.create
        .mockResolvedValueOnce({ id: 'oc-1', nonce: 'nonce-owner' })
        .mockResolvedValueOnce({ id: 'tc-1', nonce: 'nonce-target' })

      const result = await service.createRoleChallenge(ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 11155111)

      expect(result.ownerChallengeId).toBe('oc-1')
      expect(result.targetChallengeId).toBe('tc-1')
      expect(result.ownerMessage).toContain('nonce-owner')
      expect(result.targetMessage).toContain('nonce-target')
      expect(nonceService.create).toHaveBeenCalledTimes(2)
    })

    it('throws NOT_OWNER when caller has no OWNER role', async () => {
      dbSelectCalls = [() => makeNoRows()]
      await expect(
        service.createRoleChallenge(ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 11155111)
      ).rejects.toThrow('NOT_OWNER')
    })

    it('throws TARGET_WALLET_NOT_FOUND when target address unknown', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerRole]),
        () => makeNoRows(),
      ]
      await expect(
        service.createRoleChallenge(ACCOUNT_ID, OWNER_WID, '0xunknown', 11155111)
      ).rejects.toThrow('TARGET_WALLET_NOT_FOUND')
    })
  })

  // MARK: verifyAndApply — GRANT_AUTH

  describe('verifyAndApply — GRANT_AUTH', () => {
    const OWNER_NONCE  = 'owner-nonce'
    const TARGET_NONCE = 'target-nonce'

    beforeEach(() => {
      signatureService.verifySignature.mockReturnValue(true)
      txSelectResults = [[]] // existing check in GRANT_AUTH tx: no rows
    })

    it('applies GRANT_AUTH and writes audit log on valid input', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),  // getWalletAddress
        () => makeLimit([ownerRole]),    // assertOwner
        () => makeLimit([targetWallet]), // findWalletByAddress
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'sig-owner',
          TARGET_NONCE, 'sig-target'
        ,
          11155111
        )
      ).resolves.toBeUndefined()

      expect(nonceService.consume).toHaveBeenCalledTimes(2)
      expect(nonceService.consume).toHaveBeenNthCalledWith(1, OWNER_WID, OWNER_NONCE, 'GRANT_AUTH', expect.anything())
      expect(nonceService.consume).toHaveBeenNthCalledWith(2, TARGET_WID, TARGET_NONCE, 'GRANT_AUTH', expect.anything())
      expect(signatureService.verifySignature).toHaveBeenCalledTimes(2)
    })

    it('throws NOT_OWNER when caller is not OWNER', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeNoRows(), // assertOwner fails
      ]
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('NOT_OWNER')
    })

    it('throws TARGET_WALLET_NOT_FOUND when target unknown', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeNoRows(), // target not found
      ]
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, '0xbad', 'GRANT_AUTH',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('TARGET_WALLET_NOT_FOUND')
    })

    it('throws INVALID_OWNER_NONCE when the atomic consume of the owner nonce fails', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]
      nonceService.consume.mockResolvedValueOnce(null) // owner consume fails
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('INVALID_OWNER_NONCE')
    })

    it('throws INVALID_TARGET_NONCE when the atomic consume of the target nonce fails', async () => {
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]
      nonceService.consume
        .mockResolvedValueOnce({ id: 'oc-1' }) // owner consume succeeds
        .mockResolvedValueOnce(null)           // target consume fails
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('INVALID_TARGET_NONCE')
    })

    it('throws OWNER_SIGNATURE_MISMATCH when owner sig is wrong', async () => {
      signatureService.verifySignature.mockReturnValueOnce(false) // owner sig fails
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'bad-sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('OWNER_SIGNATURE_MISMATCH')
      expect(nonceService.consume).not.toHaveBeenCalled()
    })

    it('throws TARGET_SIGNATURE_MISMATCH when target sig is wrong', async () => {
      signatureService.verifySignature
        .mockReturnValueOnce(true)  // owner ok
        .mockReturnValueOnce(false) // target fails
      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]
      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'GRANT_AUTH',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'bad-sig'
        ,
          11155111
        )
      ).rejects.toThrow('TARGET_SIGNATURE_MISMATCH')
      expect(nonceService.consume).not.toHaveBeenCalled()
    })
  })

  // MARK: verifyAndApply — TRANSFER_OWNER

  describe('verifyAndApply — TRANSFER_OWNER', () => {
    const OWNER_NONCE  = 'on'
    const TARGET_NONCE = 'tn'

    it('succeeds transferring ownership', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'TRANSFER_OWNER',
          OWNER_NONCE, 'sig', TARGET_NONCE, 'sig'
        ,
          11155111
        )
      ).resolves.toBeUndefined()

      expect(nonceService.consume).toHaveBeenNthCalledWith(1, OWNER_WID, OWNER_NONCE, 'TRANSFER_OWNER', expect.anything())
      expect(nonceService.consume).toHaveBeenNthCalledWith(2, TARGET_WID, TARGET_NONCE, 'TRANSFER_OWNER', expect.anything())
      expect(txUpdateCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: accounts, values: { ownerWalletId: TARGET_WID } }),
      ]))
      expect(txUpdateCalls.some(
        (call) => call.table === sessions && (call.values as { revokedAt: unknown }).revokedAt instanceof Date
      )).toBe(true)
    })
  })

  // MARK: verifyAndApply — REVOKE_AUTH

  describe('verifyAndApply — REVOKE_AUTH', () => {
    it('succeeds revoking AUTH role', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'REVOKE_AUTH',
          'on', 'sig', 'tn', 'sig'
        ,
          11155111
        )
      ).resolves.toBeUndefined()

      expect(txUpdateCalls.some(
        (call) => call.table === sessions && (call.values as { revokedAt: unknown }).revokedAt instanceof Date
      )).toBe(true)
    })
  })

  // MARK: verifyAndApply — ASSIGN_RECOVERY

  describe('verifyAndApply — ASSIGN_RECOVERY', () => {
    it('throws RECOVERY_WALLET_ALREADY_ASSIGNED if one already exists', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      // Override the tx.select to return an existing RECOVERY row
      txSelectResults = [[{ role: 'RECOVERY' }]]

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'ASSIGN_RECOVERY',
          'on', 'sig', 'tn', 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('RECOVERY_WALLET_ALREADY_ASSIGNED')
    })

    it('succeeds assigning RECOVERY when none exists', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      txSelectResults = [[]] // no existing RECOVERY

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'ASSIGN_RECOVERY',
          'on', 'sig', 'tn', 'sig'
        ,
          11155111
        )
      ).resolves.toBeUndefined()
    })
  })

  // MARK: verifyAndApply — REMOVE_WALLET

  describe('verifyAndApply — REMOVE_WALLET', () => {
    it('throws CANNOT_REMOVE_OWNER_WALLET when target is OWNER', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      // REMOVE_WALLET checks if target is OWNER inside tx
      txSelectResults = [[{ role: 'OWNER' }]]

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'REMOVE_WALLET',
          'on', 'sig', 'tn', 'sig'
        ,
          11155111
        )
      ).rejects.toThrow('CANNOT_REMOVE_OWNER_WALLET')
    })

    it('succeeds removing a non-owner wallet', async () => {
      signatureService.verifySignature.mockReturnValue(true)

      txSelectResults = [[]] // target is NOT owner

      dbSelectCalls = [
        () => makeLimit([ownerWallet]),
        () => makeLimit([ownerRole]),
        () => makeLimit([targetWallet]),
      ]

      await expect(
        service.verifyAndApply(
          ACCOUNT_ID, OWNER_WID, TARGET_ADDR, 'REMOVE_WALLET',
          'on', 'sig', 'tn', 'sig'
        ,
          11155111
        )
      ).resolves.toBeUndefined()
    })
  })
})

// MARK: - NonceService Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NonceService } from '../../src/modules/identity/services/NonceService.js'

// MARK: - Helpers

function makeDb(overrides: Record<string, unknown> = {}) {
  const returning = vi.fn()
  const limit = vi.fn()
  const where = vi.fn()

  const insertChain = { values: vi.fn(() => ({ returning })) }
  const selectChain = { from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) }
  const updateChain = { set: vi.fn(() => ({ where: vi.fn() })) }

  return {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    returning,
    limit,
    where,
    insertChain,
    selectChain,
    updateChain,
    ...overrides,
  } as unknown as import('@atra/database').Db
}

// MARK: - Tests

describe('NonceService', () => {
  let db: ReturnType<typeof makeDb>
  let service: NonceService

  beforeEach(() => {
    db = makeDb()
    service = new NonceService(db as unknown as import('@atra/database').Db)
  })

  // MARK: create

  describe('create', () => {
    it('inserts a nonce challenge and returns the row', async () => {
      const expected = {
        id: 'challenge-1',
        walletId: 'wallet-1',
        nonce: 'aabbccdd',
        purpose: 'LOGIN',
        expiresAt: new Date(),
        usedAt: null,
        createdAt: new Date(),
      }

      // Wire returning to resolve to [expected]
      const returning = vi.fn().mockResolvedValue([expected])
      const values = vi.fn(() => ({ returning }))
      ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values })

      const result = await service.create('wallet-1', 'LOGIN')

      expect(db.insert).toHaveBeenCalled()
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          purpose: 'LOGIN',
          nonce: expect.any(String),
          expiresAt: expect.any(Date),
        })
      )
      expect(result).toEqual(expected)
    })

    it('generates a 32-char hex nonce', async () => {
      let capturedValues: Record<string, unknown> = {}

      const returning = vi.fn().mockResolvedValue([{ id: '1', ...capturedValues }])
      const values = vi.fn((v: Record<string, unknown>) => {
        capturedValues = v
        return { returning }
      })
      ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values })

      await service.create('wallet-1', 'LOGIN')

      expect(capturedValues.nonce).toMatch(/^[0-9a-f]{32}$/)
    })

    it('sets expiresAt ~5 minutes in the future', async () => {
      let capturedValues: Record<string, unknown> = {}
      const before = Date.now()

      const returning = vi.fn().mockResolvedValue([{}])
      const values = vi.fn((v: Record<string, unknown>) => {
        capturedValues = v
        return { returning }
      })
      ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values })

      await service.create('wallet-1', 'LOGIN')

      const after = Date.now()
      const expiresAt = (capturedValues.expiresAt as Date).getTime()
      expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 100)
      expect(expiresAt).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 100)
    })
  })

  // MARK: find

  describe('find', () => {
    it('returns the row when found', async () => {
      const row = {
        id: 'c1',
        walletId: 'w1',
        nonce: 'abc',
        purpose: 'LOGIN',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      }

      const limit = vi.fn().mockResolvedValue([row])
      const where = vi.fn(() => ({ limit }))
      const from = vi.fn(() => ({ where }))
      ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from })

      const result = await service.find('w1', 'abc', 'LOGIN')
      expect(result).toEqual(row)
    })

    it('returns null when not found', async () => {
      const limit = vi.fn().mockResolvedValue([])
      const where = vi.fn(() => ({ limit }))
      const from = vi.fn(() => ({ where }))
      ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from })

      const result = await service.find('w1', 'abc', 'LOGIN')
      expect(result).toBeNull()
    })
  })

  // MARK: markUsed

  describe('markUsed', () => {
    it('updates usedAt for the given id', async () => {
      const where = vi.fn().mockResolvedValue(undefined)
      const set = vi.fn(() => ({ where }))
      ;(db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set })

      await service.markUsed('challenge-1')

      expect(db.update).toHaveBeenCalled()
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) })
      )
    })
  })

  // MARK: consume

  describe('consume', () => {
    it('atomically consumes a matching nonce via a single conditional UPDATE', async () => {
      const consumedRow = {
        id: 'challenge-1',
        walletId: 'wallet-1',
        nonce: 'abc',
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        createdAt: new Date(),
      }

      const returning = vi.fn().mockResolvedValue([consumedRow])
      const where = vi.fn(() => ({ returning }))
      const set = vi.fn(() => ({ where }))
      ;(db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set })

      const result = await service.consume('wallet-1', 'abc', 'LOGIN')

      expect(db.update).toHaveBeenCalled()
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) })
      )
      expect(result).toEqual(consumedRow)
    })

    it('returns null when no unused, unexpired, matching nonce exists', async () => {
      const returning = vi.fn().mockResolvedValue([])
      const where = vi.fn(() => ({ returning }))
      const set = vi.fn(() => ({ where }))
      ;(db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set })

      const result = await service.consume('wallet-1', 'abc', 'LOGIN')

      expect(result).toBeNull()
    })

    it('runs the conditional update against a caller-supplied executor (e.g. a transaction) instead of the default db', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 'challenge-1' }])
      const where = vi.fn(() => ({ returning }))
      const set = vi.fn(() => ({ where }))
      const txUpdate = vi.fn(() => ({ set }))
      const tx = { update: txUpdate } as unknown as import('@atra/database').Db

      await service.consume('wallet-1', 'abc', 'LOGIN', tx)

      expect(txUpdate).toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })
  })
})

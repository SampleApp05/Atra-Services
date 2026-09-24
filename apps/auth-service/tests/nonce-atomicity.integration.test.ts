// MARK: - Nonce Consume Atomicity Integration Tests
// Requires a live, migrated PostgreSQL database (the disposable WF-0002 environment).
// Skips entirely when DATABASE_URL is not set — these are NOT unit tests and must
// not run against mocks; the atomicity guarantee (a single conditional UPDATE)
// only exists at the database level, so it can only be proven against real Postgres.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { createDb, type Db } from '@atra/database'
import { wallets, nonceChallenges } from '@atra/database'
import { NonceRepository } from '../src/modules/identity/repositories/NonceRepository.js'
import { NonceService } from '../src/modules/identity/services/NonceService.js'

const DATABASE_URL = process.env['DATABASE_URL']

function randomAddress(): string {
  return `0x${randomBytes(20).toString('hex')}`
}

describe.skipIf(!DATABASE_URL)('nonce consume atomicity (integration)', () => {
  let db: Db
  let repository: NonceRepository
  let service: NonceService
  const createdWalletIds: string[] = []

  beforeAll(() => {
    db = createDb(DATABASE_URL as string)
    repository = new NonceRepository(db)
    service = new NonceService(db)
  })

  afterAll(async () => {
    if (!db) return
    for (const walletId of createdWalletIds) {
      await db.delete(nonceChallenges).where(eq(nonceChallenges.walletId, walletId))
      await db.delete(wallets).where(eq(wallets.id, walletId))
    }
  })

  async function seedWallet() {
    const [wallet] = await db
      .insert(wallets)
      .values({ address: randomAddress(), chainId: 11155111 })
      .returning()
    createdWalletIds.push(wallet.id)
    return wallet
  }

  async function seedChallenge(walletId: string, expiresAt = new Date(Date.now() + 60_000)) {
    const [challenge] = await db
      .insert(nonceChallenges)
      .values({
        walletId,
        nonce: randomBytes(16).toString('hex'),
        purpose: 'LOGIN',
        expiresAt,
      })
      .returning()
    return challenge
  }

  // MARK: Concurrent consumers race the same nonce

  it('lets exactly one of many concurrent consumers win a race for the same nonce', async () => {
    const wallet = await seedWallet()
    const challenge = await seedChallenge(wallet.id)

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.consume(db, wallet.id, challenge.nonce, 'LOGIN')
      )
    )

    const winners = results.filter((r) => r !== null)
    expect(winners.length).toBe(1)
    expect(winners[0]?.id).toBe(challenge.id)
  })

  // MARK: Single-use

  it('never lets a second consume succeed once a nonce has been used', async () => {
    const wallet = await seedWallet()
    const challenge = await seedChallenge(wallet.id)

    const first  = await service.consume(wallet.id, challenge.nonce, 'LOGIN')
    const second = await service.consume(wallet.id, challenge.nonce, 'LOGIN')

    expect(first?.id).toBe(challenge.id)
    expect(second).toBeNull()
  })

  // MARK: Expiry

  it('does not consume an expired nonce', async () => {
    const wallet = await seedWallet()
    const expired = await seedChallenge(wallet.id, new Date(Date.now() - 1_000))

    const result = await service.consume(wallet.id, expired.nonce, 'LOGIN')
    expect(result).toBeNull()
  })

  // MARK: Transactional rollback

  it('rolls back the consume when the enclosing transaction throws, leaving the nonce usable again', async () => {
    const wallet = await seedWallet()
    const challenge = await seedChallenge(wallet.id)

    await expect(
      db.transaction(async (tx) => {
        const consumed = await service.consume(wallet.id, challenge.nonce, 'LOGIN', tx)
        expect(consumed?.id).toBe(challenge.id)
        throw new Error('simulated failure after consume')
      })
    ).rejects.toThrow('simulated failure after consume')

    const retried = await service.consume(wallet.id, challenge.nonce, 'LOGIN')
    expect(retried?.id).toBe(challenge.id)
  })
})

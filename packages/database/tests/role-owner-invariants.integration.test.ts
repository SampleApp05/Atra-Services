// MARK: - Role/Owner Invariant Integration Tests
// Requires a live, migrated PostgreSQL database (the disposable WF-0002 environment).
// Skips entirely when DATABASE_URL is not set — these are NOT unit tests and must
// not run against mocks; REQ-DATA-006/REQ-NONCE-004 require real database evidence.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { createDb, type Db } from '../src/client.js'
import { wallets, accounts, accountWalletRoles } from '../src/schema/index.js'

const DATABASE_URL = process.env['DATABASE_URL']

function randomAddress(): string {
  return `0x${randomBytes(20).toString('hex')}`
}

describe.skipIf(!DATABASE_URL)('role/owner invariants (integration)', () => {
  let db: Db
  const createdAccountIds: string[] = []
  const createdWalletIds: string[] = []

  beforeAll(() => {
    db = createDb(DATABASE_URL as string)
  })

  afterAll(async () => {
    if (!db) return
    for (const accountId of createdAccountIds) {
      await db.delete(accountWalletRoles).where(eq(accountWalletRoles.accountId, accountId))
      await db.delete(accounts).where(eq(accounts.id, accountId))
    }
    for (const walletId of createdWalletIds) {
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

  async function seedAccountWithOwner() {
    const wallet = await seedWallet()
    return db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ ownerWalletId: wallet.id })
        .returning()
      await tx.insert(accountWalletRoles).values({
        accountId: account.id, walletId: wallet.id, role: 'OWNER', grantedByWalletId: wallet.id,
      })
      createdAccountIds.push(account.id)
      return { account, wallet }
    })
  }

  // MARK: No duplicate (account, wallet, role)

  it('rejects a duplicate (account, wallet, role) association', async () => {
    const { account, wallet } = await seedAccountWithOwner()
    await expect(
      db.insert(accountWalletRoles).values({ accountId: account.id, walletId: wallet.id, role: 'OWNER' })
    ).rejects.toThrow()
  })

  // MARK: At most one OWNER / RECOVERY

  it('rejects a second OWNER for the same account, including competing concurrent writes', async () => {
    const { account } = await seedAccountWithOwner()
    const [walletA, walletB] = await Promise.all([seedWallet(), seedWallet()])

    const results = await Promise.allSettled([
      db.insert(accountWalletRoles).values({ accountId: account.id, walletId: walletA.id, role: 'OWNER' }),
      db.insert(accountWalletRoles).values({ accountId: account.id, walletId: walletB.id, role: 'OWNER' }),
    ])

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
  })

  it('rejects a second RECOVERY for the same account, including competing concurrent writes', async () => {
    const { account } = await seedAccountWithOwner()
    const [walletA, walletB] = await Promise.all([seedWallet(), seedWallet()])

    const results = await Promise.allSettled([
      db.insert(accountWalletRoles).values({ accountId: account.id, walletId: walletA.id, role: 'RECOVERY' }),
      db.insert(accountWalletRoles).values({ accountId: account.id, walletId: walletB.id, role: 'RECOVERY' }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected  = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
  })

  // MARK: Exactly one OWNER, checked at commit

  it('rejects a transaction that leaves an account with zero OWNER rows at commit', async () => {
    const { account } = await seedAccountWithOwner()
    await expect(
      db.transaction(async (tx) => {
        await tx
          .delete(accountWalletRoles)
          .where(and(
            eq(accountWalletRoles.accountId, account.id),
            eq(accountWalletRoles.role, 'OWNER')
          ))
      })
    ).rejects.toThrow()
  })

  it('rejects accounts.owner_wallet_id diverging from the OWNER role association', async () => {
    const { account } = await seedAccountWithOwner()
    const otherWallet = await seedWallet()

    await expect(
      db.update(accounts).set({ ownerWalletId: otherWallet.id }).where(eq(accounts.id, account.id))
    ).rejects.toThrow()
  })

  // MARK: Valid provisioning / transfer still commits

  it('allows a valid ownership-transfer transaction that keeps exactly one consistent owner', async () => {
    const { account, wallet } = await seedAccountWithOwner()
    const newOwner = await seedWallet()

    await expect(
      db.transaction(async (tx) => {
        await tx
          .delete(accountWalletRoles)
          .where(and(
            eq(accountWalletRoles.accountId, account.id),
            eq(accountWalletRoles.walletId, wallet.id),
            eq(accountWalletRoles.role, 'OWNER')
          ))
        await tx.insert(accountWalletRoles).values({
          accountId: account.id, walletId: newOwner.id, role: 'OWNER', grantedByWalletId: wallet.id,
        })
        await tx.update(accounts).set({ ownerWalletId: newOwner.id }).where(eq(accounts.id, account.id))
      })
    ).resolves.not.toThrow()
  })
})

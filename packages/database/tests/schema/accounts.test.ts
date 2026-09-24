// MARK: - accounts schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { accounts } from '../../src/schema/accounts.js'

describe('accounts schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(accounts)).toBe('accounts')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(accounts.id.name).toBe('id')
  })

  it('has an owner_wallet_id column', () => {
    expect(accounts.ownerWalletId.name).toBe('owner_wallet_id')
  })

  it('has a nullable recovery_wallet_id column', () => {
    expect(accounts.recoveryWalletId.name).toBe('recovery_wallet_id')
    expect(accounts.recoveryWalletId.notNull).toBe(false)
  })

  it('has a created_at column', () => {
    expect(accounts.createdAt.name).toBe('created_at')
  })

  it('has an updated_at column', () => {
    expect(accounts.updatedAt.name).toBe('updated_at')
  })

  // MARK: Constraints

  it('owner_wallet_id is not nullable', () => {
    expect(accounts.ownerWalletId.notNull).toBe(true)
  })

  it('references wallets for owner_wallet_id and recovery_wallet_id', () => {
    const { foreignKeys } = getTableConfig(accounts)
    const names = foreignKeys.map((fk) => fk.getName())
    expect(names).toContain('accounts_owner_wallet_id_wallets_id_fk')
    expect(names).toContain('accounts_recovery_wallet_id_wallets_id_fk')
  })
})

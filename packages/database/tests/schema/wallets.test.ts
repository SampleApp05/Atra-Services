// MARK: - wallets schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { wallets } from '../../src/schema/wallets.js'

describe('wallets schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(wallets)).toBe('wallets')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(wallets.id.name).toBe('id')
  })

  it('has an address column', () => {
    expect(wallets.address.name).toBe('address')
  })

  it('has a chain_id column', () => {
    expect(wallets.chainId.name).toBe('chain_id')
  })

  it('has a created_at column', () => {
    expect(wallets.createdAt.name).toBe('created_at')
  })

  // MARK: Constraints

  it('address is not nullable', () => {
    expect(wallets.address.notNull).toBe(true)
  })

  it('chain_id is not nullable', () => {
    expect(wallets.chainId.notNull).toBe(true)
  })
})

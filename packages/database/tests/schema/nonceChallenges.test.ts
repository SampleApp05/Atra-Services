// MARK: - nonce_challenges schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { nonceChallenges, noncePurposeEnum } from '../../src/schema/nonceChallenges.js'

describe('nonceChallenges schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(nonceChallenges)).toBe('nonce_challenges')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(nonceChallenges.id.name).toBe('id')
  })

  it('has a wallet_id column', () => {
    expect(nonceChallenges.walletId.name).toBe('wallet_id')
  })

  it('has a nonce column', () => {
    expect(nonceChallenges.nonce.name).toBe('nonce')
  })

  it('has a purpose column', () => {
    expect(nonceChallenges.purpose.name).toBe('purpose')
  })

  it('has an expires_at column', () => {
    expect(nonceChallenges.expiresAt.name).toBe('expires_at')
  })

  it('has a nullable used_at column', () => {
    expect(nonceChallenges.usedAt.name).toBe('used_at')
    expect(nonceChallenges.usedAt.notNull).toBe(false)
  })

  it('has a created_at column', () => {
    expect(nonceChallenges.createdAt.name).toBe('created_at')
  })

  // MARK: Purpose Enum

  it('noncePurposeEnum contains LOGIN', () => {
    expect(noncePurposeEnum.enumValues).toContain('LOGIN')
  })

  it('noncePurposeEnum contains LINK_WALLET', () => {
    expect(noncePurposeEnum.enumValues).toContain('LINK_WALLET')
  })

  it('noncePurposeEnum contains GRANT_AUTH', () => {
    expect(noncePurposeEnum.enumValues).toContain('GRANT_AUTH')
  })

  it('noncePurposeEnum contains TRANSFER_OWNER', () => {
    expect(noncePurposeEnum.enumValues).toContain('TRANSFER_OWNER')
  })

  it('noncePurposeEnum contains RECOVERY', () => {
    expect(noncePurposeEnum.enumValues).toContain('RECOVERY')
  })

  it('noncePurposeEnum has exactly 5 values', () => {
    expect(noncePurposeEnum.enumValues).toHaveLength(5)
  })

  // MARK: Constraints

  it('wallet_id is not nullable', () => {
    expect(nonceChallenges.walletId.notNull).toBe(true)
  })

  it('nonce is not nullable', () => {
    expect(nonceChallenges.nonce.notNull).toBe(true)
  })

  it('purpose is not nullable', () => {
    expect(nonceChallenges.purpose.notNull).toBe(true)
  })

  it('expires_at is not nullable', () => {
    expect(nonceChallenges.expiresAt.notNull).toBe(true)
  })
})

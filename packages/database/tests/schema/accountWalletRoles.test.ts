// MARK: - account_wallet_roles schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { accountWalletRoles, walletRoleEnum } from '../../src/schema/accountWalletRoles.js'

describe('accountWalletRoles schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(accountWalletRoles)).toBe('account_wallet_roles')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(accountWalletRoles.id.name).toBe('id')
  })

  it('has an account_id column', () => {
    expect(accountWalletRoles.accountId.name).toBe('account_id')
  })

  it('has a wallet_id column', () => {
    expect(accountWalletRoles.walletId.name).toBe('wallet_id')
  })

  it('has a role column', () => {
    expect(accountWalletRoles.role.name).toBe('role')
  })

  it('has a nullable granted_by_wallet_id column', () => {
    expect(accountWalletRoles.grantedByWalletId.name).toBe('granted_by_wallet_id')
    expect(accountWalletRoles.grantedByWalletId.notNull).toBe(false)
  })

  it('has a created_at column', () => {
    expect(accountWalletRoles.createdAt.name).toBe('created_at')
  })

  // MARK: Role Enum

  it('walletRoleEnum contains OWNER', () => {
    expect(walletRoleEnum.enumValues).toContain('OWNER')
  })

  it('walletRoleEnum contains AUTH', () => {
    expect(walletRoleEnum.enumValues).toContain('AUTH')
  })

  it('walletRoleEnum contains STANDARD', () => {
    expect(walletRoleEnum.enumValues).toContain('STANDARD')
  })

  it('walletRoleEnum contains RECOVERY', () => {
    expect(walletRoleEnum.enumValues).toContain('RECOVERY')
  })

  it('walletRoleEnum has exactly 4 values', () => {
    expect(walletRoleEnum.enumValues).toHaveLength(4)
  })

  // MARK: Constraints

  it('account_id is not nullable', () => {
    expect(accountWalletRoles.accountId.notNull).toBe(true)
  })

  it('wallet_id is not nullable', () => {
    expect(accountWalletRoles.walletId.notNull).toBe(true)
  })

  it('role is not nullable', () => {
    expect(accountWalletRoles.role.notNull).toBe(true)
  })
})

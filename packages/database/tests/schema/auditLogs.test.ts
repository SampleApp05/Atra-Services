// MARK: - audit_logs schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { auditLogs } from '../../src/schema/auditLogs.js'

describe('auditLogs schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(auditLogs)).toBe('audit_logs')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(auditLogs.id.name).toBe('id')
  })

  it('has an account_id column', () => {
    expect(auditLogs.accountId.name).toBe('account_id')
  })

  it('has an actor_wallet_id column', () => {
    expect(auditLogs.actorWalletId.name).toBe('actor_wallet_id')
  })

  it('has an action column', () => {
    expect(auditLogs.action.name).toBe('action')
  })

  it('has a metadata column', () => {
    expect(auditLogs.metadata.name).toBe('metadata')
  })

  it('has a created_at column', () => {
    expect(auditLogs.createdAt.name).toBe('created_at')
  })

  // MARK: Constraints

  it('account_id is not nullable', () => {
    expect(auditLogs.accountId.notNull).toBe(true)
  })

  it('actor_wallet_id is not nullable', () => {
    expect(auditLogs.actorWalletId.notNull).toBe(true)
  })

  it('action is not nullable', () => {
    expect(auditLogs.action.notNull).toBe(true)
  })

  it('metadata is not nullable', () => {
    expect(auditLogs.metadata.notNull).toBe(true)
  })
})

// MARK: - sessions schema tests

import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { sessions } from '../../src/schema/sessions.js'

describe('sessions schema', () => {

  // MARK: Table

  it('has the correct table name', () => {
    expect(getTableName(sessions)).toBe('sessions')
  })

  // MARK: Columns

  it('has an id column', () => {
    expect(sessions.id.name).toBe('id')
  })

  it('has an account_id column', () => {
    expect(sessions.accountId.name).toBe('account_id')
  })

  it('has a refresh_token_hash column', () => {
    expect(sessions.refreshTokenHash.name).toBe('refresh_token_hash')
  })

  it('has a device_name column', () => {
    expect(sessions.deviceName.name).toBe('device_name')
  })

  it('has a device_type column', () => {
    expect(sessions.deviceType.name).toBe('device_type')
  })

  it('has a last_ip column', () => {
    expect(sessions.lastIp.name).toBe('last_ip')
  })

  it('has an expires_at column', () => {
    expect(sessions.expiresAt.name).toBe('expires_at')
  })

  it('has a nullable revoked_at column', () => {
    expect(sessions.revokedAt.name).toBe('revoked_at')
    expect(sessions.revokedAt.notNull).toBe(false)
  })

  it('has a created_at column', () => {
    expect(sessions.createdAt.name).toBe('created_at')
  })

  // MARK: Constraints

  it('account_id is not nullable', () => {
    expect(sessions.accountId.notNull).toBe(true)
  })

  it('refresh_token_hash is not nullable', () => {
    expect(sessions.refreshTokenHash.notNull).toBe(true)
  })

  it('expires_at is not nullable', () => {
    expect(sessions.expiresAt.notNull).toBe(true)
  })
})

// MARK: - TokenService Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { TokenService } from '../../src/modules/auth/services/TokenService.js'

// MARK: - Fixtures

const SECRET = 'super-secret-jwt-key-that-is-long-enough-32chars'

// MARK: - Tests

describe('TokenService', () => {
  let service: TokenService

  beforeEach(() => {
    service = new TokenService(SECRET)
  })

  // MARK: Constructor

  describe('constructor', () => {
    it('throws when secret is too short', () => {
      expect(() => new TokenService('short')).toThrow('JWT secret must be at least 32 characters')
    })

    it('accepts a valid secret', () => {
      expect(() => new TokenService(SECRET)).not.toThrow()
    })
  })

  // MARK: Access Token

  describe('signAccessToken / verifyAccessToken', () => {
    it('round-trips a valid payload', () => {
      const payload = { accountId: 'acc-1', sessionId: 'ses-1', roles: ['OWNER', 'AUTH'], chainId: 11155111 }
      const token = service.signAccessToken(payload)
      const decoded = service.verifyAccessToken(token)

      expect(decoded.accountId).toBe('acc-1')
      expect(decoded.sessionId).toBe('ses-1')
      expect(decoded.roles).toEqual(['OWNER', 'AUTH'])
      expect(decoded.chainId).toBe(11155111)
    })

    it('throws on tampered token', () => {
      const token = service.signAccessToken({ accountId: 'a', sessionId: 's', roles: [], chainId: 1 })
      expect(() => service.verifyAccessToken(token + 'tampered')).toThrow()
    })

    it('throws on token signed with a different secret', () => {
      const other = new TokenService('another-secret-that-is-long-enough-!!!')
      const token = other.signAccessToken({ accountId: 'a', sessionId: 's', roles: [], chainId: 1 })
      expect(() => service.verifyAccessToken(token)).toThrow()
    })
  })

  // MARK: Refresh Token

  describe('generateRefreshToken', () => {
    it('returns a 80-char hex raw token', () => {
      const { raw } = service.generateRefreshToken()
      expect(raw).toMatch(/^[0-9a-f]{80}$/)
    })

    it('returns a 64-char hex hash (SHA-256)', () => {
      const { hash } = service.generateRefreshToken()
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('sets expiresAt ~30 days from now', () => {
      const before = Date.now()
      const { expiresAt } = service.generateRefreshToken()
      const after = Date.now()

      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000)
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after  + thirtyDaysMs + 1000)
    })

    it('generates unique tokens each call', () => {
      const a = service.generateRefreshToken()
      const b = service.generateRefreshToken()
      expect(a.raw).not.toBe(b.raw)
      expect(a.hash).not.toBe(b.hash)
    })
  })

  // MARK: hashRefreshToken

  describe('hashRefreshToken', () => {
    it('produces the same hash as generateRefreshToken', () => {
      const { raw, hash } = service.generateRefreshToken()
      expect(service.hashRefreshToken(raw)).toBe(hash)
    })
  })
})

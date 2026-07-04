// MARK: - Token Service
// Signs / verifies JWTs and generates opaque refresh tokens.

import jwt, { type SignOptions } from 'jsonwebtoken'
import { randomBytes, createHash } from 'crypto'

// MARK: - Types

export interface AccessTokenPayload {
  accountId: string
  sessionId: string
  roles: string[]
  chainId: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string     // raw opaque token (send to client)
  refreshTokenHash: string // SHA-256 hash (store in DB)
  expiresAt: Date          // refresh token expiry
}

// MARK: - Constants
// Defaults match the values below; override via .env.
// ACCESS_TOKEN_TTL        — jsonwebtoken duration string  (default: 15m)
// REFRESH_TOKEN_TTL_DAYS  — integer days                  (default: 30)

const ACCESS_TOKEN_TTL  =
  process.env['ACCESS_TOKEN_TTL'] ?? '15m'

const REFRESH_TOKEN_TTL_MS =
  parseInt(process.env['REFRESH_TOKEN_TTL_DAYS'] ?? '30', 10) * 24 * 60 * 60 * 1000

// MARK: - Service

export class TokenService {
  // MARK: Private State

  private readonly secret: string

  // MARK: Init

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters')
    }
    this.secret = secret
  }

  // MARK: - Access Token

  /**
   * Signs a 15-minute JWT containing { accountId, sessionId, roles }.
   */
  signAccessToken(payload: AccessTokenPayload): string {
    const opts: SignOptions = {
      expiresIn: ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
      algorithm: 'HS256',
    }
    return jwt.sign(payload, this.secret, opts)
  }

  /**
   * Verifies and decodes an access token.
   * Throws JsonWebTokenError / TokenExpiredError on failure.
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] })
    return decoded as AccessTokenPayload
  }

  // MARK: - Refresh Token

  /**
   * Generates a cryptographically random opaque refresh token.
   * Returns the raw token (for the client) and its SHA-256 hash (for the DB).
   */
  generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(40).toString('hex')
    const hash = createHash('sha256').update(raw).digest('hex')
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
    return { raw, hash, expiresAt }
  }

  /**
   * Hashes a raw refresh token — used when validating an incoming token.
   */
  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
  }
}

// MARK: - Nonce Service
// Generates and validates single-use, short-lived challenges.

import { randomBytes } from 'crypto'
import type { Db, NewNonceChallenge, NonceChallenge, NoncePurpose } from '@atra/database'
import { nonceChallenges } from '@atra/database'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { NonceRepository, type NonceExecutor } from '../repositories/NonceRepository.js'

// MARK: - Constants
// Override via .env: NONCE_TTL_MINUTES (integer, default 5)

const NONCE_TTL_MS =
  parseInt(process.env['NONCE_TTL_MINUTES'] ?? '5', 10) * 60 * 1000

// MARK: - Service

export class NonceService {
  // MARK: Private State

  private readonly db: Db
  private readonly repository: NonceRepository

  // MARK: Init

  constructor(db: Db) {
    this.db = db
    this.repository = new NonceRepository(db)
  }

  // MARK: Public API

  /**
   * Generates a cryptographically random hex nonce, persists it,
   * and returns the full challenge row.
   */
  async create(walletId: string, purpose: NoncePurpose): Promise<NonceChallenge> {
    const nonce = randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS)

    const values: NewNonceChallenge = {
      walletId,
      nonce,
      purpose,
      expiresAt,
    }

    const [row] = await this.db
      .insert(nonceChallenges)
      .values(values)
      .returning()

    return row
  }

  /**
   * Looks up an unused, unexpired nonce for the given wallet + purpose.
   * Returns null if not found, expired, or already used.
   */
  async find(
    walletId: string,
    nonce: string,
    purpose: NoncePurpose
  ): Promise<NonceChallenge | null> {
    const now = new Date()

    const [row] = await this.db
      .select()
      .from(nonceChallenges)
      .where(
        and(
          eq(nonceChallenges.walletId, walletId),
          eq(nonceChallenges.nonce, nonce),
          eq(nonceChallenges.purpose, purpose),
          isNull(nonceChallenges.usedAt),
          gt(nonceChallenges.expiresAt, now)
        )
      )
      .limit(1)

    return row ?? null
  }

  /**
   * Marks a nonce as used. Must be called immediately after verification.
   * A used nonce can never be reused.
   */
  async markUsed(id: string): Promise<void> {
    await this.db
      .update(nonceChallenges)
      .set({ usedAt: new Date() })
      .where(eq(nonceChallenges.id, id))
  }

  /**
   * Single conditional, transactional consume primitive shared by every
   * nonce-gated flow (login, wallet linking, role/ownership changes,
   * recovery). Validates and marks the nonce used in one atomic UPDATE,
   * returning the consumed row or null if it was missing, expired, or
   * already used. Pass the caller's transaction as `executor` so the
   * consume is atomic with the effect it authorizes.
   */
  async consume(
    walletId: string,
    nonce: string,
    purpose: NoncePurpose,
    executor: NonceExecutor = this.db
  ): Promise<NonceChallenge | null> {
    return this.repository.consume(executor, walletId, nonce, purpose)
  }
}

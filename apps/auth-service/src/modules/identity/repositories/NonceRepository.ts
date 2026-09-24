// MARK: - Nonce Repository

import type { Db, NonceChallenge, NoncePurpose } from '@atra/database'
import { nonceChallenges } from '@atra/database'
import { eq, and, isNull, gt } from 'drizzle-orm'

// MARK: - Types

// The tx passed into a `db.transaction(async (tx) => ...)` callback exposes the
// same query-builder surface as `Db` but isn't the same nominal type — derive it
// from Db itself so `consume` can run standalone or inside a caller's transaction.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type NonceExecutor = Db | Tx

// MARK: - Repository

export class NonceRepository {
  // MARK: Private State

  private readonly db: Db

  // MARK: Init

  constructor(db: Db) {
    this.db = db
  }

  // MARK: Public API

  async findById(id: string): Promise<NonceChallenge | null> {
    const [row] = await this.db
      .select()
      .from(nonceChallenges)
      .where(eq(nonceChallenges.id, id))
      .limit(1)

    return row ?? null
  }

  async markUsed(id: string): Promise<void> {
    await this.db
      .update(nonceChallenges)
      .set({ usedAt: new Date() })
      .where(eq(nonceChallenges.id, id))
  }

  /**
   * Atomically validates and consumes a nonce challenge in a single
   * conditional UPDATE. The WHERE clause (unused, unexpired, matching
   * wallet/nonce/purpose) is evaluated by Postgres against the same row
   * version as the write, so two concurrent callers racing the same nonce
   * can never both receive a non-null row — this replaces the separate
   * "find valid challenge" then "markUsed" pattern, which had a window
   * between the read and the write where both could observe the nonce as
   * still valid.
   *
   * Pass a transaction as `executor` so the consume commits or rolls back
   * atomically with whatever it authorizes.
   */
  async consume(
    executor: NonceExecutor,
    walletId: string,
    nonce: string,
    purpose: NoncePurpose
  ): Promise<NonceChallenge | null> {
    const now = new Date()

    const [row] = await executor
      .update(nonceChallenges)
      .set({ usedAt: now })
      .where(
        and(
          eq(nonceChallenges.walletId, walletId),
          eq(nonceChallenges.nonce, nonce),
          eq(nonceChallenges.purpose, purpose),
          isNull(nonceChallenges.usedAt),
          gt(nonceChallenges.expiresAt, now)
        )
      )
      .returning()

    return row ?? null
  }
}

import { and, eq, isNull, gt } from 'drizzle-orm'
import type { Db, NoncePurpose } from '@atra/database'
import { wallets, nonceChallenges, accountWalletRoles, accounts, auditLogs } from '@atra/database'
import type { NonceService } from '../../identity/services/NonceService.js'
import type { SignatureService } from '../../identity/services/SignatureService.js'

// MARK: - Types

export interface RecoveryChallengeResult {
  challengeId: string
  message: string
}

// MARK: - Service

export class RecoveryService {
  private readonly db: Db
  private readonly nonceService: NonceService
  private readonly signatureService: SignatureService

  constructor(db: Db, nonceService: NonceService, signatureService: SignatureService) {
    this.db = db
    this.nonceService = nonceService
    this.signatureService = signatureService
  }

  // MARK: - Public API

  /**
   * Step 1 — The RECOVERY wallet requests a challenge.
   * Only valid if the wallet has RECOVERY role on the account.
   */
  async createRecoveryChallenge(
    accountId: string,
    recoveryAddress: string
  ): Promise<RecoveryChallengeResult> {
    const wallet = await this.findWalletByAddress(recoveryAddress)
    if (!wallet) throw new Error('RECOVERY_WALLET_NOT_FOUND')

    await this.assertRecoveryRole(accountId, wallet.id)

    const purpose = 'RECOVERY' as NoncePurpose
    const challenge = await this.nonceService.create(wallet.id, purpose)
    const message = this.signatureService.buildChallengeMessage(challenge.nonce, purpose)

    return { challengeId: challenge.id, message }
  }

  /**
   * Step 2 — RECOVERY wallet submits its signed challenge.
   * On success: revokes old OWNER role, grants OWNER + AUTH to recovery wallet,
   * strips the RECOVERY role, and updates accounts.ownerWalletId.
   */
  async executeRecovery(
    accountId: string,
    recoveryAddress: string,
    nonce: string,
    signature: string
  ): Promise<{ newOwnerWalletId: string }> {
    const wallet = await this.findWalletByAddress(recoveryAddress)
    if (!wallet) throw new Error('RECOVERY_WALLET_NOT_FOUND')

    await this.assertRecoveryRole(accountId, wallet.id)

    const now = new Date()
    const purpose = 'RECOVERY' as NoncePurpose

    const challenge = await this.db
      .select()
      .from(nonceChallenges)
      .where(and(
        eq(nonceChallenges.walletId, wallet.id),
        eq(nonceChallenges.nonce, nonce),
        eq(nonceChallenges.purpose, purpose),
        isNull(nonceChallenges.usedAt),
        gt(nonceChallenges.expiresAt, now)
      ))
      .limit(1)
      .then((r: typeof nonceChallenges.$inferSelect[]) => r[0] ?? null)

    if (!challenge) throw new Error('INVALID_OR_EXPIRED_NONCE')

    const message = this.signatureService.buildChallengeMessage(nonce, purpose)
    if (!this.signatureService.verifySignature(message, signature, wallet.address)) {
      throw new Error('SIGNATURE_MISMATCH')
    }

    await this.nonceService.markUsed(challenge.id)

    await this.db.transaction(async (tx) => {
      // Remove old OWNER role(s)
      await tx
        .delete(accountWalletRoles)
        .where(and(
          eq(accountWalletRoles.accountId, accountId),
          eq(accountWalletRoles.role, 'OWNER')
        ))

      // Grant OWNER + AUTH to recovery wallet
      await tx.insert(accountWalletRoles).values([
        { accountId, walletId: wallet.id, role: 'OWNER', grantedByWalletId: wallet.id },
        { accountId, walletId: wallet.id, role: 'AUTH',  grantedByWalletId: wallet.id },
      ])

      // Strip RECOVERY role from this wallet (it is now the OWNER)
      await tx
        .delete(accountWalletRoles)
        .where(and(
          eq(accountWalletRoles.accountId, accountId),
          eq(accountWalletRoles.walletId, wallet.id),
          eq(accountWalletRoles.role, 'RECOVERY')
        ))

      // Update the accounts table
      await tx
        .update(accounts)
        .set({ ownerWalletId: wallet.id })
        .where(eq(accounts.id, accountId))

      await tx.insert(auditLogs).values({
        accountId,
        actorWalletId: wallet.id,
        action: 'RECOVERY_EXECUTED',
        metadata: { newOwnerWalletId: wallet.id },
      })
    })

    return { newOwnerWalletId: wallet.id }
  }

  // MARK: - Private: Helpers

  private async findWalletByAddress(address: string) {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.address, address.toLowerCase()))
      .limit(1)
    return row ?? null
  }

  private async assertRecoveryRole(accountId: string, walletId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(accountWalletRoles)
      .where(and(
        eq(accountWalletRoles.accountId, accountId),
        eq(accountWalletRoles.walletId, walletId),
        eq(accountWalletRoles.role, 'RECOVERY')
      ))
    if (rows.length === 0) throw new Error('NOT_RECOVERY_WALLET')
  }
}

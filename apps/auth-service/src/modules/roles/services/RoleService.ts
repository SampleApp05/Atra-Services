// MARK: - Role Service
// OWNER-only operations requiring dual verification:
// the OWNER signs approval AND the target wallet signs acceptance.

import { and, eq, isNull, gt, ne } from 'drizzle-orm'
import type { Db, NoncePurpose, WalletRole } from '@atra/database'
import { wallets, nonceChallenges, accountWalletRoles, auditLogs } from '@atra/database'
import type { NonceService } from '../../identity/services/NonceService.js'
import type { SignatureService } from '../../identity/services/SignatureService.js'

// MARK: - Types

export type RoleOperation =
  | 'GRANT_AUTH'
  | 'REVOKE_AUTH'
  | 'ASSIGN_RECOVERY'
  | 'TRANSFER_OWNER'
  | 'REMOVE_WALLET'

export interface DualChallengeResult {
  /** Challenge the OWNER wallet must sign */
  ownerChallengeId: string
  ownerMessage: string
  /** Challenge the TARGET wallet must sign */
  targetChallengeId: string
  targetMessage: string
}

// MARK: - Helpers

function noncePurposeFor(operation: RoleOperation): NoncePurpose {
  return operation === 'TRANSFER_OWNER' ? 'TRANSFER_OWNER' : 'GRANT_AUTH'
}

// MARK: - Service

export class RoleService {
  // MARK: Private State

  private readonly db: Db
  private readonly nonceService: NonceService
  private readonly signatureService: SignatureService

  // MARK: Init

  constructor(db: Db, nonceService: NonceService, signatureService: SignatureService) {
    this.db = db
    this.nonceService = nonceService
    this.signatureService = signatureService
  }

  // MARK: - Public API

  /**
   * Step 1 — OWNER requests a dual challenge for a role operation.
   * Returns two challenge messages: one for the OWNER to sign, one for the target wallet.
   */
  async createRoleChallenge(
    accountId: string,
    ownerWalletId: string,
    targetAddress: string
  ): Promise<DualChallengeResult> {
    await this.assertOwner(accountId, ownerWalletId)

    const target = await this.findWalletByAddress(targetAddress)
    if (!target) throw new Error('TARGET_WALLET_NOT_FOUND')

    const purpose = 'GRANT_AUTH' as NoncePurpose

    const ownerChallenge  = await this.nonceService.create(ownerWalletId, purpose)
    const targetChallenge = await this.nonceService.create(target.id, purpose)

    const ownerMessage  = this.signatureService.buildChallengeMessage(ownerChallenge.nonce,  purpose)
    const targetMessage = this.signatureService.buildChallengeMessage(targetChallenge.nonce, purpose)

    return {
      ownerChallengeId:  ownerChallenge.id,
      ownerMessage,
      targetChallengeId: targetChallenge.id,
      targetMessage,
    }
  }

  /**
   * Step 2 — Both wallets have signed. Validate both signatures and apply the operation.
   */
  async verifyAndApply(
    accountId: string,
    ownerWalletId: string,
    targetAddress: string,
    operation: RoleOperation,
    ownerNonce: string,
    ownerSignature: string,
    targetNonce: string,
    targetSignature: string
  ): Promise<void> {
    const ownerAddress = await this.getWalletAddress(ownerWalletId)
    await this.assertOwner(accountId, ownerWalletId)

    const target = await this.findWalletByAddress(targetAddress)
    if (!target) throw new Error('TARGET_WALLET_NOT_FOUND')

    const purpose = noncePurposeFor(operation)
    const now = new Date()

    // Validate OWNER challenge
    const ownerChallenge = await this.findValidChallenge(ownerWalletId, ownerNonce, purpose, now)
    if (!ownerChallenge) throw new Error('INVALID_OWNER_NONCE')

    // Validate TARGET challenge
    const targetChallenge = await this.findValidChallenge(target.id, targetNonce, purpose, now)
    if (!targetChallenge) throw new Error('INVALID_TARGET_NONCE')

    // Verify OWNER signature
    const ownerMessage = this.signatureService.buildChallengeMessage(ownerNonce, purpose)
    if (!this.signatureService.verifySignature(ownerMessage, ownerSignature, ownerAddress)) {
      throw new Error('OWNER_SIGNATURE_MISMATCH')
    }

    // Verify TARGET signature
    const targetMessage = this.signatureService.buildChallengeMessage(targetNonce, purpose)
    if (!this.signatureService.verifySignature(targetMessage, targetSignature, target.address)) {
      throw new Error('TARGET_SIGNATURE_MISMATCH')
    }

    // Consume both nonces immediately (single-use)
    await this.nonceService.markUsed(ownerChallenge.id)
    await this.nonceService.markUsed(targetChallenge.id)

    // Apply the operation atomically
    await this.applyOperation(accountId, ownerWalletId, target.id, operation)
  }

  // MARK: - Private: Operations

  private async applyOperation(
    accountId: string,
    ownerWalletId: string,
    targetWalletId: string,
    operation: RoleOperation
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      switch (operation) {

        case 'GRANT_AUTH': {
          // Idempotent — skip if role already exists
          const existing = await tx
            .select()
            .from(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.walletId, targetWalletId),
              eq(accountWalletRoles.role, 'AUTH')
            ))
          if (existing.length === 0) {
            await tx.insert(accountWalletRoles).values({
              accountId, walletId: targetWalletId, role: 'AUTH', grantedByWalletId: ownerWalletId,
            })
          }
          await tx.insert(auditLogs).values({
            accountId, actorWalletId: ownerWalletId, action: 'ROLE_GRANTED',
            metadata: { targetWalletId, role: 'AUTH' },
          })
          break
        }

        case 'REVOKE_AUTH': {
          await tx
            .delete(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.walletId, targetWalletId),
              eq(accountWalletRoles.role, 'AUTH')
            ))
          await tx.insert(auditLogs).values({
            accountId, actorWalletId: ownerWalletId, action: 'ROLE_REVOKED',
            metadata: { targetWalletId, role: 'AUTH' },
          })
          break
        }

        case 'ASSIGN_RECOVERY': {
          // Enforce max 1 RECOVERY per account
          const existing = await tx
            .select()
            .from(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.role, 'RECOVERY')
            ))
          if (existing.length > 0) throw new Error('RECOVERY_WALLET_ALREADY_ASSIGNED')

          await tx.insert(accountWalletRoles).values({
            accountId, walletId: targetWalletId, role: 'RECOVERY', grantedByWalletId: ownerWalletId,
          })
          await tx.insert(auditLogs).values({
            accountId, actorWalletId: ownerWalletId, action: 'RECOVERY_ASSIGNED',
            metadata: { targetWalletId },
          })
          break
        }

        case 'TRANSFER_OWNER': {
          // Cannot transfer to self
          if (targetWalletId === ownerWalletId) throw new Error('CANNOT_TRANSFER_TO_SELF')

          // Remove OWNER from current owner
          await tx
            .delete(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.walletId, ownerWalletId),
              eq(accountWalletRoles.role, 'OWNER')
            ))

          // Grant OWNER to target
          await tx.insert(accountWalletRoles).values({
            accountId, walletId: targetWalletId, role: 'OWNER', grantedByWalletId: ownerWalletId,
          })
          await tx.insert(auditLogs).values({
            accountId, actorWalletId: ownerWalletId, action: 'OWNER_TRANSFERRED',
            metadata: { fromWalletId: ownerWalletId, toWalletId: targetWalletId },
          })
          break
        }

        case 'REMOVE_WALLET': {
          // Cannot remove the OWNER wallet
          const ownerCheck = await tx
            .select()
            .from(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.walletId, targetWalletId),
              eq(accountWalletRoles.role, 'OWNER')
            ))
          if (ownerCheck.length > 0) throw new Error('CANNOT_REMOVE_OWNER_WALLET')

          // Delete all roles for this wallet in this account
          await tx
            .delete(accountWalletRoles)
            .where(and(
              eq(accountWalletRoles.accountId, accountId),
              eq(accountWalletRoles.walletId, targetWalletId)
            ))
          await tx.insert(auditLogs).values({
            accountId, actorWalletId: ownerWalletId, action: 'WALLET_REMOVED',
            metadata: { removedWalletId: targetWalletId },
          })
          break
        }
      }
    })
  }

  // MARK: - Private: Helpers

  private async assertOwner(accountId: string, walletId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(accountWalletRoles)
      .where(and(
        eq(accountWalletRoles.accountId, accountId),
        eq(accountWalletRoles.walletId, walletId),
        eq(accountWalletRoles.role, 'OWNER')
      ))
    if (rows.length === 0) throw new Error('NOT_OWNER')
  }

  private async findWalletByAddress(address: string) {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.address, address.toLowerCase()))
      .limit(1)
    return row ?? null
  }

  private async getWalletAddress(walletId: string): Promise<string> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1)
    if (!row) throw new Error('WALLET_NOT_FOUND')
    return row.address
  }

  private async findValidChallenge(
    walletId: string,
    nonce: string,
    purpose: NoncePurpose,
    now: Date
  ) {
    const [row] = await this.db
      .select()
      .from(nonceChallenges)
      .where(and(
        eq(nonceChallenges.walletId, walletId),
        eq(nonceChallenges.nonce, nonce),
        eq(nonceChallenges.purpose, purpose),
        isNull(nonceChallenges.usedAt),
        gt(nonceChallenges.expiresAt, now)
      ))
      .limit(1)
    return row ?? null
  }
}

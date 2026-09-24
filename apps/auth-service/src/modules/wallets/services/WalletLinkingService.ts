// MARK: - Wallet Linking Service
// Orchestrates the LINK_WALLET challenge/verify flow (Phase 2.6).
// Requires an active OWNER or AUTH session for the account.

import { and, eq } from 'drizzle-orm'
import type { Db, WalletRole } from '@atra/database'
import {
  wallets,
  accountWalletRoles,
  auditLogs,
} from '@atra/database'
import type { NonceService } from '../../identity/services/NonceService.js'
import type { SignatureService } from '../../identity/services/SignatureService.js'

// MARK: - Types

export interface LinkChallengeResult {
  challengeId: string
  message: string
}

export interface LinkVerifyResult {
  walletId: string
  role: WalletRole
}

// MARK: - Service

export class WalletLinkingService {
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
   * Step 1 — The account holder (OWNER/AUTH) requests a LINK_WALLET challenge
   * for a new address they want to add to their account.
   *
   * @param accountId   - from the caller's verified JWT
   * @param callerWalletId - from the caller's verified JWT (must hold OWNER or AUTH)
   * @param newAddress  - the address of the wallet to link
   * @param chainId     - chain for the new wallet
   */
  async createLinkChallenge(
    accountId: string,
    callerWalletId: string,
    newAddress: string,
    chainId: number
  ): Promise<LinkChallengeResult> {
    // 1. Enforce caller holds OWNER or AUTH
    await this.assertHasRole(accountId, callerWalletId, ['OWNER', 'AUTH'])

    // 2. Prevent linking an address that is already in use on this chain
    const normalised = newAddress.toLowerCase()
    const [existing] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.address, normalised), eq(wallets.chainId, chainId)))
      .limit(1)

    if (existing) throw new Error('ADDRESS_ALREADY_LINKED')

    // 3. Create the wallet record and issue a LINK_WALLET nonce
    const [wallet] = await this.db
      .insert(wallets)
      .values({ address: normalised, chainId })
      .returning()

    const challenge = await this.nonceService.create(wallet.id, 'LINK_WALLET')
    const message = this.signatureService.buildChallengeMessage(challenge.nonce, 'LINK_WALLET')

    return { challengeId: challenge.id, message }
  }

  /**
   * Step 2 — The NEW wallet signs the challenge. On success, it is linked
   * to the account with the STANDARD role. Linking ≠ granting AUTH.
   *
   * @param accountId      - from the caller's verified JWT
   * @param callerWalletId - from the caller's verified JWT (must hold OWNER or AUTH)
   * @param newAddress     - address of the wallet being linked
   * @param nonce          - the raw nonce from the challenge
   * @param signature      - EIP-191 signature produced by the NEW wallet
   */
  async verifyAndLink(
    accountId: string,
    callerWalletId: string,
    newAddress: string,
    nonce: string,
    signature: string,
    chainId: number
  ): Promise<LinkVerifyResult> {
    const normalised = newAddress.toLowerCase()

    // 1. Enforce caller holds OWNER or AUTH
    await this.assertHasRole(accountId, callerWalletId, ['OWNER', 'AUTH'])

    // 2. Find the new wallet by (address, chain)
    const [wallet] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.address, normalised), eq(wallets.chainId, chainId)))
      .limit(1)

    if (!wallet) throw new Error('WALLET_NOT_FOUND')

    // 3. Verify the new wallet's signature
    const message = this.signatureService.buildChallengeMessage(nonce, 'LINK_WALLET')
    if (!this.signatureService.verifySignature(message, signature, normalised)) {
      throw new Error('SIGNATURE_MISMATCH')
    }

    // 4. Atomically consume the nonce and grant the STANDARD role (default
    //    for linked wallets) in the same transaction, so the nonce is only
    //    ever burned together with the link it authorizes.
    const role: WalletRole = 'STANDARD'
    await this.db.transaction(async (tx) => {
      const consumed = await this.nonceService.consume(wallet.id, nonce, 'LINK_WALLET', tx)
      if (!consumed) throw new Error('INVALID_OR_EXPIRED_NONCE')

      await tx.insert(accountWalletRoles).values({
        accountId,
        walletId: wallet.id,
        role,
        grantedByWalletId: callerWalletId,
      })

      await tx.insert(auditLogs).values({
        accountId,
        actorWalletId: callerWalletId,
        action: 'WALLET_LINKED',
        metadata: { newWalletId: wallet.id, address: normalised, role },
      })
    })

    return { walletId: wallet.id, role }
  }

  // MARK: - Private Helpers

  private async assertHasRole(
    accountId: string,
    walletId: string,
    allowed: WalletRole[]
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(accountWalletRoles)
      .where(
        and(
          eq(accountWalletRoles.accountId, accountId),
          eq(accountWalletRoles.walletId, walletId)
        )
      )

    const hasAllowed = rows.some(r => allowed.includes(r.role))
    if (!hasAllowed) throw new Error('INSUFFICIENT_ROLE')
  }
}

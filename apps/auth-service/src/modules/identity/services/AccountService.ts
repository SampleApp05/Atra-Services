// MARK: - Account Service
// Orchestrates the challenge/verify flow for new account creation (Phase 2.4).

import { and, eq, isNull, gt } from 'drizzle-orm'
import type { Db, Account, Wallet, NoncePurpose } from '@atra/database'
import {
  wallets,
  accounts,
  accountWalletRoles,
  auditLogs,
  nonceChallenges,
} from '@atra/database'
import { NonceService } from './NonceService.js'
import { SignatureService } from './SignatureService.js'
import type { ChainService } from '../../../shared/chains/chain.service.js'

// MARK: - Result Types

export interface ChallengeResult {
  challengeId: string
  message: string
}

export interface VerifyResult {
  wallet: Wallet
  account: Account
}

// MARK: - Service

export class AccountService {
  // MARK: Private State

  private readonly db: Db
  private readonly nonceService: NonceService
  private readonly signatureService: SignatureService
  private readonly chainService: ChainService

  // MARK: Init

  constructor(
    db: Db,
    nonceService: NonceService,
    signatureService: SignatureService,
    chainService: ChainService
  ) {
    this.db = db
    this.nonceService = nonceService
    this.signatureService = signatureService
    this.chainService = chainService
  }

  // MARK: Public API

  /**
   * Step 1 — Issue a nonce challenge for the given wallet address.
   * If the wallet doesn't exist yet we create a temporary entry.
   * Returns the challenge ID and the message the client must sign.
   */
  async createChallenge(
    address: string,
    chainId: number
  ): Promise<ChallengeResult> {
    // 0. Reject unsupported chains immediately
    if (!this.chainService.isSupported(chainId)) {
      throw new Error('UNSUPPORTED_CHAIN')
    }

    const normalised = address.toLowerCase()

    // Upsert wallet — find or create for this (address, chain) pair
    let [wallet] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.address, normalised), eq(wallets.chainId, chainId)))
      .limit(1)

    if (!wallet) {
      ;[wallet] = await this.db
        .insert(wallets)
        .values({ address: normalised, chainId })
        .returning()
    }

    const purpose: NoncePurpose = 'LOGIN'
    const challenge = await this.nonceService.create(wallet.id, purpose)
    const message = this.signatureService.buildChallengeMessage(
      challenge.nonce,
      purpose
    )

    return { challengeId: challenge.id, message }
  }

  /**
   * Step 2 — Verify the signed message and, if the wallet has no account,
   * atomically create wallet + account + OWNER + AUTH roles + audit log.
   */
  async verifyAndProvision(
    address: string,
    nonce: string,
    signature: string,
    chainId: number
  ): Promise<VerifyResult> {
    const normalised = address.toLowerCase()

    // 1. Load wallet
    const [wallet] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.address, normalised), eq(wallets.chainId, chainId)))
      .limit(1)

    if (!wallet) throw new Error('WALLET_NOT_FOUND')

    // 2. Find valid (unexpired, unused) challenge for this wallet
    const purpose: NoncePurpose = 'LOGIN'
    const now = new Date()

    const [challenge] = await this.db
      .select()
      .from(nonceChallenges)
      .where(
        and(
          eq(nonceChallenges.walletId, wallet.id),
          eq(nonceChallenges.nonce, nonce),
          eq(nonceChallenges.purpose, purpose),
          isNull(nonceChallenges.usedAt),
          gt(nonceChallenges.expiresAt, now)
        )
      )
      .limit(1)

    if (!challenge) throw new Error('INVALID_OR_EXPIRED_NONCE')

    // 3. Verify signature
    const message = this.signatureService.buildChallengeMessage(nonce, purpose)
    if (!this.signatureService.verifySignature(message, signature, normalised)) {
      throw new Error('SIGNATURE_MISMATCH')
    }

    // 4. Consume nonce immediately (single-use)
    await this.nonceService.markUsed(challenge.id)

    // 5. Check if account already exists for this wallet
    const existing = await this.db
      .select()
      .from(accountWalletRoles)
      .where(eq(accountWalletRoles.walletId, wallet.id))
      .limit(1)

    if (existing.length > 0) {
      // Already provisioned — return existing account
      const [account] = await this.db
        .select()
        .from(accounts)
        .where(eq(accounts.ownerWalletId, wallet.id))
        .limit(1)
      return { wallet, account }
    }

    // 6. Atomically provision new account
    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ ownerWalletId: wallet.id })
        .returning()

      await tx.insert(accountWalletRoles).values({
        accountId: account.id,
        walletId: wallet.id,
        role: 'OWNER',
        grantedByWalletId: wallet.id,
      })

      await tx.insert(accountWalletRoles).values({
        accountId: account.id,
        walletId: wallet.id,
        role: 'AUTH',
        grantedByWalletId: wallet.id,
      })

      await tx.insert(auditLogs).values({
        accountId: account.id,
        actorWalletId: wallet.id,
        action: 'ACCOUNT_CREATED',
        metadata: { address: normalised, chainId },
      })

      return { wallet, account }
    })
  }
}

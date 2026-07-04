// MARK: - Wallet Controller
// POST /wallets/link/challenge  — request a LINK_WALLET nonce
// POST /wallets/link/verify     — submit signature to finalise linking

import type { Request, Response } from 'express'
import type { WalletLinkingService } from '../services/WalletLinkingService.js'

// MARK: - Controller

export class WalletController {
  // MARK: Private State

  private readonly walletLinkingService: WalletLinkingService

  // MARK: Init

  constructor(walletLinkingService: WalletLinkingService) {
    this.walletLinkingService = walletLinkingService
  }

  // MARK: - Handlers

  /**
   * POST /wallets/link/challenge
   * Body: { newAddress: string, chainId: number }
   * Auth: JWT — accountId + walletId injected by middleware (Phase 2.9).
   *       Until then, read from body for testability.
   * Returns: { challengeId: string, message: string }
   */
  linkChallenge = async (req: Request, res: Response): Promise<void> => {
    const { newAddress, chainId, accountId, walletId } = req.body as {
      newAddress?: string
      chainId?: number
      accountId?: string   // TODO: replace with req.auth.accountId in Phase 2.9
      walletId?: string    // TODO: replace with req.auth.walletId in Phase 2.9
    }

    if (!newAddress || typeof newAddress !== 'string') {
      res.status(400).json({ error: 'newAddress is required' })
      return
    }
    if (!chainId || typeof chainId !== 'number') {
      res.status(400).json({ error: 'chainId is required' })
      return
    }
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId is required' })
      return
    }
    if (!walletId || typeof walletId !== 'string') {
      res.status(400).json({ error: 'walletId is required' })
      return
    }

    try {
      const result = await this.walletLinkingService.createLinkChallenge(
        accountId,
        walletId,
        newAddress,
        chainId
      )
      res.status(200).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN'
      if (message === 'INSUFFICIENT_ROLE') {
        res.status(403).json({ error: 'Insufficient role' })
      } else if (message === 'ADDRESS_ALREADY_LINKED') {
        res.status(409).json({ error: 'Address is already linked to an account' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }

  /**
   * POST /wallets/link/verify
   * Body: { newAddress: string, nonce: string, signature: string, accountId: string, walletId: string }
   * Returns: { walletId: string, role: string }
   */
  linkVerify = async (req: Request, res: Response): Promise<void> => {
    const { newAddress, nonce, signature, accountId, walletId } = req.body as {
      newAddress?: string
      nonce?: string
      signature?: string
      accountId?: string
      walletId?: string
    }

    if (!newAddress || typeof newAddress !== 'string') {
      res.status(400).json({ error: 'newAddress is required' })
      return
    }
    if (!nonce || typeof nonce !== 'string') {
      res.status(400).json({ error: 'nonce is required' })
      return
    }
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'signature is required' })
      return
    }
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId is required' })
      return
    }
    if (!walletId || typeof walletId !== 'string') {
      res.status(400).json({ error: 'walletId is required' })
      return
    }

    try {
      const result = await this.walletLinkingService.verifyAndLink(
        accountId,
        walletId,
        newAddress,
        nonce,
        signature,
        req.auth?.chainId ?? 0
      )
      res.status(200).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN'
      if (message === 'INSUFFICIENT_ROLE') {
        res.status(403).json({ error: 'Insufficient role' })
      } else if (message === 'WALLET_NOT_FOUND') {
        res.status(404).json({ error: 'Wallet not found' })
      } else if (message === 'INVALID_OR_EXPIRED_NONCE') {
        res.status(401).json({ error: 'Invalid or expired nonce' })
      } else if (message === 'SIGNATURE_MISMATCH') {
        res.status(401).json({ error: 'Signature verification failed' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}

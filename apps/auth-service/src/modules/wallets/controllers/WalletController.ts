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
   * Auth: JWT — accountId + walletId come from the authenticated session
   *       (req.auth), never from the request body.
   * Returns: { challengeId: string, message: string }
   */
  linkChallenge = async (req: Request, res: Response): Promise<void> => {
    const { newAddress, chainId } = req.body as {
      newAddress?: string
      chainId?: number
    }

    if (!newAddress || typeof newAddress !== 'string') {
      res.status(400).json({ error: 'newAddress is required' })
      return
    }
    if (!chainId || typeof chainId !== 'number') {
      res.status(400).json({ error: 'chainId is required' })
      return
    }

    const accountId = req.auth?.accountId
    const walletId = req.auth?.walletId
    if (!accountId || !walletId) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
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
   * Body: { newAddress: string, nonce: string, signature: string }
   * Auth: JWT — accountId + walletId come from the authenticated session
   *       (req.auth), never from the request body.
   * Returns: { walletId: string, role: string }
   */
  linkVerify = async (req: Request, res: Response): Promise<void> => {
    const { newAddress, nonce, signature } = req.body as {
      newAddress?: string
      nonce?: string
      signature?: string
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

    const accountId = req.auth?.accountId
    const walletId = req.auth?.walletId
    if (!accountId || !walletId) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
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

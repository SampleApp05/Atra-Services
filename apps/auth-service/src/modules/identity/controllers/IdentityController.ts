// MARK: - Identity Controller
// Handles POST /identity/challenge and POST /identity/verify.

import type { Request, Response } from 'express'
import type { AccountService } from '../services/AccountService.js'
import type { SessionService } from '../../auth/services/SessionService.js'

// MARK: - Request Bodies

interface ChallengeBody {
  address?: string
  chainId?: number
}

interface VerifyBody {
  address?: string
  nonce?: string
  signature?: string
  chainId?: number
}

// MARK: - Controller

export class IdentityController {
  // MARK: Private State

  private readonly accountService: AccountService
  private readonly sessionService: SessionService

  // MARK: Init

  constructor(accountService: AccountService, sessionService: SessionService) {
    this.accountService = accountService
    this.sessionService = sessionService
  }

  // MARK: Handlers

  /**
   * POST /identity/challenge
   * Body: { address: string, chainId: number }
   * Returns: { challengeId: string, message: string }
   */
  challenge = async (req: Request, res: Response): Promise<void> => {
    const { address, chainId } = req.body as ChallengeBody

    if (!address || typeof address !== 'string') {
      res.status(400).json({ error: 'address is required' })
      return
    }

    if (!chainId || typeof chainId !== 'number') {
      res.status(400).json({ error: 'chainId is required' })
      return
    }

    try {
      const result = await this.accountService.createChallenge(address, chainId)
      res.status(200).json(result)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /identity/verify
   * Body: { address: string, nonce: string, signature: string, chainId: number }
   * Returns: { walletId: string, accountId: string }
   */
  verify = async (req: Request, res: Response): Promise<void> => {
    const { address, nonce, signature, chainId } = req.body as VerifyBody

    if (!address || typeof address !== 'string') {
      res.status(400).json({ error: 'address is required' })
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
    if (!chainId || typeof chainId !== 'number') {
      res.status(400).json({ error: 'chainId is required' })
      return
    }

    try {
      const result = await this.accountService.verifyAndProvision(
        address,
        nonce,
        signature,
        chainId
      )

      const ip         = (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? 'unknown'
      const deviceName = (req.headers['x-device-name'] as string)   ?? 'unknown'
      const deviceType = (req.headers['x-device-type'] as string)   ?? 'unknown'

      const tokens = await this.sessionService.create(
        result.account.id,
        result.wallet.id,
        result.wallet.chainId,
        deviceName,
        deviceType,
        ip
      )

      res.status(200).json({
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId:    tokens.sessionId,
        accountId:    tokens.accountId,
        walletId:     result.wallet.id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN'

      if (message === 'WALLET_NOT_FOUND') {
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

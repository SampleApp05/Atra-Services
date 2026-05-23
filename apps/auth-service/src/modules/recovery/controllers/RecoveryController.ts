import type { Request, Response } from 'express'
import type { RecoveryService } from '../services/RecoveryService.js'

export class RecoveryController {
  private readonly recoveryService: RecoveryService

  constructor(recoveryService: RecoveryService) {
    this.recoveryService = recoveryService
  }

  // POST /recovery/challenge
  challenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId, recoveryAddress } = req.body as {
        accountId: string
        recoveryAddress: string
      }
      if (!accountId || !recoveryAddress) {
        res.status(400).json({ error: 'MISSING_FIELDS' })
        return
      }
      const result = await this.recoveryService.createRecoveryChallenge(accountId, recoveryAddress)
      res.status(200).json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR'
      const status = msg === 'RECOVERY_WALLET_NOT_FOUND' ? 404
        : msg === 'NOT_RECOVERY_WALLET' ? 403
        : 500
      res.status(status).json({ error: msg })
    }
  }

  // POST /recovery/execute
  execute = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId, recoveryAddress, nonce, signature } = req.body as {
        accountId: string
        recoveryAddress: string
        nonce: string
        signature: string
      }
      if (!accountId || !recoveryAddress || !nonce || !signature) {
        res.status(400).json({ error: 'MISSING_FIELDS' })
        return
      }
      const result = await this.recoveryService.executeRecovery(accountId, recoveryAddress, nonce, signature)
      res.status(200).json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR'
      const status = msg === 'RECOVERY_WALLET_NOT_FOUND' ? 404
        : msg === 'NOT_RECOVERY_WALLET' ? 403
        : msg === 'INVALID_OR_EXPIRED_NONCE' ? 401
        : msg === 'SIGNATURE_MISMATCH' ? 401
        : 500
      res.status(status).json({ error: msg })
    }
  }
}

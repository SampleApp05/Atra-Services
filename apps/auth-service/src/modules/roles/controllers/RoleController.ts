import type { Request, Response } from 'express'
import type { RoleService } from '../services/RoleService.js'
import type { RoleOperation } from '../services/RoleService.js'

export class RoleController {
  private readonly roleService: RoleService

  constructor(roleService: RoleService) {
    this.roleService = roleService
  }

  // POST /roles/challenge
  challenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId, walletId, targetAddress } = req.body as {
        accountId: string
        walletId: string
        targetAddress: string
      }

      if (!accountId || !walletId || !targetAddress) {
        res.status(400).json({ error: 'MISSING_FIELDS' })
        return
      }

      const result = await this.roleService.createRoleChallenge(accountId, walletId, targetAddress)
      res.status(200).json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR'
      const status = msg === 'NOT_OWNER' ? 403
        : msg === 'TARGET_WALLET_NOT_FOUND' ? 404
        : 500
      res.status(status).json({ error: msg })
    }
  }

  // POST /roles/verify
  verify = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        accountId, walletId, targetAddress, operation,
        ownerNonce, ownerSignature,
        targetNonce, targetSignature,
      } = req.body as {
        accountId: string
        walletId: string
        targetAddress: string
        operation: RoleOperation
        ownerNonce: string
        ownerSignature: string
        targetNonce: string
        targetSignature: string
      }

      if (!accountId || !walletId || !targetAddress || !operation ||
          !ownerNonce || !ownerSignature || !targetNonce || !targetSignature) {
        res.status(400).json({ error: 'MISSING_FIELDS' })
        return
      }

      const VALID_OPS: RoleOperation[] = [
        'GRANT_AUTH', 'REVOKE_AUTH', 'ASSIGN_RECOVERY', 'TRANSFER_OWNER', 'REMOVE_WALLET',
      ]
      if (!VALID_OPS.includes(operation)) {
        res.status(400).json({ error: 'INVALID_OPERATION' })
        return
      }

      await this.roleService.verifyAndApply(
        accountId, walletId, targetAddress, operation,
        ownerNonce, ownerSignature,
        targetNonce, targetSignature
      )
      res.status(200).json({ success: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR'
      const status = msg === 'NOT_OWNER' ? 403
        : msg === 'TARGET_WALLET_NOT_FOUND' ? 404
        : msg === 'INVALID_OWNER_NONCE' || msg === 'INVALID_TARGET_NONCE' ? 401
        : msg === 'OWNER_SIGNATURE_MISMATCH' || msg === 'TARGET_SIGNATURE_MISMATCH' ? 401
        : msg === 'CANNOT_REMOVE_OWNER_WALLET' || msg === 'CANNOT_TRANSFER_TO_SELF' ? 422
        : msg === 'RECOVERY_WALLET_ALREADY_ASSIGNED' ? 409
        : 500
      res.status(status).json({ error: msg })
    }
  }
}

import type { Request, Response } from 'express'
import type { AuditLogService } from '../services/AuditLogService.js'

export class AuditController {
  private readonly auditLogService: AuditLogService

  constructor(auditLogService: AuditLogService) {
    this.auditLogService = auditLogService
  }

  // GET /audit/:accountId
  getLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId } = req.params as { accountId: string }

      // Callers may only query their own audit trail
      if (req.auth?.accountId !== accountId) {
        res.status(403).json({ error: 'FORBIDDEN' })
        return
      }

      const limit  = parseInt(String(req.query['limit']  ?? '50'), 10)
      const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined

      const result = await this.auditLogService.getLogsForAccount(accountId, limit, cursor)
      res.status(200).json(result)
    } catch {
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}

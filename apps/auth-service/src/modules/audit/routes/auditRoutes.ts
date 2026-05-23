import { Router } from 'express'
import type { Db } from '@atra/database'
import { AuditLogService } from '../services/AuditLogService.js'
import { AuditController } from '../controllers/AuditController.js'

export function createAuditRoutes(db: Db): Router {
  const router = Router()
  const service    = new AuditLogService(db)
  const controller = new AuditController(service)

  // Protected by authenticate middleware applied at the app level
  router.get('/:accountId', controller.getLogs)

  return router
}

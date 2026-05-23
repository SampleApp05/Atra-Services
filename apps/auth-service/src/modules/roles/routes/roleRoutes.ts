import { Router } from 'express'
import type { Db } from '@atra/database'
import { RoleService } from '../services/RoleService.js'
import { RoleController } from '../controllers/RoleController.js'
import type { NonceService } from '../../identity/services/NonceService.js'
import type { SignatureService } from '../../identity/services/SignatureService.js'

export function createRoleRoutes(
  db: Db,
  nonceService: NonceService,
  signatureService: SignatureService
): Router {
  const router = Router()
  const service = new RoleService(db, nonceService, signatureService)
  const controller = new RoleController(service)

  router.post('/challenge', controller.challenge)
  router.post('/verify',    controller.verify)

  return router
}

import { Router } from 'express'
import type { Db } from '@atra/database'
import { RecoveryService } from '../services/RecoveryService.js'
import { RecoveryController } from '../controllers/RecoveryController.js'
import type { NonceService } from '../../identity/services/NonceService.js'
import type { SignatureService } from '../../identity/services/SignatureService.js'

export function createRecoveryRoutes(
  db: Db,
  nonceService: NonceService,
  signatureService: SignatureService
): Router {
  const router = Router()
  const service = new RecoveryService(db, nonceService, signatureService)
  const controller = new RecoveryController(service)

  router.post('/challenge', controller.challenge)
  router.post('/execute',   controller.execute)

  return router
}

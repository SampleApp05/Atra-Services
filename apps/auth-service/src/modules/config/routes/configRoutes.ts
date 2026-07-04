// MARK: - Config Routes

import { Router } from 'express'
import type { ChainService } from '../../../shared/chains/chain.service.js'
import { ConfigController } from '../controllers/ConfigController.js'

// MARK: - Factory

export function createConfigRouter(chainService: ChainService): Router {
  const router = Router()
  const controller = new ConfigController(chainService)

  router.get('/', controller.getConfig)

  return router
}

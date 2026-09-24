// MARK: - Auth Routes

import { Router } from 'express'
import type { Db } from '@atra/database'
import { TokenService } from '../services/TokenService.js'
import { SessionService } from '../services/SessionService.js'
import { SessionRepository } from '../repositories/SessionRepository.js'
import { AuthController } from '../controllers/AuthController.js'
import { createAuthMiddleware } from '../../../middleware/authenticate.js'

// MARK: - Factory

export function createAuthRouter(db: Db): Router {
  const router = Router()

  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET env var is required')

  const tokenService     = new TokenService(secret)
  const sessionRepo      = new SessionRepository(db)
  const sessionService   = new SessionService(db, tokenService, sessionRepo)
  const controller       = new AuthController(sessionService)
  // Session revocation is authenticated by JWT — accountId/walletId come
  // from the persisted session actor, never the request body. Refresh
  // stays public: it authenticates via the raw refresh token itself.
  const authenticate     = createAuthMiddleware(db)

  router.post('/refresh', controller.refresh)
  router.post('/revoke',  authenticate, controller.revoke)

  return router
}

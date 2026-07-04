// MARK: - Identity Routes

import { Router } from 'express'
import type { Db } from '@atra/database'
import { NonceService } from '../services/NonceService.js'
import { SignatureService } from '../services/SignatureService.js'
import { AccountService } from '../services/AccountService.js'
import { IdentityController } from '../controllers/IdentityController.js'
import { TokenService } from '../../auth/services/TokenService.js'
import { SessionService } from '../../auth/services/SessionService.js'
import { SessionRepository } from '../../auth/repositories/SessionRepository.js'
import type { ChainService } from '../../../shared/chains/chain.service.js'

// MARK: - Factory

export function createIdentityRouter(db: Db, chainService: ChainService): Router {
  const router = Router()

  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET env var is required')

  const nonceService     = new NonceService(db)
  const signatureService = new SignatureService()
  const accountService   = new AccountService(db, nonceService, signatureService, chainService)
  const tokenService     = new TokenService(secret)
  const sessionRepo      = new SessionRepository(db)
  const sessionService   = new SessionService(db, tokenService, sessionRepo)
  const controller       = new IdentityController(accountService, sessionService)

  router.post('/challenge', controller.challenge)
  router.post('/verify',    controller.verify)

  return router
}

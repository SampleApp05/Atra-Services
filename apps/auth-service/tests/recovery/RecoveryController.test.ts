import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { RecoveryController } from '../../src/modules/recovery/controllers/RecoveryController.js'

const mockService = {
  createRecoveryChallenge: vi.fn(),
  executeRecovery: vi.fn(),
}

const CHAIN_ID = 11155111
const AUTH = { accountId: 'acc', sessionId: 'sess', walletId: 'wid', roles: ['RECOVERY'], chainId: CHAIN_ID }

function buildApp(auth: typeof AUTH | null = AUTH) {
  const app = express()
  app.use(express.json())
  // Fake auth middleware — simulates what authenticate.ts attaches on protected routes
  app.use((req: any, _res: any, next: any) => {
    if (auth) req.auth = auth
    next()
  })
  const controller = new RecoveryController(mockService as any)
  app.post('/recovery/challenge', controller.challenge)
  app.post('/recovery/execute',   controller.execute)
  return app
}

describe('RecoveryController', () => {
  beforeEach(() => vi.clearAllMocks())

  // MARK: POST /recovery/challenge

  describe('POST /recovery/challenge', () => {
    it('returns 200 with challenge on success', async () => {
      mockService.createRecoveryChallenge.mockResolvedValue({ challengeId: 'ch-1', message: 'msg' })
      const res = await request(buildApp())
        .post('/recovery/challenge')
        .send({ recoveryAddress: '0xrec' })
      expect(res.status).toBe(200)
      expect(res.body.challengeId).toBe('ch-1')
    })

    it('derives accountId from the authenticated session, ignoring the body', async () => {
      mockService.createRecoveryChallenge.mockResolvedValue({ challengeId: 'ch-1', message: 'msg' })
      await request(buildApp())
        .post('/recovery/challenge')
        .send({ accountId: 'attacker-acc', recoveryAddress: '0xrec' })
      expect(mockService.createRecoveryChallenge).toHaveBeenCalledWith(AUTH.accountId, '0xrec', CHAIN_ID)
    })

    it('returns 400 when fields are missing', async () => {
      const res = await request(buildApp())
        .post('/recovery/challenge')
        .send({})
      expect(res.status).toBe(400)
    })

    it('returns 401 when there is no authenticated session', async () => {
      const res = await request(buildApp(null))
        .post('/recovery/challenge')
        .send({ recoveryAddress: '0xrec' })
      expect(res.status).toBe(401)
    })

    it('returns 404 when RECOVERY_WALLET_NOT_FOUND', async () => {
      mockService.createRecoveryChallenge.mockRejectedValue(new Error('RECOVERY_WALLET_NOT_FOUND'))
      const res = await request(buildApp())
        .post('/recovery/challenge')
        .send({ recoveryAddress: '0xbad' })
      expect(res.status).toBe(404)
    })

    it('returns 403 when NOT_RECOVERY_WALLET', async () => {
      mockService.createRecoveryChallenge.mockRejectedValue(new Error('NOT_RECOVERY_WALLET'))
      const res = await request(buildApp())
        .post('/recovery/challenge')
        .send({ recoveryAddress: '0xbad' })
      expect(res.status).toBe(403)
    })
  })

  // MARK: POST /recovery/execute

  describe('POST /recovery/execute', () => {
    const validBody = {
      recoveryAddress: '0xrec', nonce: 'n1', signature: 'sig1',
    }

    it('returns 200 with newOwnerWalletId on success', async () => {
      mockService.executeRecovery.mockResolvedValue({ newOwnerWalletId: 'wid-rec' })
      const res = await request(buildApp()).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(200)
      expect(res.body.newOwnerWalletId).toBe('wid-rec')
    })

    it('derives accountId from the authenticated session, ignoring the body', async () => {
      mockService.executeRecovery.mockResolvedValue({ newOwnerWalletId: 'wid-rec' })
      await request(buildApp()).post('/recovery/execute').send({ ...validBody, accountId: 'attacker-acc' })
      expect(mockService.executeRecovery).toHaveBeenCalledWith(
        AUTH.accountId, validBody.recoveryAddress, validBody.nonce, validBody.signature, CHAIN_ID
      )
    })

    it('returns 400 when fields missing', async () => {
      const res = await request(buildApp()).post('/recovery/execute').send({})
      expect(res.status).toBe(400)
    })

    it('returns 401 when there is no authenticated session', async () => {
      const res = await request(buildApp(null)).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 401 on INVALID_OR_EXPIRED_NONCE', async () => {
      mockService.executeRecovery.mockRejectedValue(new Error('INVALID_OR_EXPIRED_NONCE'))
      const res = await request(buildApp()).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 401 on SIGNATURE_MISMATCH', async () => {
      mockService.executeRecovery.mockRejectedValue(new Error('SIGNATURE_MISMATCH'))
      const res = await request(buildApp()).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 403 on NOT_RECOVERY_WALLET', async () => {
      mockService.executeRecovery.mockRejectedValue(new Error('NOT_RECOVERY_WALLET'))
      const res = await request(buildApp()).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(403)
    })

    it('returns 404 on RECOVERY_WALLET_NOT_FOUND', async () => {
      mockService.executeRecovery.mockRejectedValue(new Error('RECOVERY_WALLET_NOT_FOUND'))
      const res = await request(buildApp()).post('/recovery/execute').send(validBody)
      expect(res.status).toBe(404)
    })
  })
})

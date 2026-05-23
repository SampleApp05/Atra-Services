import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { RoleController } from '../../src/modules/roles/controllers/RoleController.js'

const mockService = {
  createRoleChallenge: vi.fn(),
  verifyAndApply: vi.fn(),
}

function buildApp() {
  const app = express()
  app.use(express.json())
  const controller = new RoleController(mockService as any)
  app.post('/roles/challenge', controller.challenge)
  app.post('/roles/verify',    controller.verify)
  return app
}

describe('RoleController', () => {
  beforeEach(() => vi.clearAllMocks())

  // MARK: POST /roles/challenge

  describe('POST /roles/challenge', () => {
    it('returns 200 with dual challenge on success', async () => {
      mockService.createRoleChallenge.mockResolvedValue({
        ownerChallengeId: 'oc-1',
        ownerMessage: 'msg-owner',
        targetChallengeId: 'tc-1',
        targetMessage: 'msg-target',
      })
      const res = await request(buildApp())
        .post('/roles/challenge')
        .send({ accountId: 'acc', walletId: 'wid', targetAddress: '0xtarget' })
      expect(res.status).toBe(200)
      expect(res.body.ownerChallengeId).toBe('oc-1')
      expect(res.body.targetChallengeId).toBe('tc-1')
    })

    it('returns 400 when fields are missing', async () => {
      const res = await request(buildApp())
        .post('/roles/challenge')
        .send({ accountId: 'acc' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('MISSING_FIELDS')
    })

    it('returns 403 when NOT_OWNER', async () => {
      mockService.createRoleChallenge.mockRejectedValue(new Error('NOT_OWNER'))
      const res = await request(buildApp())
        .post('/roles/challenge')
        .send({ accountId: 'acc', walletId: 'wid', targetAddress: '0xt' })
      expect(res.status).toBe(403)
    })

    it('returns 404 when TARGET_WALLET_NOT_FOUND', async () => {
      mockService.createRoleChallenge.mockRejectedValue(new Error('TARGET_WALLET_NOT_FOUND'))
      const res = await request(buildApp())
        .post('/roles/challenge')
        .send({ accountId: 'acc', walletId: 'wid', targetAddress: '0xt' })
      expect(res.status).toBe(404)
    })
  })

  // MARK: POST /roles/verify

  describe('POST /roles/verify', () => {
    const validBody = {
      accountId: 'acc', walletId: 'wid', targetAddress: '0xt',
      operation: 'GRANT_AUTH',
      ownerNonce: 'on', ownerSignature: 'os',
      targetNonce: 'tn', targetSignature: 'ts',
    }

    it('returns 200 on success', async () => {
      mockService.verifyAndApply.mockResolvedValue(undefined)
      const res = await request(buildApp()).post('/roles/verify').send(validBody)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 400 on missing fields', async () => {
      const res = await request(buildApp()).post('/roles/verify').send({ accountId: 'acc' })
      expect(res.status).toBe(400)
    })

    it('returns 400 on invalid operation', async () => {
      const res = await request(buildApp()).post('/roles/verify')
        .send({ ...validBody, operation: 'MAKE_ADMIN' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('INVALID_OPERATION')
    })

    it('returns 403 when NOT_OWNER', async () => {
      mockService.verifyAndApply.mockRejectedValue(new Error('NOT_OWNER'))
      const res = await request(buildApp()).post('/roles/verify').send(validBody)
      expect(res.status).toBe(403)
    })

    it('returns 401 on INVALID_OWNER_NONCE', async () => {
      mockService.verifyAndApply.mockRejectedValue(new Error('INVALID_OWNER_NONCE'))
      const res = await request(buildApp()).post('/roles/verify').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 401 on TARGET_SIGNATURE_MISMATCH', async () => {
      mockService.verifyAndApply.mockRejectedValue(new Error('TARGET_SIGNATURE_MISMATCH'))
      const res = await request(buildApp()).post('/roles/verify').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 409 on RECOVERY_WALLET_ALREADY_ASSIGNED', async () => {
      mockService.verifyAndApply.mockRejectedValue(new Error('RECOVERY_WALLET_ALREADY_ASSIGNED'))
      const res = await request(buildApp()).post('/roles/verify')
        .send({ ...validBody, operation: 'ASSIGN_RECOVERY' })
      expect(res.status).toBe(409)
    })

    it('returns 422 on CANNOT_REMOVE_OWNER_WALLET', async () => {
      mockService.verifyAndApply.mockRejectedValue(new Error('CANNOT_REMOVE_OWNER_WALLET'))
      const res = await request(buildApp()).post('/roles/verify')
        .send({ ...validBody, operation: 'REMOVE_WALLET' })
      expect(res.status).toBe(422)
    })
  })
})

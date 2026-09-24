// MARK: - AuthController Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthController } from '../../src/modules/auth/controllers/AuthController.js'
import type { SessionService } from '../../src/modules/auth/services/SessionService.js'
import type { Request, Response } from 'express'

// MARK: - Helpers

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  return res as unknown as Response
}

function mockReq(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  auth: Record<string, unknown> | undefined = undefined
): Request {
  return { body, headers, socket: { remoteAddress: '1.2.3.4' }, auth } as unknown as Request
}

const TOKENS = {
  accessToken: 'access.jwt',
  refreshToken: 'raw-refresh',
  sessionId: 'ses-1',
  accountId: 'acc-1',
}

const AUTHENTICATED = { accountId: 'acc-1', sessionId: 'ses-1', walletId: 'wid-1', roles: ['OWNER'], chainId: 1 }

// MARK: - Tests

describe('AuthController', () => {
  let sessionService: SessionService
  let controller: AuthController

  beforeEach(() => {
    sessionService = {
      refresh: vi.fn().mockResolvedValue(TOKENS),
      revoke:  vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionService

    controller = new AuthController(sessionService)
  })

  // MARK: refresh

  describe('POST /auth/refresh', () => {
    it('returns 400 when refreshToken is missing', async () => {
      const res = mockRes()
      await controller.refresh(mockReq({}), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 200 with new tokens on success', async () => {
      const res = mockRes()
      await controller.refresh(mockReq({ refreshToken: 'raw-refresh' }), res)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(TOKENS)
    })

    it('returns 401 for INVALID_OR_EXPIRED_REFRESH_TOKEN', async () => {
      ;(sessionService.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('INVALID_OR_EXPIRED_REFRESH_TOKEN')
      )
      const res = mockRes()
      await controller.refresh(mockReq({ refreshToken: 'bad' }), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 500 on unexpected error', async () => {
      ;(sessionService.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB'))
      const res = mockRes()
      await controller.refresh(mockReq({ refreshToken: 'raw' }), res)
      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  // MARK: revoke

  describe('POST /auth/revoke', () => {
    it('returns 400 when sessionId is missing', async () => {
      const res = mockRes()
      await controller.revoke(mockReq({}, {}, AUTHENTICATED), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 401 when there is no authenticated session', async () => {
      const res = mockRes()
      await controller.revoke(mockReq({ sessionId: 'ses-1' }, {}, undefined), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('derives accountId from the authenticated session, ignoring the body', async () => {
      const res = mockRes()
      await controller.revoke(
        mockReq({ sessionId: 'ses-1', accountId: 'attacker-acc' }, {}, AUTHENTICATED),
        res
      )
      expect(sessionService.revoke).toHaveBeenCalledWith('ses-1', AUTHENTICATED.accountId)
    })

    it('returns 200 on success', async () => {
      const res = mockRes()
      await controller.revoke(mockReq({ sessionId: 'ses-1' }, {}, AUTHENTICATED), res)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ revoked: true })
    })

    it('returns 404 for SESSION_NOT_FOUND', async () => {
      ;(sessionService.revoke as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('SESSION_NOT_FOUND')
      )
      const res = mockRes()
      await controller.revoke(mockReq({ sessionId: 'ses-1' }, {}, AUTHENTICATED), res)
      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('returns 500 on unexpected error', async () => {
      ;(sessionService.revoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB'))
      const res = mockRes()
      await controller.revoke(mockReq({ sessionId: 'ses-1' }, {}, AUTHENTICATED), res)
      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})

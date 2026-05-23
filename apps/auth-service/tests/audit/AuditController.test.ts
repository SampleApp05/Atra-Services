import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { AuditController } from '../../src/modules/audit/controllers/AuditController.js'

// MARK: - Mock service

const mockService = {
  getLogsForAccount: vi.fn(),
}

// MARK: - App builder

function buildApp(auth?: { accountId: string }) {
  const app = express()
  app.use(express.json())
  // Inject fake auth context (simulates authenticate middleware)
  app.use((req, _res, next) => {
    if (auth) (req as any).auth = auth
    next()
  })
  const controller = new AuditController(mockService as any)
  app.get('/audit/:accountId', controller.getLogs)
  return app
}

// MARK: - Tests

describe('AuditController', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('GET /audit/:accountId', () => {
    it('returns 200 with logs when caller matches accountId', async () => {
      mockService.getLogsForAccount.mockResolvedValue({
        logs: [{ id: 'l1', action: 'SESSION_CREATED' }],
        nextCursor: null,
      })
      const res = await request(buildApp({ accountId: 'acc-1' }))
        .get('/audit/acc-1')
      expect(res.status).toBe(200)
      expect(res.body.logs).toHaveLength(1)
      expect(res.body.nextCursor).toBeNull()
    })

    it('returns 403 when caller tries to read another account\'s logs', async () => {
      const res = await request(buildApp({ accountId: 'acc-2' }))
        .get('/audit/acc-1')
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('returns 403 when req.auth is absent (middleware not applied)', async () => {
      const res = await request(buildApp(undefined))
        .get('/audit/acc-1')
      expect(res.status).toBe(403)
    })

    it('forwards limit and cursor query params to the service', async () => {
      mockService.getLogsForAccount.mockResolvedValue({ logs: [], nextCursor: null })
      await request(buildApp({ accountId: 'acc-1' }))
        .get('/audit/acc-1?limit=10&cursor=l99')
      expect(mockService.getLogsForAccount).toHaveBeenCalledWith('acc-1', 10, 'l99')
    })

    it('passes undefined cursor when not provided', async () => {
      mockService.getLogsForAccount.mockResolvedValue({ logs: [], nextCursor: null })
      await request(buildApp({ accountId: 'acc-1' }))
        .get('/audit/acc-1?limit=5')
      expect(mockService.getLogsForAccount).toHaveBeenCalledWith('acc-1', 5, undefined)
    })
  })
})

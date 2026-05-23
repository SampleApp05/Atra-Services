import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { type Request, type Response } from 'express'
import request from 'supertest'
import { TokenService } from '../../src/modules/auth/services/TokenService.js'
import { createAuthMiddleware } from '../../src/middleware/authenticate.js'

// MARK: - Helpers

function makeLimit<T>(rows: T[]) {
  return {
    then: (resolve: (v: T[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
    limit: (_n: number) => Promise.resolve(rows),
  }
}

// MARK: - Constants

const SECRET     = 'supersecretkey1234567890abcdefghij'
const ACCOUNT_ID = 'acc-1'
const SESSION_ID = 'sess-1'
const WALLET_ID  = 'wid-1'

// MARK: - DB mock

let dbSelectCalls: Array<() => ReturnType<typeof makeLimit>> = []

const mockDb: any = {
  select: () => ({
    from: () => ({
      where: () => {
        const factory = dbSelectCalls.shift() ?? (() => makeLimit([]))
        return factory()
      },
    }),
  }),
}

// MARK: - Fixtures

const tokenService  = new TokenService(SECRET)
const validToken    = tokenService.signAccessToken({
  accountId: ACCOUNT_ID, sessionId: SESSION_ID, roles: ['OWNER', 'AUTH'],
})

const activeSession = {
  id: SESSION_ID, accountId: ACCOUNT_ID, revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
}
const activeAccount = { id: ACCOUNT_ID }
const roleRow       = { walletId: WALLET_ID, role: 'AUTH' }

// MARK: - App builder

function buildApp() {
  process.env['JWT_SECRET'] = SECRET
  const middleware = createAuthMiddleware(mockDb)
  const app = express()
  app.use(express.json())
  app.use(middleware)
  app.get('/protected', (req: Request, res: Response) => {
    res.json({ auth: (req as any).auth })
  })
  return app
}

// MARK: - Tests

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectCalls = []
  })

  // MARK: Missing token

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(buildApp()).get('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('MISSING_TOKEN')
  })

  it('returns 401 when Authorization header has wrong scheme', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Basic abc')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('MISSING_TOKEN')
  })

  // MARK: ?token= query param (WebSocket upgrade path)

  it('accepts token via ?token= query param', async () => {
    dbSelectCalls = [
      () => makeLimit([activeSession]),
      () => makeLimit([activeAccount]),
      () => makeLimit([roleRow]),
    ]
    const res = await request(buildApp())
      .get(`/protected?token=${validToken}`)
    expect(res.status).toBe(200)
    expect(res.body.auth.accountId).toBe(ACCOUNT_ID)
  })

  // MARK: Invalid / expired JWT

  it('returns 401 when JWT is malformed', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer not.a.valid.jwt')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('INVALID_TOKEN')
  })

  it('returns 401 when JWT is signed with the wrong secret', async () => {
    const badToken = new TokenService('different-secret-32-chars-long!!!!').signAccessToken({
      accountId: ACCOUNT_ID, sessionId: SESSION_ID, roles: [],
    })
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('INVALID_TOKEN')
  })

  // MARK: Session checks

  it('returns 401 when session is not found in DB', async () => {
    dbSelectCalls = [() => makeLimit([])]
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('SESSION_EXPIRED_OR_REVOKED')
  })

  it('returns 401 when session is expired', async () => {
    const expiredSession = { ...activeSession, expiresAt: new Date(Date.now() - 1000) }
    dbSelectCalls = [() => makeLimit([expiredSession])]
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('SESSION_EXPIRED_OR_REVOKED')
  })

  // MARK: Account check

  it('returns 401 when account no longer exists', async () => {
    dbSelectCalls = [
      () => makeLimit([activeSession]),
      () => makeLimit([]),
    ]
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('ACCOUNT_NOT_FOUND')
  })

  // MARK: Happy path

  it('attaches req.auth and calls next() on valid token', async () => {
    dbSelectCalls = [
      () => makeLimit([activeSession]),
      () => makeLimit([activeAccount]),
      () => makeLimit([roleRow]),
    ]
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(200)
    expect(res.body.auth.accountId).toBe(ACCOUNT_ID)
    expect(res.body.auth.sessionId).toBe(SESSION_ID)
    expect(res.body.auth.walletId).toBe(WALLET_ID)
    expect(res.body.auth.roles).toContain('OWNER')
  })

  it('sets walletId to null when no AUTH role row found', async () => {
    dbSelectCalls = [
      () => makeLimit([activeSession]),
      () => makeLimit([activeAccount]),
      () => makeLimit([]),
    ]
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(200)
    expect(res.body.auth.walletId).toBeNull()
  })
})

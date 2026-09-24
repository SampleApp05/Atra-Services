// MARK: - Auth Controller
// POST /auth/refresh  — rotate refresh token
// POST /auth/revoke   — revoke a session

import type { Request, Response } from 'express'
import type { SessionService } from '../services/SessionService.js'

// MARK: - Controller

export class AuthController {
  // MARK: Private State

  private readonly sessionService: SessionService

  // MARK: Init

  constructor(sessionService: SessionService) {
    this.sessionService = sessionService
  }

  // MARK: - Handlers

  /**
   * POST /auth/refresh
   * Body: { refreshToken: string }
   * Returns: { accessToken, refreshToken, sessionId, accountId }
   */
  refresh = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body as { refreshToken?: string }

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'refreshToken is required' })
      return
    }

    const ip = (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? 'unknown'
    const deviceName = (req.headers['x-device-name'] as string) ?? 'unknown'
    const deviceType = (req.headers['x-device-type'] as string) ?? 'unknown'

    try {
      const tokens = await this.sessionService.refresh(
        refreshToken,
        deviceName,
        deviceType,
        ip
      )
      res.status(200).json(tokens)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN'
      if (message === 'INVALID_OR_EXPIRED_REFRESH_TOKEN') {
        res.status(401).json({ error: 'Invalid or expired refresh token' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }

  /**
   * POST /auth/revoke
   * Body: { sessionId: string }
   * Auth: JWT — accountId comes from the authenticated session (req.auth),
   *       never from the request body.
   */
  revoke = async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body as {
      sessionId?: string
    }

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' })
      return
    }

    const accountId = req.auth?.accountId
    if (!accountId) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }

    try {
      await this.sessionService.revoke(sessionId, accountId)
      res.status(200).json({ revoked: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN'
      if (message === 'SESSION_NOT_FOUND') {
        res.status(404).json({ error: 'Session not found' })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}

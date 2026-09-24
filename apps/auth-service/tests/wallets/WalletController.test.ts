// MARK: - WalletController Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletController } from '../../src/modules/wallets/controllers/WalletController.js'
import type { WalletLinkingService } from '../../src/modules/wallets/services/WalletLinkingService.js'
import type { Request, Response } from 'express'

// MARK: - Helpers

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  return res as unknown as Response
}

const AUTHENTICATED = { accountId: 'acc-1', sessionId: 'sess-1', walletId: 'wid-1', roles: ['OWNER'], chainId: 1 }

function mockReq(body: Record<string, unknown> = {}, auth: Record<string, unknown> | null = AUTHENTICATED): Request {
  return { body, headers: {}, socket: { remoteAddress: '1.2.3.4' }, auth } as unknown as Request
}

const VALID_CHALLENGE_BODY = {
  newAddress: '0xabc',
  chainId: 1,
}

const VALID_VERIFY_BODY = {
  newAddress: '0xabc',
  nonce: 'deadbeef',
  signature: '0xsig',
}

// MARK: - Tests

describe('WalletController', () => {
  let walletLinkingService: WalletLinkingService
  let controller: WalletController

  beforeEach(() => {
    walletLinkingService = {
      createLinkChallenge: vi.fn().mockResolvedValue({ challengeId: 'cid-1', message: 'msg' }),
      verifyAndLink: vi.fn().mockResolvedValue({ walletId: 'w1', role: 'STANDARD' }),
    } as unknown as WalletLinkingService

    controller = new WalletController(walletLinkingService)
  })

  // MARK: linkChallenge

  describe('POST /wallets/link/challenge', () => {
    it('returns 400 when newAddress is missing', async () => {
      const { newAddress: _, ...body } = VALID_CHALLENGE_BODY
      const res = mockRes()
      await controller.linkChallenge(mockReq(body), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when chainId is missing', async () => {
      const { chainId: _, ...body } = VALID_CHALLENGE_BODY
      const res = mockRes()
      await controller.linkChallenge(mockReq(body), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 401 when there is no authenticated session', async () => {
      const res = mockRes()
      await controller.linkChallenge(mockReq(VALID_CHALLENGE_BODY, null), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('ignores accountId/walletId supplied in the body and uses the session actor', async () => {
      const res = mockRes()
      await controller.linkChallenge(
        mockReq({ ...VALID_CHALLENGE_BODY, accountId: 'attacker-acc', walletId: 'attacker-wid' }),
        res
      )
      expect(walletLinkingService.createLinkChallenge).toHaveBeenCalledWith(
        AUTHENTICATED.accountId, AUTHENTICATED.walletId, VALID_CHALLENGE_BODY.newAddress, VALID_CHALLENGE_BODY.chainId
      )
    })

    it('returns 200 with challengeId and message on success', async () => {
      const res = mockRes()
      await controller.linkChallenge(mockReq(VALID_CHALLENGE_BODY), res)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ challengeId: 'cid-1', message: 'msg' })
    })

    it('returns 403 for INSUFFICIENT_ROLE', async () => {
      ;(walletLinkingService.createLinkChallenge as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('INSUFFICIENT_ROLE')
      )
      const res = mockRes()
      await controller.linkChallenge(mockReq(VALID_CHALLENGE_BODY), res)
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('returns 409 for ADDRESS_ALREADY_LINKED', async () => {
      ;(walletLinkingService.createLinkChallenge as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ADDRESS_ALREADY_LINKED')
      )
      const res = mockRes()
      await controller.linkChallenge(mockReq(VALID_CHALLENGE_BODY), res)
      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 500 on unexpected error', async () => {
      ;(walletLinkingService.createLinkChallenge as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB_DOWN')
      )
      const res = mockRes()
      await controller.linkChallenge(mockReq(VALID_CHALLENGE_BODY), res)
      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  // MARK: linkVerify

  describe('POST /wallets/link/verify', () => {
    it('returns 400 when newAddress is missing', async () => {
      const { newAddress: _, ...body } = VALID_VERIFY_BODY
      const res = mockRes()
      await controller.linkVerify(mockReq(body), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when nonce is missing', async () => {
      const { nonce: _, ...body } = VALID_VERIFY_BODY
      const res = mockRes()
      await controller.linkVerify(mockReq(body), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when signature is missing', async () => {
      const { signature: _, ...body } = VALID_VERIFY_BODY
      const res = mockRes()
      await controller.linkVerify(mockReq(body), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 401 when there is no authenticated session', async () => {
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY, null), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('ignores accountId/walletId supplied in the body and uses the session actor', async () => {
      const res = mockRes()
      await controller.linkVerify(
        mockReq({ ...VALID_VERIFY_BODY, accountId: 'attacker-acc', walletId: 'attacker-wid' }),
        res
      )
      expect(walletLinkingService.verifyAndLink).toHaveBeenCalledWith(
        AUTHENTICATED.accountId, AUTHENTICATED.walletId,
        VALID_VERIFY_BODY.newAddress, VALID_VERIFY_BODY.nonce, VALID_VERIFY_BODY.signature,
        AUTHENTICATED.chainId
      )
    })

    it('returns 200 with walletId and role on success', async () => {
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY), res)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ walletId: 'w1', role: 'STANDARD' })
    })

    it('returns 403 for INSUFFICIENT_ROLE', async () => {
      ;(walletLinkingService.verifyAndLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('INSUFFICIENT_ROLE')
      )
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY), res)
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('returns 401 for INVALID_OR_EXPIRED_NONCE', async () => {
      ;(walletLinkingService.verifyAndLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('INVALID_OR_EXPIRED_NONCE')
      )
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 401 for SIGNATURE_MISMATCH', async () => {
      ;(walletLinkingService.verifyAndLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('SIGNATURE_MISMATCH')
      )
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY), res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 500 on unexpected error', async () => {
      ;(walletLinkingService.verifyAndLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB_DOWN')
      )
      const res = mockRes()
      await controller.linkVerify(mockReq(VALID_VERIFY_BODY), res)
      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})

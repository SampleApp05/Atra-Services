// MARK: - ConfigController Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'
import { ConfigController } from '../../src/modules/config/controllers/ConfigController.js'
import type { ChainService } from '../../src/shared/chains/chain.service.js'

// MARK: - Helpers

function mockRes() {
  const res = { json: vi.fn() }
  return res as unknown as Response
}

const mockReq = {} as Request

// MARK: - Fixtures

function buildChainService(overrides: Partial<ReturnType<ChainService['getSupportedChains']>[number]>[] = []) {
  const defaultChains = [
    { id: 11155111, key: 'sepolia',  name: 'Ethereum Sepolia', testnet: true,  nativeCurrency: 'ETH', rpcUrl: '', wsUrl: '', explorer: '', contracts: {} },
    { id: 1,        key: 'ethereum', name: 'Ethereum',         testnet: false, nativeCurrency: 'ETH', rpcUrl: '', wsUrl: '', explorer: '', contracts: {} },
  ]

  return {
    getDefaultChainId: vi.fn().mockReturnValue(11155111),
    getSupportedChains: vi.fn().mockReturnValue(defaultChains),
  } as unknown as ChainService
}

// MARK: - Tests

describe('ConfigController', () => {
  let chainService: ChainService
  let controller: ConfigController

  beforeEach(() => {
    chainService = buildChainService()
    controller   = new ConfigController(chainService)
  })

  // MARK: GET /config

  describe('getConfig', () => {
    it('returns the default chain ID', () => {
      const res = mockRes()
      controller.getConfig(mockReq, res)
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].defaultChain).toBe(11155111)
    })

    it('returns supportedChains array', () => {
      const res = mockRes()
      controller.getConfig(mockReq, res)
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.supportedChains).toHaveLength(2)
    })

    it('returns chain entries with id, key, name, testnet fields only', () => {
      const res = mockRes()
      controller.getConfig(mockReq, res)
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const sepolia = body.supportedChains.find((c: { key: string }) => c.key === 'sepolia')
      expect(sepolia).toMatchObject({ id: 11155111, key: 'sepolia', name: 'Ethereum Sepolia', testnet: true })
      // rpcUrl and wsUrl must NOT be exposed publicly
      expect(sepolia.rpcUrl).toBeUndefined()
      expect(sepolia.wsUrl).toBeUndefined()
    })

    it('includes both testnet and mainnet chains', () => {
      const res = mockRes()
      controller.getConfig(mockReq, res)
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const testnets = body.supportedChains.filter((c: { testnet: boolean }) => c.testnet)
      const mainnets = body.supportedChains.filter((c: { testnet: boolean }) => !c.testnet)
      expect(testnets).toHaveLength(1)
      expect(mainnets).toHaveLength(1)
    })

    it('calls chainService.getSupportedChains()', () => {
      controller.getConfig(mockReq, mockRes())
      expect(chainService.getSupportedChains).toHaveBeenCalledOnce()
    })

    it('calls chainService.getDefaultChainId()', () => {
      controller.getConfig(mockReq, mockRes())
      expect(chainService.getDefaultChainId).toHaveBeenCalledOnce()
    })
  })
})

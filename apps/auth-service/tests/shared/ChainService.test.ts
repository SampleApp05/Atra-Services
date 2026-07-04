// MARK: - ChainService Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ChainService } from '../../src/shared/chains/chain.service.js'

// MARK: - Tests

describe('ChainService', () => {
  // MARK: Constructor

  describe('constructor', () => {
    it('throws for an unknown chain key', () => {
      expect(() => new ChainService(['notachain'], 'notachain')).toThrow(
        'Unknown chain key: "notachain"'
      )
    })

    it('throws when defaultKey is not in the supported list', () => {
      expect(() => new ChainService(['sepolia'], 'ethereum')).toThrow(
        'Default chain "ethereum" is not in the supported chains list'
      )
    })

    it('constructs successfully with valid keys', () => {
      expect(() => new ChainService(['sepolia'], 'sepolia')).not.toThrow()
    })

    it('constructs with both chains', () => {
      expect(() => new ChainService(['ethereum', 'sepolia'], 'sepolia')).not.toThrow()
    })
  })

  // MARK: isSupported

  describe('isSupported', () => {
    let service: ChainService

    beforeEach(() => {
      service = new ChainService(['ethereum', 'sepolia'], 'sepolia')
    })

    it('returns true for ethereum mainnet chain ID', () => {
      expect(service.isSupported(1)).toBe(true)
    })

    it('returns true for sepolia chain ID', () => {
      expect(service.isSupported(11155111)).toBe(true)
    })

    it('returns false for an unsupported chain ID', () => {
      expect(service.isSupported(137)).toBe(false) // Polygon
    })
  })

  // MARK: get

  describe('get', () => {
    let service: ChainService

    beforeEach(() => {
      service = new ChainService(['ethereum', 'sepolia'], 'sepolia')
    })

    it('returns config by numeric chain ID', () => {
      const config = service.get(1)
      expect(config.key).toBe('ethereum')
      expect(config.id).toBe(1)
      expect(config.testnet).toBe(false)
    })

    it('returns config by string key', () => {
      const config = service.get('sepolia')
      expect(config.id).toBe(11155111)
      expect(config.testnet).toBe(true)
    })

    it('throws for an unsupported chain ID', () => {
      expect(() => service.get(999)).toThrow('Chain not supported: 999')
    })

    it('throws for an unsupported chain key', () => {
      expect(() => service.get('base')).toThrow('Chain not supported: base')
    })
  })

  // MARK: getDefault

  describe('getDefault', () => {
    it('returns the default chain', () => {
      const service = new ChainService(['ethereum', 'sepolia'], 'sepolia')
      const def = service.getDefault()
      expect(def.key).toBe('sepolia')
      expect(def.id).toBe(11155111)
    })

    it('uses ethereum as default when configured', () => {
      const service = new ChainService(['ethereum', 'sepolia'], 'ethereum')
      expect(service.getDefaultChainId()).toBe(1)
    })
  })

  // MARK: getSupportedChains

  describe('getSupportedChains', () => {
    it('returns all enabled chains', () => {
      const service = new ChainService(['ethereum', 'sepolia'], 'sepolia')
      const chains = service.getSupportedChains()
      expect(chains).toHaveLength(2)
      const keys = chains.map((c) => c.key)
      expect(keys).toContain('ethereum')
      expect(keys).toContain('sepolia')
    })

    it('returns only the enabled chain when one is configured', () => {
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.getSupportedChains()).toHaveLength(1)
    })
  })

  // MARK: getDefaultChainId

  describe('getDefaultChainId', () => {
    it('returns the numeric default chain ID', () => {
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.getDefaultChainId()).toBe(11155111)
    })
  })

  // MARK: getRecoveryContract

  describe('getRecoveryContract', () => {
    let saved: string | undefined

    beforeEach(() => {
      saved = process.env['SEPOLIA_RECOVERY_CONTRACT']
      process.env['SEPOLIA_RECOVERY_CONTRACT'] = '0xdeadbeef'
    })

    afterEach(() => {
      if (saved === undefined) {
        delete process.env['SEPOLIA_RECOVERY_CONTRACT']
      } else {
        process.env['SEPOLIA_RECOVERY_CONTRACT'] = saved
      }
    })

    it('returns the contract address for a supported chain', () => {
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.getRecoveryContract(11155111)).toBe('0xdeadbeef')
    })

    it('returns undefined when no contract is configured', () => {
      delete process.env['SEPOLIA_RECOVERY_CONTRACT']
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.getRecoveryContract(11155111)).toBeUndefined()
    })
  })

  // MARK: RPC / WS env injection

  describe('env var injection', () => {
    let savedRpc: string | undefined
    let savedWs: string | undefined

    beforeEach(() => {
      savedRpc = process.env['SEPOLIA_RPC']
      savedWs  = process.env['SEPOLIA_WS']
      process.env['SEPOLIA_RPC'] = 'https://sepolia.example.com'
      process.env['SEPOLIA_WS']  = 'wss://sepolia.example.com'
    })

    afterEach(() => {
      process.env['SEPOLIA_RPC'] = savedRpc ?? ''
      process.env['SEPOLIA_WS']  = savedWs  ?? ''
    })

    it('reads rpcUrl from env', () => {
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.get('sepolia').rpcUrl).toBe('https://sepolia.example.com')
    })

    it('reads wsUrl from env', () => {
      const service = new ChainService(['sepolia'], 'sepolia')
      expect(service.get('sepolia').wsUrl).toBe('wss://sepolia.example.com')
    })
  })
})

// MARK: - Chain Service
// Single authority for everything chain-related.
// Reads RPC / WS / contract env vars at construction time,
// after dotenv has been loaded.

import type { ChainConfig } from './chain.types.js'
import { CHAIN_DEFINITIONS } from './chain.constants.js'

// MARK: - Service

export class ChainService {
  // MARK: Private State

  private readonly byId:  Map<number, ChainConfig>
  private readonly byKey: Map<string, ChainConfig>
  private readonly defaultId: number

  // MARK: Init

  /**
   * @param supportedKeys - chain keys to activate, e.g. ['ethereum', 'sepolia']
   * @param defaultKey    - key of the chain returned by getDefault()
   *
   * Env vars read per chain (key uppercased):
   *   {KEY}_RPC                 — HTTP RPC URL
   *   {KEY}_WS                  — WebSocket URL
   *   {KEY}_RECOVERY_CONTRACT   — optional recovery contract address
   */
  constructor(supportedKeys: string[], defaultKey: string) {
    this.byId  = new Map()
    this.byKey = new Map()

    for (const key of supportedKeys) {
      const def = CHAIN_DEFINITIONS[key]
      if (!def) throw new Error(`Unknown chain key: "${key}"`)

      const upper = key.toUpperCase()

      const config: ChainConfig = {
        ...def,
        rpcUrl: process.env[`${upper}_RPC`] ?? '',
        wsUrl:  process.env[`${upper}_WS`]  ?? '',
        contracts: {
          recovery: process.env[`${upper}_RECOVERY_CONTRACT`],
        },
      }

      this.byId.set(config.id, config)
      this.byKey.set(key, config)
    }

    const defaultConfig = this.byKey.get(defaultKey)
    if (!defaultConfig) {
      throw new Error(`Default chain "${defaultKey}" is not in the supported chains list`)
    }
    this.defaultId = defaultConfig.id
  }

  // MARK: - Public API

  /** Returns true if the given numeric chain ID is enabled. */
  isSupported(chainId: number): boolean {
    return this.byId.has(chainId)
  }

  /**
   * Looks up a chain by numeric ID or string key.
   * Throws if the chain is not supported.
   */
  get(chainIdOrKey: number | string): ChainConfig {
    const config =
      typeof chainIdOrKey === 'number'
        ? this.byId.get(chainIdOrKey)
        : this.byKey.get(chainIdOrKey)

    if (!config) throw new Error(`Chain not supported: ${chainIdOrKey}`)
    return config
  }

  /** Returns the default chain config. */
  getDefault(): ChainConfig {
    return this.byId.get(this.defaultId)!
  }

  /** Returns the default chain's numeric ID. */
  getDefaultChainId(): number {
    return this.defaultId
  }

  /** Returns all enabled chain configs. */
  getSupportedChains(): ChainConfig[] {
    return Array.from(this.byKey.values())
  }

  /** Looks up the recovery contract address for a given chain ID. */
  getRecoveryContract(chainId: number): string | undefined {
    return this.get(chainId).contracts.recovery
  }
}

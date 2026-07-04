// MARK: - Chain Types

export interface ChainConfig {
  id: number
  key: string
  name: string
  testnet: boolean
  nativeCurrency: string
  rpcUrl: string
  wsUrl: string
  explorer: string
  contracts: {
    recovery?: string
  }
}

// MARK: - Chain Definitions
// Static metadata for every chain ATRA knows about.
// RPC / WS URLs and contract addresses are NOT stored here —
// they are injected at runtime by ChainService from environment variables.

import type { ChainConfig } from './chain.types.js'

export const CHAIN_DEFINITIONS: Record<string, Omit<ChainConfig, 'rpcUrl' | 'wsUrl' | 'contracts'>> = {
  ethereum: {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    testnet: false,
    nativeCurrency: 'ETH',
    explorer: 'https://etherscan.io',
  },
  sepolia: {
    id: 11155111,
    key: 'sepolia',
    name: 'Ethereum Sepolia',
    testnet: true,
    nativeCurrency: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
  },
}

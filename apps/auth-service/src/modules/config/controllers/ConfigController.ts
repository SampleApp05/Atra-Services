// MARK: - Config Controller
// GET /config — returns the list of enabled chains for frontend bootstrap.

import type { Request, Response } from 'express'
import type { ChainService } from '../../../shared/chains/chain.service.js'

// MARK: - Controller

export class ConfigController {
  // MARK: Private State

  private readonly chainService: ChainService

  // MARK: Init

  constructor(chainService: ChainService) {
    this.chainService = chainService
  }

  // MARK: - Handlers

  /**
   * GET /config
   * Returns the default chain ID and the list of supported chains.
   * No auth required — this is the first request made by the frontend.
   */
  getConfig = (_req: Request, res: Response): void => {
    const chains = this.chainService.getSupportedChains()

    res.json({
      defaultChain: this.chainService.getDefaultChainId(),
      supportedChains: chains.map((c) => ({
        id:      c.id,
        key:     c.key,
        name:    c.name,
        testnet: c.testnet,
      })),
    })
  }
}

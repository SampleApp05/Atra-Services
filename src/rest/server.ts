// MARK: - HTTP Server

import express from 'express'
import { Config } from '../config/index.js'
import { createRouter } from './router.js'
import type { SymbolCatalogService } from '../services/SymbolCatalogService.js'
import type { PriceService } from '../services/PriceService.js'

// MARK: - Factory

export function createServer(
  symbolCatalogService: SymbolCatalogService,
  priceService: PriceService
) {
  const app = express()

  app.use(express.json())

  // MARK: Routes

  app.use('/', createRouter(symbolCatalogService, priceService))

  // MARK: Start

  const port = Config.server.port

  const server = app.listen(port, () => {
    console.log(`[Server] Listening on http://localhost:${port}`)
  })

  return server
}

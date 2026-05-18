// MARK: - Application Entry Point

import { BinanceRestAdapter, BinanceWsAdapter } from './adapters/index.js'
import { InMemoryPriceCache } from './cache/index.js'
import { PriceService, SymbolCatalogService } from './services/index.js'
import { createServer } from './rest/index.js'

// MARK: - Bootstrap

async function bootstrap() {
  // Step 3 — Adapters
  const restAdapter = new BinanceRestAdapter()
  const wsAdapter = new BinanceWsAdapter()

  // Step 2 — Cache
  const priceCache = new InMemoryPriceCache()

  // Step 4 — Price Service
  const priceService = new PriceService(priceCache, restAdapter)

  // Step 5 — Symbol Catalog (load on startup)
  const symbolCatalogService = new SymbolCatalogService(restAdapter)
  await symbolCatalogService.initialize()

  // Step 7 — Connect WebSocket adapter (Steps 8/9 will attach handlers)
  wsAdapter.connect()

  // Step 6 — REST server
  createServer(symbolCatalogService, priceService)

  return { priceService, symbolCatalogService, wsAdapter }
}

bootstrap().catch(console.error)

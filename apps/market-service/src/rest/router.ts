// MARK: - REST Router

import { Router } from 'express'
import type { Request, Response } from 'express'
import type { SymbolCatalogService } from '../services/SymbolCatalogService.js'
import type { PriceService } from '../services/PriceService.js'

// MARK: - Factory

export function createRouter(
  symbolCatalogService: SymbolCatalogService,
  priceService: PriceService
): Router {
  const router = Router()

  // MARK: Search

  /**
   * GET /search?q=btc
   * Returns matching symbols from the in-memory catalog.
   */
  router.get('/search', (req: Request, res: Response) => {
    const query = req.query['q']

    if (typeof query !== 'string' || query.trim() === '') {
      res.status(400).json({ error: 'Missing or invalid query parameter: q' })
      return
    }

    const results = symbolCatalogService.search(query.trim())
    res.json(results)
  })

  // MARK: Prices

  /**
   * GET /prices?symbols=BTCUSDT,ETHUSDT
   * Returns each requested ticker with its cache freshness.
   */
  router.get('/prices', async (req: Request, res: Response) => {
    const raw = req.query['symbols']

    if (typeof raw !== 'string' || raw.trim() === '') {
      res.status(400).json({ error: 'Missing or invalid query parameter: symbols' })
      return
    }

    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0)

    if (symbols.length === 0) {
      res.status(400).json({ error: 'No valid symbols provided' })
      return
    }

    try {
      const results = await priceService.getTickers(symbols)
      res.json(results)
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch price data from upstream provider' })
    }
  })

  return router
}

// MARK: - REST Router Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createRouter } from '../../src/rest/router.js'
import type { SymbolCatalogService } from '../../src/services/SymbolCatalogService.js'
import type { PriceService } from '../../src/services/PriceService.js'
import type { MarketTicker, SymbolMeta } from '../../src/types/index.js'

// MARK: - Fixtures

const btcMeta: SymbolMeta = { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }
const ethMeta: SymbolMeta = { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' }

const btcTicker: MarketTicker = {
  symbol: 'BTCUSDT',
  price: 43125.12,
  changePercent24h: 2.5,
  high24h: 43500,
  low24h: 42000,
  volume24h: 123456789,
  ts: 1710000000,
}

// MARK: - Helpers

function makeApp(
  catalogMock: Partial<SymbolCatalogService>,
  priceMock: Partial<PriceService>
) {
  const app = express()
  app.use(express.json())
  app.use('/', createRouter(
    catalogMock as SymbolCatalogService,
    priceMock as PriceService
  ))
  return app
}

// MARK: - Tests

describe('REST Router', () => {
  let catalogService: Partial<SymbolCatalogService>
  let priceService: Partial<PriceService>

  beforeEach(() => {
    catalogService = { search: vi.fn().mockReturnValue([btcMeta, ethMeta]) }
    priceService = { getTickers: vi.fn().mockResolvedValue([btcTicker]) }
  })

  // MARK: GET /search

  describe('GET /search', () => {
    it('returns matching symbols for a valid query', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/search?q=btc')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([btcMeta, ethMeta])
      expect(catalogService.search).toHaveBeenCalledWith('btc')
    })

    it('returns 400 when the q parameter is missing', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/search')

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('returns 400 when the q parameter is an empty string', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/search?q=')

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('trims whitespace from the query before passing to the service', async () => {
      const app = makeApp(catalogService, priceService)
      await request(app).get('/search?q=%20btc%20')

      expect(catalogService.search).toHaveBeenCalledWith('btc')
    })
  })

  // MARK: GET /prices

  describe('GET /prices', () => {
    it('returns tickers for valid symbols', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/prices?symbols=BTCUSDT')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([btcTicker])
      expect(priceService.getTickers).toHaveBeenCalledWith(['BTCUSDT'])
    })

    it('splits comma-separated symbols and uppercases them', async () => {
      const app = makeApp(catalogService, priceService)
      await request(app).get('/prices?symbols=btcusdt,ethusdt')

      expect(priceService.getTickers).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'])
    })

    it('returns 400 when the symbols parameter is missing', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/prices')

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('returns 400 when the symbols parameter is an empty string', async () => {
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/prices?symbols=')

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('returns 502 when the price service throws', async () => {
      priceService.getTickers = vi.fn().mockRejectedValue(new Error('upstream error'))
      const app = makeApp(catalogService, priceService)
      const res = await request(app).get('/prices?symbols=BTCUSDT')

      expect(res.status).toBe(502)
      expect(res.body).toHaveProperty('error')
    })
  })
})

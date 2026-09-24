// MARK: - PriceService Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PriceService } from '../../src/services/PriceService.js'
import { InMemoryPriceCache } from '../../src/cache/InMemoryPriceCache.js'
import type { MarketTicker } from '../../src/types/index.js'
import type { BinanceRestAdapter } from '../../src/adapters/BinanceRestAdapter.js'

// MARK: - Helpers

function makeTicker(symbol: string): MarketTicker {
  return {
    symbol,
    price: 100,
    changePercent24h: 1.0,
    high24h: 110,
    low24h: 90,
    volume24h: 5000,
    ts: Date.now(),
  }
}

function makeAdapter(ticker: MarketTicker): BinanceRestAdapter {
  return {
    fetchTicker: vi.fn().mockResolvedValue(ticker),
    fetchExchangeInfo: vi.fn(),
  } as unknown as BinanceRestAdapter
}

// MARK: - Tests

describe('PriceService', () => {
  let cache: InMemoryPriceCache
  let adapter: BinanceRestAdapter
  let service: PriceService

  const SYMBOL = 'BTCUSDT'

  beforeEach(() => {
    cache = new InMemoryPriceCache()
    adapter = makeAdapter(makeTicker(SYMBOL))
    service = new PriceService(cache, adapter)
    vi.clearAllMocks()
  })

  // MARK: Case A — Fresh Cache Hit

  describe('getTicker — Case A (fresh cache hit)', () => {
    it('returns the cached ticker without calling the REST adapter', async () => {
      const ticker = makeTicker(SYMBOL)
      cache.set(SYMBOL, { ticker, updatedAt: Date.now() })

      const result = await service.getTicker(SYMBOL)

      expect(result).toEqual({ ticker, freshness: 'fresh' })
      expect(adapter.fetchTicker).not.toHaveBeenCalled()
    })

    it('is case-insensitive — lowercased input hits the same cache entry', async () => {
      const ticker = makeTicker(SYMBOL)
      cache.set(SYMBOL, { ticker, updatedAt: Date.now() })

      const result = await service.getTicker('btcusdt')

      expect(result).toEqual({ ticker, freshness: 'fresh' })
      expect(adapter.fetchTicker).not.toHaveBeenCalled()
    })
  })

  // MARK: Case B — Stale Cache Hit

  describe('getTicker — Case B (stale cache hit)', () => {
    it('returns stale data immediately without waiting for the refresh', async () => {
      const staleTicker = makeTicker(SYMBOL)
      // Place entry far in the past so it is definitely stale
      cache.set(SYMBOL, { ticker: staleTicker, updatedAt: 0 })

      const result = await service.getTicker(SYMBOL)

      expect(result).toEqual({ ticker: staleTicker, freshness: 'stale' })
    })

    it('triggers a background refresh when the entry is stale', async () => {
      const staleTicker = makeTicker(SYMBOL)
      cache.set(SYMBOL, { ticker: staleTicker, updatedAt: 0 })
      const freshTicker = makeTicker(SYMBOL)
      ;(adapter.fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue(freshTicker)

      await service.getTicker(SYMBOL)

      // Allow the microtask queue to drain so the background refresh runs
      await new Promise((r) => setTimeout(r, 0))

      expect(adapter.fetchTicker).toHaveBeenCalledOnce()
      expect(cache.get(SYMBOL)?.ticker).toEqual(freshTicker)
    })
  })

  // MARK: Case C — Cache Miss

  describe('getTicker — Case C (cache miss)', () => {
    it('fetches from Binance and stores the result in cache', async () => {
      const ticker = makeTicker(SYMBOL)
      ;(adapter.fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue(ticker)

      const result = await service.getTicker(SYMBOL)

      expect(result).toEqual({ ticker, freshness: 'fresh' })
      expect(adapter.fetchTicker).toHaveBeenCalledWith(SYMBOL)
      expect(cache.get(SYMBOL)?.ticker).toEqual(ticker)
    })

    it('rejects when upstream is unavailable instead of returning stale success', async () => {
      ;(adapter.fetchTicker as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('upstream error'))

      await expect(service.getTicker(SYMBOL)).rejects.toThrow('upstream error')
    })
  })

  // MARK: Deduplication

  describe('getTicker — deduplication', () => {
    it('issues only one Binance request for multiple concurrent calls on the same symbol', async () => {
      const ticker = makeTicker(SYMBOL)
      ;(adapter.fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue(ticker)

      const [r1, r2, r3] = await Promise.all([
        service.getTicker(SYMBOL),
        service.getTicker(SYMBOL),
        service.getTicker(SYMBOL),
      ])

      expect(adapter.fetchTicker).toHaveBeenCalledOnce()
      expect(r1).toEqual({ ticker, freshness: 'fresh' })
      expect(r2).toEqual({ ticker, freshness: 'fresh' })
      expect(r3).toEqual({ ticker, freshness: 'fresh' })
    })

    it('allows a new request after the first in-flight request resolves', async () => {
      const ticker = makeTicker(SYMBOL)
      ;(adapter.fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue(ticker)

      await service.getTicker(SYMBOL)
      // Remove from cache to force another miss
      cache.delete(SYMBOL)
      await service.getTicker(SYMBOL)

      expect(adapter.fetchTicker).toHaveBeenCalledTimes(2)
    })
  })

  // MARK: getTickers

  describe('getTickers', () => {
    it('returns tickers for all requested symbols', async () => {
      const btc = makeTicker('BTCUSDT')
      const eth = makeTicker('ETHUSDT')
      cache.set('BTCUSDT', { ticker: btc, updatedAt: Date.now() })
      cache.set('ETHUSDT', { ticker: eth, updatedAt: Date.now() })

      const results = await service.getTickers(['BTCUSDT', 'ETHUSDT'])

      expect(results).toHaveLength(2)
      expect(results).toEqual([
        { ticker: btc, freshness: 'fresh' },
        { ticker: eth, freshness: 'fresh' },
      ])
    })

    it('preserves freshness independently for mixed cache states', async () => {
      const btc = makeTicker('BTCUSDT')
      const eth = makeTicker('ETHUSDT')
      cache.set('BTCUSDT', { ticker: btc, updatedAt: Date.now() })
      cache.set('ETHUSDT', { ticker: eth, updatedAt: 0 })

      const results = await service.getTickers(['BTCUSDT', 'ETHUSDT'])

      expect(results).toEqual([
        { ticker: btc, freshness: 'fresh' },
        { ticker: eth, freshness: 'stale' },
      ])
    })

    it('returns an empty array for an empty input', async () => {
      const results = await service.getTickers([])
      expect(results).toHaveLength(0)
    })
  })
})

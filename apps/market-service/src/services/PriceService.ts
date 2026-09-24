// MARK: - Price Service

import type { MarketTicker } from '../types/index.js'
import type { PriceCache } from '../cache/PriceCache.js'
import type { BinanceRestAdapter } from '../adapters/BinanceRestAdapter.js'
import { Config } from '../config/index.js'

export type PriceResult = {
  ticker: MarketTicker
  freshness: 'fresh' | 'stale'
}

// MARK: - Service

export class PriceService {
  // MARK: Private State

  private cache: PriceCache
  private restAdapter: BinanceRestAdapter
  private inFlight = new Map<string, Promise<MarketTicker>>()
  private readonly ttlMs = Config.cache.priceTtlMs

  // MARK: Init

  constructor(cache: PriceCache, restAdapter: BinanceRestAdapter) {
    this.cache = cache
    this.restAdapter = restAdapter
  }

  // MARK: Public API

  /**
   * Retrieves one ticker with its cache freshness using stale-while-revalidate.
   *
   * Case A — Fresh cache hit  : return immediately
   * Case B — Stale cache hit  : return stale, refresh async
   * Case C — Cache miss       : fetch from Binance, cache, return
   */
  async getTicker(symbol: string): Promise<PriceResult> {
    const upperSymbol = symbol.toUpperCase()
    const entry = this.cache.get(upperSymbol)
    const now = Date.now()

    if (entry !== null) {
      const isStale = now - entry.updatedAt > this.ttlMs

      if (isStale === false) {
        // Case A — Fresh
        return { ticker: entry.ticker, freshness: 'fresh' }
      }

      // Case B — Stale: return immediately and refresh in background
      this.refreshAsync(upperSymbol)
      return { ticker: entry.ticker, freshness: 'stale' }
    }

    // Case C — Cache miss
    const ticker = await this.fetchAndCache(upperSymbol)
    return { ticker, freshness: 'fresh' }
  }

  /**
   * Retrieves freshness-aware results for multiple symbols concurrently.
   */
  async getTickers(symbols: string[]): Promise<PriceResult[]> {
    return Promise.all(symbols.map((s) => this.getTicker(s)))
  }

  // MARK: Private Helpers

  /**
   * Fetches a ticker from Binance, stores it in cache, and returns it.
   * Deduplicates concurrent requests for the same symbol.
   */
  private fetchAndCache(symbol: string): Promise<MarketTicker> {
    const existing = this.inFlight.get(symbol)
    if (existing !== undefined) {
      return existing
    }

    const promise = this.restAdapter
      .fetchTicker(symbol)
      .then((ticker) => {
        this.cache.set(symbol, { ticker, updatedAt: Date.now() })
        return ticker
      })
      .finally(() => {
        this.inFlight.delete(symbol)
      })

    this.inFlight.set(symbol, promise)
    return promise
  }

  /**
   * Triggers a background refresh without blocking the caller.
   * Errors are swallowed intentionally — stale data remains available.
   */
  private refreshAsync(symbol: string): void {
    this.fetchAndCache(symbol).catch(() => {
      // Background refresh failure is non-fatal; stale data stays in cache.
    })
  }
}

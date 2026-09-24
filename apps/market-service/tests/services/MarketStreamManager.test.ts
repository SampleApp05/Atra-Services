// MARK: - MarketStreamManager Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketStreamManager } from '../../src/services/MarketStreamManager.js'
import { InMemoryPriceCache } from '../../src/cache/InMemoryPriceCache.js'
import type { BinanceWsAdapter } from '../../src/adapters/BinanceWsAdapter.js'
import type { MarketTicker } from '../../src/types/index.js'

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

function makeWsAdapter(): BinanceWsAdapter {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onTicker: vi.fn(),
    connect: vi.fn(),
  } as unknown as BinanceWsAdapter
}

function makeManager() {
  const cache = new InMemoryPriceCache()
  const wsAdapter = makeWsAdapter()
  const manager = new MarketStreamManager(cache, wsAdapter)
  return { cache, wsAdapter, manager }
}

// MARK: - Tests

describe('MarketStreamManager', () => {
  // MARK: subscribe

  describe('subscribe', () => {
    it('subscribes Binance when a symbol is seen for the first time', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      expect(wsAdapter.subscribe).toHaveBeenCalledWith('BTCUSDT')
    })

    it('does NOT subscribe Binance again for a second subscriber on the same symbol', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-2', ['BTCUSDT'])
      expect(wsAdapter.subscribe).toHaveBeenCalledOnce()
    })

    it('does NOT duplicate-subscribe the same socket to the same symbol', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-1', ['BTCUSDT'])
      expect(wsAdapter.subscribe).toHaveBeenCalledOnce()
    })

    it('uppercases symbols before tracking', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['btcusdt'])
      expect(wsAdapter.subscribe).toHaveBeenCalledWith('BTCUSDT')
    })

    it('handles subscribing to multiple symbols at once', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT', 'ETHUSDT'])
      expect(wsAdapter.subscribe).toHaveBeenCalledTimes(2)
    })
  })

  // MARK: unsubscribe

  describe('unsubscribe', () => {
    it('does NOT unsubscribe Binance while other sockets still hold a reference', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-2', ['BTCUSDT'])
      manager.unsubscribe('socket-1', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).not.toHaveBeenCalled()

      manager.unsubscribe('socket-2', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).toHaveBeenCalledOnce()
      expect(wsAdapter.unsubscribe).toHaveBeenCalledWith('BTCUSDT')
    })

    it('unsubscribes Binance when the last socket unsubscribes', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-2', ['BTCUSDT'])
      manager.unsubscribe('socket-1', ['BTCUSDT'])
      manager.unsubscribe('socket-2', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).toHaveBeenCalledWith('BTCUSDT')
    })

    it('is a no-op for a symbol the socket was never subscribed to', () => {
      const { wsAdapter, manager } = makeManager()
      manager.unsubscribe('socket-1', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).not.toHaveBeenCalled()
    })

    it('does not release a symbol when a non-member socket unsubscribes', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])

      manager.unsubscribe('socket-2', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).not.toHaveBeenCalled()

      manager.unsubscribe('socket-1', ['BTCUSDT'])
      expect(wsAdapter.unsubscribe).toHaveBeenCalledOnce()
    })

    it('does not release upstream interest more than once after repeated removal', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])

      manager.unsubscribe('socket-1', ['BTCUSDT'])
      manager.unsubscribe('socket-1', ['BTCUSDT'])

      expect(wsAdapter.unsubscribe).toHaveBeenCalledOnce()
      expect(wsAdapter.unsubscribe).toHaveBeenCalledWith('BTCUSDT')
    })
  })

  // MARK: disconnect

  describe('disconnect', () => {
    it('unsubscribes all symbols held by the disconnecting socket', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT', 'ETHUSDT'])
      manager.disconnect('socket-1')
      expect(wsAdapter.unsubscribe).toHaveBeenCalledWith('BTCUSDT')
      expect(wsAdapter.unsubscribe).toHaveBeenCalledWith('ETHUSDT')
    })

    it('keeps Binance subscribed if another socket still references the symbol', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-2', ['BTCUSDT'])
      manager.disconnect('socket-1')
      expect(wsAdapter.unsubscribe).not.toHaveBeenCalled()
    })

    it('is a no-op for an unknown socket', () => {
      const { wsAdapter, manager } = makeManager()
      expect(() => manager.disconnect('ghost-socket')).not.toThrow()
      expect(wsAdapter.unsubscribe).not.toHaveBeenCalled()
    })
  })

  // MARK: incoming ticker — cache + broadcast

  describe('incoming ticker', () => {
    it('updates the cache when a ticker arrives', () => {
      const { cache, wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])

      // Capture the onTicker callback registered with the adapter
      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      const ticker = makeTicker('BTCUSDT')
      onTicker(ticker)

      expect(cache.get('BTCUSDT')?.ticker).toEqual(ticker)
    })

    it('normalizes the ticker symbol to uppercase when updating the cache', () => {
      const { cache, wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])

      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      // Simulate an adapter that emits a lowercase symbol (defensive)
      const ticker = makeTicker('btcusdt')
      onTicker(ticker)

      expect(cache.get('BTCUSDT')?.ticker).toEqual(ticker)
    })

    it('broadcasts to all subscribed sockets', () => {
      const { wsAdapter, manager } = makeManager()
      const broadcast = vi.fn()
      manager.onBroadcast(broadcast)

      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.subscribe('socket-2', ['BTCUSDT'])

      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      const ticker = makeTicker('BTCUSDT')
      onTicker(ticker)

      expect(broadcast).toHaveBeenCalledTimes(2)
      expect(broadcast).toHaveBeenCalledWith('socket-1', ticker)
      expect(broadcast).toHaveBeenCalledWith('socket-2', ticker)
    })

    it('does not broadcast to a socket that has unsubscribed', () => {
      const { wsAdapter, manager } = makeManager()
      const broadcast = vi.fn()
      manager.onBroadcast(broadcast)

      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.unsubscribe('socket-1', ['BTCUSDT'])

      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      onTicker(makeTicker('BTCUSDT'))

      expect(broadcast).not.toHaveBeenCalled()
    })

    it('does not broadcast to a disconnected socket', () => {
      const { wsAdapter, manager } = makeManager()
      const broadcast = vi.fn()
      manager.onBroadcast(broadcast)

      manager.subscribe('socket-1', ['BTCUSDT'])
      manager.disconnect('socket-1')

      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      onTicker(makeTicker('BTCUSDT'))

      expect(broadcast).not.toHaveBeenCalled()
    })

    it('does not broadcast when no broadcastCallback is registered', () => {
      const { wsAdapter, manager } = makeManager()
      manager.subscribe('socket-1', ['BTCUSDT'])

      const onTicker = vi.mocked(wsAdapter.onTicker).mock.calls[0]?.[0]!
      expect(() => onTicker(makeTicker('BTCUSDT'))).not.toThrow()
    })
  })
})

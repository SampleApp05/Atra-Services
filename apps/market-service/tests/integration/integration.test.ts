// MARK: - Integration Tests
// Tests the full stack end-to-end:
//   REST (search + prices) and WebSocket (subscribe → ticker broadcast)
// Uses real Express/ws servers on ephemeral ports with mocked Binance adapters.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import type { Server } from 'http'
import express from 'express'

import { InMemoryPriceCache } from '../../src/cache/InMemoryPriceCache.js'
import { PriceService } from '../../src/services/PriceService.js'
import { SymbolCatalogService } from '../../src/services/SymbolCatalogService.js'
import { MarketStreamManager } from '../../src/services/MarketStreamManager.js'
import { createRouter } from '../../src/rest/router.js'
import { WebSocketGateway } from '../../src/ws/WebSocketGateway.js'
import type { BinanceRestAdapter } from '../../src/adapters/BinanceRestAdapter.js'
import type { BinanceWsAdapter, WebSocketFactory } from '../../src/adapters/BinanceWsAdapter.js'
import type { MarketTicker, SymbolMeta } from '../../src/types/index.js'
import { BinanceWsAdapter as RealBinanceWsAdapter } from '../../src/adapters/BinanceWsAdapter.js'
import { EventEmitter } from 'events'

// MARK: - Fixtures

const symbols: SymbolMeta[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
]

const btcTicker: MarketTicker = {
  symbol: 'BTCUSDT',
  price: 43125.12,
  changePercent24h: 2.5,
  high24h: 43500,
  low24h: 42000,
  volume24h: 123456789,
  ts: 1710000000,
}

// MARK: - Mock Binance REST Adapter

function makeMockRestAdapter(): BinanceRestAdapter {
  return {
    fetchExchangeInfo: vi.fn().mockResolvedValue(symbols),
    fetchTicker: vi.fn().mockResolvedValue(btcTicker),
  } as unknown as BinanceRestAdapter
}

// MARK: - Mock Binance WS Adapter (controllable mock socket)

class MockWsSocket extends EventEmitter {
  readyState = 1
  send = vi.fn()
  simulateMessage(data: object) {
    this.emit('message', Buffer.from(JSON.stringify(data)))
  }
}

function makeMockWsAdapter(): { adapter: BinanceWsAdapter; socket: MockWsSocket } {
  const socket = new MockWsSocket()
  const factory: WebSocketFactory = () => socket as any
  const adapter = new RealBinanceWsAdapter(factory)
  return { adapter, socket }
}

// MARK: - Test Server Builder

async function buildServer() {
  const restAdapter = makeMockRestAdapter()
  const { adapter: wsAdapter, socket: wsSocket } = makeMockWsAdapter()

  const cache = new InMemoryPriceCache()
  const priceService = new PriceService(cache, restAdapter)
  const catalogService = new SymbolCatalogService(restAdapter)
  await catalogService.initialize()

  const streamManager = new MarketStreamManager(cache, wsAdapter)

  const app = express()
  app.use(express.json())
  app.use('/', createRouter(catalogService, priceService))

  const httpServer: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })

  new WebSocketGateway(httpServer, streamManager)
  wsAdapter.connect()
  wsSocket.emit('open')

  const port = (httpServer.address() as { port: number }).port

  return { httpServer, app, wsSocket, streamManager, port }
}

// MARK: - Tests

describe('Integration', () => {
  let httpServer: Server
  let app: ReturnType<typeof express>
  let wsSocket: MockWsSocket
  let port: number

  beforeEach(async () => {
    const result = await buildServer()
    httpServer = result.httpServer
    app = result.app
    wsSocket = result.wsSocket
    port = result.port
  })

  afterEach(() => {
    httpServer.close()
  })

  // MARK: REST — /search

  describe('GET /search', () => {
    it('returns symbols matching the query', async () => {
      const res = await request(app).get('/search?q=btc')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }])
    })

    it('returns 400 for missing q param', async () => {
      const res = await request(app).get('/search')
      expect(res.status).toBe(400)
    })

    it('returns empty array for a query with no matches', async () => {
      const res = await request(app).get('/search?q=ZZZNOMATCH')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })
  })

  // MARK: REST — /prices

  describe('GET /prices', () => {
    it('returns freshness-aware ticker data for a valid symbol', async () => {
      const res = await request(app).get('/prices?symbols=BTCUSDT')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([{ ticker: btcTicker, freshness: 'fresh' }])
    })

    it('returns 400 for missing symbols param', async () => {
      const res = await request(app).get('/prices')
      expect(res.status).toBe(400)
    })
  })

  // MARK: WebSocket — subscribe → ticker broadcast

  describe('WebSocket subscribe and receive ticker', () => {
    it('delivers a ticker message to a subscribed client', async () => {
      const received = await new Promise<object>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`)

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe', symbols: ['BTCUSDT'] }))

          // Simulate Binance pushing a ticker after subscription
          setTimeout(() => {
            wsSocket.simulateMessage({
              s: 'BTCUSDT',
              c: '43125.12',
              P: '2.5',
              h: '43500',
              l: '42000',
              q: '123456789',
              E: 1710000000,
            })
          }, 20)
        })

        ws.on('message', (data) => {
          ws.close()
          resolve(JSON.parse(data.toString()))
        })
      })

      expect(received).toMatchObject({
        type: 'ticker',
        data: { symbol: 'BTCUSDT', price: 43125.12 },
      })
    })

    it('does not deliver tickers for symbols a client has unsubscribed from', async () => {
      const messages: object[] = []

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`)

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe', symbols: ['BTCUSDT'] }))
          ws.send(JSON.stringify({ type: 'unsubscribe', symbols: ['BTCUSDT'] }))

          setTimeout(() => {
            wsSocket.simulateMessage({
              s: 'BTCUSDT',
              c: '43125.12',
              P: '2.5',
              h: '43500',
              l: '42000',
              q: '123456789',
              E: 1710000000,
            })
            setTimeout(() => {
              ws.close()
              resolve()
            }, 20)
          }, 20)
        })

        ws.on('message', (data) => {
          messages.push(JSON.parse(data.toString()))
        })
      })

      expect(messages).toHaveLength(0)
    })

    it('stops broadcasting after a client disconnects', async () => {
      const secondClientMessages: object[] = []

      await new Promise<void>((resolve) => {
        const ws1 = new WebSocket(`ws://localhost:${port}`)

        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'subscribe', symbols: ['BTCUSDT'] }))
          // Disconnect immediately
          setTimeout(() => ws1.close(), 10)
        })

        ws1.on('close', () => {
          // Push a ticker after the first client is gone — second client should not receive it
          wsSocket.simulateMessage({
            s: 'BTCUSDT',
            c: '43125.12',
            P: '2.5',
            h: '43500',
            l: '42000',
            q: '123456789',
            E: 1710000000,
          })
          setTimeout(resolve, 30)
        })
      })

      expect(secondClientMessages).toHaveLength(0)
    })
  })
})

// MARK: - BinanceWsAdapter Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { BinanceWsAdapter } from '../../src/adapters/BinanceWsAdapter.js'
import type { WebSocketFactory } from '../../src/adapters/BinanceWsAdapter.js'
import type { MarketTicker } from '../../src/types/index.js'
import type WebSocket from 'ws'

// MARK: - Mock Socket

// Mimics the ws.WebSocket event interface used by the adapter
class MockSocket extends EventEmitter {
  readonly readyState: number
  send = vi.fn()
  close = vi.fn()

  constructor(open = false) {
    super()
    this.readyState = open ? 1 : 0  // 1 = OPEN, 0 = CONNECTING
  }

  simulateOpen() {
    (this as { readyState: number }).readyState = 1
    this.emit('open')
  }

  simulateMessage(data: object) {
    this.emit('message', Buffer.from(JSON.stringify(data)))
  }

  simulateClose() {
    (this as { readyState: number }).readyState = 0
    this.emit('close')
  }

  simulateError(err: Error) {
    this.emit('error', err)
  }
}

// MARK: - Fixtures

const rawTicker = {
  s: 'BTCUSDT',
  c: '43125.12',
  P: '2.5',
  h: '43500',
  l: '42000',
  q: '123456789',
  E: 1710000000,
}

const normalizedTicker: MarketTicker = {
  symbol: 'BTCUSDT',
  price: 43125.12,
  changePercent24h: 2.5,
  high24h: 43500,
  low24h: 42000,
  volume24h: 123456789,
  ts: 1710000000,
}

// MARK: - Helpers

function makeAdapterWithSocket(): { adapter: BinanceWsAdapter; socket: MockSocket } {
  const socket = new MockSocket()
  const factory: WebSocketFactory = () => socket as unknown as WebSocket
  const adapter = new BinanceWsAdapter(factory)
  adapter.connect()
  return { adapter, socket }
}

// MARK: - Tests

describe('BinanceWsAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // MARK: subscribe

  describe('subscribe', () => {
    it('sends a SUBSCRIBE command once the socket is open', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      socket.simulateOpen()
      adapter.subscribe('BTCUSDT')

      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@ticker'], id: 1 })
      )
    })

    it('uppercases the symbol before sending', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      socket.simulateOpen()
      adapter.subscribe('btcusdt')

      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining('btcusdt@ticker')
      )
    })

    it('does not send if the socket is not yet open', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      // socket remains in CONNECTING state — never call simulateOpen
      adapter.subscribe('BTCUSDT')

      expect(socket.send).not.toHaveBeenCalled()
    })
  })

  // MARK: unsubscribe

  describe('unsubscribe', () => {
    it('sends an UNSUBSCRIBE command when the socket is open', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      socket.simulateOpen()
      adapter.subscribe('BTCUSDT')
      vi.clearAllMocks()

      adapter.unsubscribe('BTCUSDT')

      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining('UNSUBSCRIBE')
      )
    })
  })

  // MARK: onTicker — normalization

  describe('onTicker', () => {
    it('calls the callback with a normalized MarketTicker on incoming ticker message', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      const callback = vi.fn()
      adapter.onTicker(callback)
      socket.simulateOpen()
      socket.simulateMessage(rawTicker)

      expect(callback).toHaveBeenCalledWith(normalizedTicker)
    })

    it('does not call the callback for subscription acknowledgement messages', () => {
      const { adapter, socket } = makeAdapterWithSocket()
      const callback = vi.fn()
      adapter.onTicker(callback)
      socket.simulateOpen()
      socket.simulateMessage({ id: 1, result: null })

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not throw when no callback is registered', () => {
      const { socket } = makeAdapterWithSocket()
      socket.simulateOpen()
      expect(() => socket.simulateMessage(rawTicker)).not.toThrow()
    })
  })

  // MARK: reconnect

  describe('reconnect', () => {
    it('schedules a reconnect when the connection closes', () => {
      vi.useFakeTimers()

      let connectCount = 0
      const sockets: MockSocket[] = []
      const factory: WebSocketFactory = () => {
        connectCount++
        const s = new MockSocket()
        sockets.push(s)
        return s as unknown as WebSocket
      }
      const adapter = new BinanceWsAdapter(factory)
      adapter.connect()

      sockets[0]!.simulateOpen()
      sockets[0]!.simulateClose()

      vi.advanceTimersByTime(3500)

      expect(connectCount).toBe(2)

      vi.useRealTimers()
    })

    it('re-subscribes all active symbols after reconnect', () => {
      vi.useFakeTimers()

      const sockets: MockSocket[] = []
      const factory: WebSocketFactory = () => {
        const s = new MockSocket()
        sockets.push(s)
        return s as unknown as WebSocket
      }
      const adapter = new BinanceWsAdapter(factory)
      adapter.connect()

      sockets[0]!.simulateOpen()
      adapter.subscribe('BTCUSDT')
      adapter.subscribe('ETHUSDT')
      sockets[0]!.simulateClose()

      vi.advanceTimersByTime(3500)
      sockets[1]!.simulateOpen()

      const calls = sockets[1]!.send.mock.calls.map((c) => JSON.parse(c[0] as string))
      const resubCall = calls.find(
        (c) => c.method === 'SUBSCRIBE' && (c.params as string[]).length === 2
      )
      expect(resubCall).toBeDefined()

      vi.useRealTimers()
    })
  })
})


// MARK: - Binance WebSocket Adapter
// Transport-only layer. No business logic, no client tracking, no cache.

import WebSocket from 'ws'
import { Config } from '../config/index.js'
import { buildTickerStream } from './BinanceEndpoints.js'
import type { MarketTicker } from '../types/index.js'

// MARK: - Raw Binance WS Ticker Shape

interface BinanceWsTicker {
  s: string   // symbol
  c: string   // last price
  P: string   // price change percent
  h: string   // high price
  l: string   // low price
  q: string   // quote asset volume
  E: number   // event time
}

// MARK: - Normalization

function normalizeWsTicker(raw: BinanceWsTicker): MarketTicker {
  return {
    symbol: raw.s,
    price: parseFloat(raw.c),
    changePercent24h: parseFloat(raw.P),
    high24h: parseFloat(raw.h),
    low24h: parseFloat(raw.l),
    volume24h: parseFloat(raw.q),
    ts: raw.E,
  }
}

// MARK: - Types

type TickerCallback = (ticker: MarketTicker) => void
export type WebSocketFactory = (url: string) => WebSocket

// MARK: - Adapter

export class BinanceWsAdapter {
  // MARK: Private State

  private ws: WebSocket | null = null
  private activeSymbols = new Set<string>()
  private tickerCallback: TickerCallback | null = null
  private requestId = 1
  private reconnecting = false
  private readonly wsFactory: WebSocketFactory

  // MARK: Init

  constructor(wsFactory: WebSocketFactory = (url) => new WebSocket(url)) {
    this.wsFactory = wsFactory
  }

  // MARK: Public API

  connect(): void {
    this._connect()
  }

  subscribe(symbol: string): void {
    const upper = symbol.toUpperCase()
    this.activeSymbols.add(upper)

    if (this._isReady()) {
      this._sendSubscribe([upper])
    }
  }

  unsubscribe(symbol: string): void {
    const upper = symbol.toUpperCase()
    this.activeSymbols.delete(upper)

    if (this._isReady()) {
      this._sendUnsubscribe([upper])
    }
  }

  onTicker(callback: TickerCallback): void {
    this.tickerCallback = callback
  }

  // MARK: Private — Connection

  private _connect(): void {
    const url = Config.binance.wsBaseUrl
    this.ws = this.wsFactory(url)

    this.ws.on('open', () => {
      console.log('[BinanceWsAdapter] Connected.')
      this.reconnecting = false
      this._resubscribeAll()
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      this._handleMessage(data.toString())
    })

    this.ws.on('close', () => {
      console.warn('[BinanceWsAdapter] Connection closed. Reconnecting...')
      this._scheduleReconnect()
    })

    this.ws.on('error', (err: Error) => {
      console.error('[BinanceWsAdapter] WebSocket error:', err.message)
      // close event will fire after error, triggering reconnect
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnecting === true) {
      return
    }
    this.reconnecting = true

    setTimeout(() => {
      console.log('[BinanceWsAdapter] Attempting reconnect...')
      this._connect()
    }, 3000)
  }

  // MARK: Private — Subscriptions

  private _resubscribeAll(): void {
    if (this.activeSymbols.size === 0) {
      return
    }
    this._sendSubscribe(Array.from(this.activeSymbols))
  }

  private _sendSubscribe(symbols: string[]): void {
    const params = symbols.map((s) => buildTickerStream(s))
    this._send({ method: 'SUBSCRIBE', params, id: this.requestId++ })
  }

  private _sendUnsubscribe(symbols: string[]): void {
    const params = symbols.map((s) => buildTickerStream(s))
    this._send({ method: 'UNSUBSCRIBE', params, id: this.requestId++ })
  }

  private _send(payload: object): void {
    if (this._isReady() === false) {
      console.warn('[BinanceWsAdapter] Attempted to send while socket is not open.')
      return
    }
    this.ws!.send(JSON.stringify(payload))
  }

  // MARK: Private — Message Handling

  private _handleMessage(raw: string): void {
    let parsed: unknown

    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[BinanceWsAdapter] Failed to parse message:', raw)
      return
    }

    // Subscription acknowledgement messages have an "id" field — skip them
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      'id' in (parsed as object)
    ) {
      return
    }

    const ticker = normalizeWsTicker(parsed as BinanceWsTicker)

    if (this.tickerCallback !== null) {
      this.tickerCallback(ticker)
    }
  }

  // MARK: Private — Helpers

  private _isReady(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}


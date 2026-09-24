// MARK: - Market Stream Manager
// Core real-time orchestration engine.
// Coordinates client subscriptions, Binance subscriptions, cache updates, and fan-out.

import type { PriceCache } from '../cache/PriceCache.js'
import type { BinanceWsAdapter } from '../adapters/BinanceWsAdapter.js'
import type { MarketTicker } from '../types/index.js'

// MARK: - Types

type SocketId = string
type BroadcastCallback = (socketId: SocketId, ticker: MarketTicker) => void

interface SymbolEntry {
  subscribers: Set<SocketId>
  refCount: number
}

// MARK: - Service

export class MarketStreamManager {
  // MARK: Private State

  // Symbol Registry: symbol → { subscribers, refCount }
  private symbolRegistry = new Map<string, SymbolEntry>()

  // Connection Registry: socketId → Set<symbol>
  private connectionRegistry = new Map<SocketId, Set<string>>()

  private cache: PriceCache
  private wsAdapter: BinanceWsAdapter
  private broadcastCallback: BroadcastCallback | null = null

  // MARK: Init

  constructor(cache: PriceCache, wsAdapter: BinanceWsAdapter) {
    this.cache = cache
    this.wsAdapter = wsAdapter

    this.wsAdapter.onTicker((ticker) => {
      this._handleIncomingTicker(ticker)
    })
  }

  // MARK: Public API

  /**
   * Register the function the Gateway will use to push tickers to a specific socket.
   */
  onBroadcast(callback: BroadcastCallback): void {
    this.broadcastCallback = callback
  }

  /**
   * Subscribe a socket to one or more symbols.
   */
  subscribe(socketId: SocketId, symbols: string[]): void {
    for (const raw of symbols) {
      const symbol = raw.toUpperCase()
      this._subscribeOne(socketId, symbol)
    }
  }

  /**
   * Unsubscribe a socket from one or more symbols.
   */
  unsubscribe(socketId: SocketId, symbols: string[]): void {
    for (const raw of symbols) {
      const symbol = raw.toUpperCase()
      this._unsubscribeOne(socketId, symbol)
    }
  }

  /**
   * Clean up all subscriptions for a disconnected socket.
   */
  disconnect(socketId: SocketId): void {
    const symbols = this.connectionRegistry.get(socketId)

    if (symbols === undefined) {
      return
    }

    for (const symbol of symbols) {
      this._removeSocketFromSymbol(socketId, symbol)
    }

    this.connectionRegistry.delete(socketId)
  }

  // MARK: Private — Subscribe Flow

  private _subscribeOne(socketId: SocketId, symbol: string): void {
    // Step 1 — Prevent duplicate subscriptions for the same socket+symbol pair
    const existing = this.symbolRegistry.get(symbol)

    if (existing !== undefined && existing.subscribers.has(socketId)) {
      return
    }

    // Step 2 — If this is a new symbol, subscribe Binance
    if (existing === undefined) {
      this.symbolRegistry.set(symbol, { subscribers: new Set(), refCount: 0 })
      this.wsAdapter.subscribe(symbol)
    }

    const entry = this.symbolRegistry.get(symbol)!

    // Step 3 — Add socket to subscriber set
    entry.subscribers.add(socketId)

    // Step 4 — Increment refCount
    entry.refCount++

    // Update connection registry
    if (this.connectionRegistry.has(socketId) === false) {
      this.connectionRegistry.set(socketId, new Set())
    }
    this.connectionRegistry.get(socketId)!.add(symbol)
  }

  // MARK: Private — Unsubscribe Flow

  private _unsubscribeOne(socketId: SocketId, symbol: string): void {
    const removed = this._removeSocketFromSymbol(socketId, symbol)

    if (removed === false) {
      return
    }

    // Clean up connection registry entry for this symbol
    const socketSymbols = this.connectionRegistry.get(socketId)
    if (socketSymbols !== undefined) {
      socketSymbols.delete(symbol)
      if (socketSymbols.size === 0) {
        this.connectionRegistry.delete(socketId)
      }
    }
  }

  private _removeSocketFromSymbol(socketId: SocketId, symbol: string): boolean {
    const entry = this.symbolRegistry.get(symbol)

    if (entry === undefined) {
      return false
    }

    // A removal changes reference state only when this socket actually holds it.
    if (entry.subscribers.has(socketId) === false) {
      return false
    }

    // Step 1 — Remove socket from subscriber set
    entry.subscribers.delete(socketId)

    // Step 2 — Decrement refCount
    entry.refCount--

    // Step 3 — If no more subscribers, unsubscribe from Binance and clean up
    if (entry.refCount === 0) {
      this.wsAdapter.unsubscribe(symbol)
      this.symbolRegistry.delete(symbol)
    }

    return true
  }

  // MARK: Private — Incoming Ticker Flow

  private _handleIncomingTicker(ticker: MarketTicker): void {
    const symbol = ticker.symbol.toUpperCase()

    // Step 1 — Update cache
    this.cache.set(symbol, { ticker, updatedAt: Date.now() })

    // Step 2 — Find subscribed sockets
    const entry = this.symbolRegistry.get(symbol)

    if (entry === undefined || entry.subscribers.size === 0) {
      return
    }

    // Step 3 — Broadcast to all subscribed sockets
    if (this.broadcastCallback === null) {
      return
    }

    for (const socketId of entry.subscribers) {
      this.broadcastCallback(socketId, ticker)
    }
  }
}

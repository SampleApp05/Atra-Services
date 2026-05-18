# Atra-DataProvider

Real-time market data aggregation service for the ATRA platform.  
Aggregates Binance market data and exposes it to clients via a REST API and a WebSocket feed.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [REST API](#rest-api)
  - [GET /search](#get-search)
  - [GET /prices](#get-prices)
- [WebSocket API](#websocket-api)
  - [Connecting](#connecting)
  - [Subscribe](#subscribe)
  - [Unsubscribe](#unsubscribe)
  - [Receiving Updates](#receiving-updates)
  - [Full Client Example](#full-client-example)
- [Data Types](#data-types)
- [Running Tests](#running-tests)

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in your values
cp .env.example .env

# 3. Build
npm run build

# 4. Start
npm start
```

The server will start on the port defined by `PORT` in your `.env` (default `3000`).

---

## Environment Variables

Copy `.env.example` to `.env` before running.

| Variable             | Required | Default                              | Description                              |
|----------------------|----------|--------------------------------------|------------------------------------------|
| `BINANCE_BASE_URL`   | ✅       | `https://api.binance.com`            | Binance REST API base URL                |
| `BINANCE_WS_BASE_URL`| ✅       | `wss://stream.binance.com:9443/ws`   | Binance WebSocket stream URL             |
| `PRICE_TTL_MS`       | ❌       | `30000`                              | Price cache TTL in milliseconds          |
| `PORT`               | ❌       | `3000`                               | HTTP server port                         |

---

## REST API

Base URL: `http://localhost:3000`

All responses are JSON. Error responses follow the shape:

```json
{ "error": "Human-readable error message" }
```

---

### GET /search

Search for tradable symbols by name, base asset, or quote asset.

**Query Parameters**

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| `q`       | string | ✅       | Case-insensitive substring to match |

**Example Request**

```
GET /search?q=btc
```

**Example Response** `200 OK`

```json
[
  {
    "symbol": "BTCUSDT",
    "baseAsset": "BTC",
    "quoteAsset": "USDT"
  },
  {
    "symbol": "BTCEUR",
    "baseAsset": "BTC",
    "quoteAsset": "EUR"
  }
]
```

**Error Responses**

| Status | Condition                         |
|--------|-----------------------------------|
| `400`  | `q` parameter is missing or empty |

---

### GET /prices

Fetch current 24-hour ticker data for one or more symbols.

**Query Parameters**

| Parameter | Type   | Required | Description                                          |
|-----------|--------|----------|------------------------------------------------------|
| `symbols` | string | ✅       | Comma-separated list of symbols (case-insensitive)   |

**Example Request**

```
GET /prices?symbols=BTCUSDT,ETHUSDT
```

**Example Response** `200 OK`

```json
[
  {
    "symbol": "BTCUSDT",
    "price": 43125.12,
    "changePercent24h": 2.5,
    "high24h": 43500.00,
    "low24h": 42000.00,
    "volume24h": 123456789.00,
    "ts": 1710000000
  },
  {
    "symbol": "ETHUSDT",
    "price": 2250.50,
    "changePercent24h": -1.2,
    "high24h": 2300.00,
    "low24h": 2200.00,
    "volume24h": 98765432.00,
    "ts": 1710000000
  }
]
```

**Error Responses**

| Status | Condition                                  |
|--------|--------------------------------------------|
| `400`  | `symbols` parameter is missing or empty    |
| `502`  | Upstream Binance request failed            |

**Pseudo-code (iOS / Swift)**

```swift
let url = URL(string: "http://localhost:3000/prices?symbols=BTCUSDT,ETHUSDT")!
let (data, _) = try await URLSession.shared.data(from: url)
let tickers = try JSONDecoder().decode([MarketTicker].self, from: data)
```

---

## WebSocket API

The WebSocket server runs on the same port as the REST API.

```
ws://localhost:3000
```

All messages are JSON-encoded text frames.

---

### Connecting

```swift
// Swift pseudo-code
let socket = URLSessionWebSocketTask(url: URL(string: "ws://localhost:3000")!)
socket.resume()
```

---

### Subscribe

Send this message to begin receiving real-time price updates for one or more symbols.

**Client → Server**

```json
{
  "type": "subscribe",
  "symbols": ["BTCUSDT", "ADAUSDT"]
}
```

| Field     | Type       | Description                              |
|-----------|------------|------------------------------------------|
| `type`    | `string`   | Must be `"subscribe"`                    |
| `symbols` | `string[]` | List of symbols to subscribe to          |

---

### Unsubscribe

Send this message to stop receiving updates for specific symbols.

**Client → Server**

```json
{
  "type": "unsubscribe",
  "symbols": ["ADAUSDT"]
}
```

| Field     | Type       | Description                              |
|-----------|------------|------------------------------------------|
| `type`    | `string`   | Must be `"unsubscribe"`                  |
| `symbols` | `string[]` | List of symbols to unsubscribe from      |

---

### Receiving Updates

The server pushes a `ticker` message whenever a subscribed symbol's price changes.

**Server → Client**

```json
{
  "type": "ticker",
  "data": {
    "symbol": "BTCUSDT",
    "price": 43125.12,
    "changePercent24h": 2.5,
    "high24h": 43500.00,
    "low24h": 42000.00,
    "volume24h": 123456789.00,
    "ts": 1710000000
  }
}
```

| Field                    | Type     | Description                                 |
|--------------------------|----------|---------------------------------------------|
| `type`                   | `string` | Always `"ticker"`                           |
| `data.symbol`            | `string` | Trading pair symbol e.g. `"BTCUSDT"`        |
| `data.price`             | `number` | Last trade price                            |
| `data.changePercent24h`  | `number` | 24-hour price change percentage             |
| `data.high24h`           | `number` | 24-hour high price                          |
| `data.low24h`            | `number` | 24-hour low price                           |
| `data.volume24h`         | `number` | 24-hour quote asset volume                  |
| `data.ts`                | `number` | Event timestamp (Unix ms)                   |

---

### Full Client Example

**Swift pseudo-code**

```swift
// 1. Connect
let socket = URLSessionWebSocketTask(url: URL(string: "ws://localhost:3000")!)
socket.resume()

// 2. Subscribe to symbols
let subscribeMsg = """
  { "type": "subscribe", "symbols": ["BTCUSDT", "ETHUSDT"] }
"""
socket.send(.string(subscribeMsg)) { error in
    if let error { print("Send error:", error) }
}

// 3. Listen for ticker updates
func receiveNext() {
    socket.receive { result in
        switch result {
        case .success(.string(let text)):
            let data = Data(text.utf8)
            let msg = try? JSONDecoder().decode(SocketMessage.self, from: data)
            if msg?.type == "ticker" {
                updateUI(with: msg?.data)
            }
        default:
            break
        }
        receiveNext() // keep listening
    }
}
receiveNext()

// 4. Unsubscribe when done
let unsubscribeMsg = """
  { "type": "unsubscribe", "symbols": ["ETHUSDT"] }
"""
socket.send(.string(unsubscribeMsg))

// 5. Disconnect
socket.cancel(with: .goingAway, reason: nil)
```

---

## Data Types

### MarketTicker

```typescript
type MarketTicker = {
  symbol: string          // e.g. "BTCUSDT"
  price: number           // last trade price
  changePercent24h: number // 24h price change %
  high24h: number         // 24h high
  low24h: number          // 24h low
  volume24h: number       // 24h quote volume
  ts: number              // event timestamp (Unix ms)
}
```

### SymbolMeta

```typescript
type SymbolMeta = {
  symbol: string      // e.g. "BTCUSDT"
  baseAsset: string   // e.g. "BTC"
  quoteAsset: string  // e.g. "USDT"
}
```

---

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# With coverage report
npm run test:coverage
```

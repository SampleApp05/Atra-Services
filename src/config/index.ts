// MARK: - Environment Configuration

import 'dotenv/config'

// MARK: - Helpers

function requireEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value === undefined || value === '') {
    return defaultValue
  }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: "${value}"`)
  }
  return parsed
}

// MARK: - Exported Config

export const Config = {
  binance: {
    baseUrl: requireEnv('BINANCE_BASE_URL'),
    wsBaseUrl: requireEnv('BINANCE_WS_BASE_URL'),
  },
  cache: {
    priceTtlMs: parseEnvInt('PRICE_TTL_MS', 30_000),
  },
  server: {
    port: parseEnvInt('PORT', 3000),
  },
} as const

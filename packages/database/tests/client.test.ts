// MARK: - createDb tests

import { describe, it, expect, vi, beforeEach } from 'vitest'

// MARK: - Mocks

vi.mock('postgres', () => ({
  default: vi.fn().mockReturnValue({
    // minimal postgres.js sql tag mock — drizzle only calls it lazily
  }),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn().mockReturnValue({
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    execute: vi.fn(),
    query:   {},
  }),
}))

// MARK: - Tests

describe('createDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a db object with a select method', async () => {
    const { createDb } = await import('../src/client.js')
    const db = createDb('postgres://localhost/test')
    expect(typeof db.select).toBe('function')
  })

  it('returns a db object with an insert method', async () => {
    const { createDb } = await import('../src/client.js')
    const db = createDb('postgres://localhost/test')
    expect(typeof db.insert).toBe('function')
  })

  it('passes the connection string to postgres', async () => {
    const postgres = (await import('postgres')).default
    const { createDb } = await import('../src/client.js')

    const connectionString = 'postgres://user:pass@localhost:5432/atra'
    createDb(connectionString)

    expect(postgres).toHaveBeenCalledWith(connectionString)
  })

  it('calls drizzle with the postgres client', async () => {
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const { createDb } = await import('../src/client.js')

    createDb('postgres://localhost/test')

    expect(drizzle).toHaveBeenCalledOnce()
  })
})

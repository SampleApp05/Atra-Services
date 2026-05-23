// MARK: - Database Client

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

// MARK: - Types

export type Db = PostgresJsDatabase<typeof schema>

// MARK: - Factory

/**
 * Creates and returns a Drizzle database instance.
 * The caller is responsible for providing the connection string.
 * This keeps the package environment-agnostic.
 */
export function createDb(connectionString: string): Db {
  const client = postgres(connectionString)
  return drizzle(client, { schema })
}

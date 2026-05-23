// MARK: - Database Connection

import 'dotenv/config'
import { createDb } from '@atra/database'

// MARK: - Validate Connection String

const connectionString = process.env['DATABASE_URL']

if (connectionString === undefined || connectionString === '') {
  throw new Error('Missing required environment variable: DATABASE_URL')
}

// MARK: - Singleton

export const db = createDb(connectionString)

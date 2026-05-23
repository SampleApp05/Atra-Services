// MARK: - sessions schema

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { accounts } from './accounts.js'

// MARK: Table

export const sessions = pgTable('sessions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  accountId:        uuid('account_id').notNull().references(() => accounts.id),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  deviceName:       text('device_name').notNull(),
  deviceType:       text('device_type').notNull(),
  lastIp:           text('last_ip').notNull(),
  expiresAt:        timestamp('expires_at').notNull(),
  revokedAt:        timestamp('revoked_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
})

// MARK: Types

export type Session    = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

// MARK: - audit_logs schema

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { accounts } from './accounts.js'
import { wallets } from './wallets.js'

// MARK: Table

export const auditLogs = pgTable('audit_logs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  accountId:     uuid('account_id').notNull().references(() => accounts.id),
  actorWalletId: uuid('actor_wallet_id').notNull().references(() => wallets.id),
  action:        text('action').notNull(),
  metadata:      jsonb('metadata').notNull().default({}),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
})

// MARK: Types

export type AuditLog    = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert

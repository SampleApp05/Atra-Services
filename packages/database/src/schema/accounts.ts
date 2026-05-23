// MARK: - accounts schema

import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core'

// MARK: Table

export const accounts = pgTable('accounts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  ownerWalletId:    uuid('owner_wallet_id').notNull(),
  recoveryWalletId: uuid('recovery_wallet_id'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
})

// MARK: Types

export type Account        = typeof accounts.$inferSelect
export type NewAccount     = typeof accounts.$inferInsert

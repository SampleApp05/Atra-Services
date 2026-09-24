// MARK: - accounts schema

import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core'
import { wallets } from './wallets.js'

// MARK: Table

export const accounts = pgTable('accounts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  ownerWalletId:    uuid('owner_wallet_id').notNull().references(() => wallets.id),
  recoveryWalletId: uuid('recovery_wallet_id').references(() => wallets.id),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
})

// MARK: Types

export type Account        = typeof accounts.$inferSelect
export type NewAccount     = typeof accounts.$inferInsert

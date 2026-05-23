// MARK: - wallets schema

import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'

// MARK: Table

export const wallets = pgTable('wallets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  address:   text('address').notNull().unique(),
  chainId:   integer('chain_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// MARK: Types

export type Wallet    = typeof wallets.$inferSelect
export type NewWallet = typeof wallets.$inferInsert

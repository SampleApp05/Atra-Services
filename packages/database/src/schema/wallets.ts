// MARK: - wallets schema

import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// MARK: Table
// address is NOT globally unique — the same address may exist on multiple chains.
// Uniqueness is enforced on (address, chain_id) together.

export const wallets = pgTable('wallets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  address:   text('address').notNull(),
  chainId:   integer('chain_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  addressChainIdx: uniqueIndex('wallets_address_chain_idx').on(table.address, table.chainId),
}))

// MARK: Types

export type Wallet    = typeof wallets.$inferSelect
export type NewWallet = typeof wallets.$inferInsert

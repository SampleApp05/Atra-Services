// MARK: - nonce_challenges schema

import { pgTable, pgEnum, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { wallets } from './wallets.js'

// MARK: Purpose Enum

export const noncePurposeEnum = pgEnum('nonce_purpose', [
  'LOGIN',
  'LINK_WALLET',
  'GRANT_AUTH',
  'TRANSFER_OWNER',
  'RECOVERY',
])

export type NoncePurpose = (typeof noncePurposeEnum.enumValues)[number]

// MARK: Table

export const nonceChallenges = pgTable('nonce_challenges', {
  id:        uuid('id').primaryKey().defaultRandom(),
  walletId:  uuid('wallet_id').notNull().references(() => wallets.id),
  nonce:     text('nonce').notNull(),
  purpose:   noncePurposeEnum('purpose').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt:    timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// MARK: Types

export type NonceChallenge    = typeof nonceChallenges.$inferSelect
export type NewNonceChallenge = typeof nonceChallenges.$inferInsert

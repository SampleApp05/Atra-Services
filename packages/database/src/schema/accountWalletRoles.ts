// MARK: - account_wallet_roles schema

import { pgTable, pgEnum, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { accounts } from './accounts.js'
import { wallets } from './wallets.js'

// MARK: Role Enum

export const walletRoleEnum = pgEnum('wallet_role', [
  'OWNER',
  'AUTH',
  'STANDARD',
  'RECOVERY',
])

export type WalletRole = (typeof walletRoleEnum.enumValues)[number]

// MARK: Table

export const accountWalletRoles = pgTable('account_wallet_roles', {
  id:                uuid('id').primaryKey().defaultRandom(),
  accountId:         uuid('account_id').notNull().references(() => accounts.id),
  walletId:          uuid('wallet_id').notNull().references(() => wallets.id),
  role:              walletRoleEnum('role').notNull(),
  grantedByWalletId: uuid('granted_by_wallet_id').references(() => wallets.id),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  // No duplicate (account, wallet, role) associations.
  accountWalletRoleIdx: uniqueIndex('account_wallet_roles_account_wallet_role_idx')
    .on(table.accountId, table.walletId, table.role),
  // At most one OWNER per account.
  oneOwnerPerAccountIdx: uniqueIndex('account_wallet_roles_one_owner_idx')
    .on(table.accountId)
    .where(sql`${table.role} = 'OWNER'`),
  // At most one RECOVERY per account.
  oneRecoveryPerAccountIdx: uniqueIndex('account_wallet_roles_one_recovery_idx')
    .on(table.accountId)
    .where(sql`${table.role} = 'RECOVERY'`),
}))

// MARK: Types

export type AccountWalletRole    = typeof accountWalletRoles.$inferSelect
export type NewAccountWalletRole = typeof accountWalletRoles.$inferInsert

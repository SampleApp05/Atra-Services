// MARK: - Wallet Repository

import type { Db, NewWallet, Wallet } from '@atra/database'
import { wallets } from '@atra/database'
import { and, eq } from 'drizzle-orm'

// MARK: - Repository

export class WalletRepository {
  // MARK: Private State

  private readonly db: Db

  // MARK: Init

  constructor(db: Db) {
    this.db = db
  }

  // MARK: Public API

  async findByAddress(address: string, chainId: number): Promise<Wallet | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chainId, chainId)))
      .limit(1)

    return row ?? null
  }

  async create(address: string, chainId: number): Promise<Wallet> {
    const values: NewWallet = {
      address: address.toLowerCase(),
      chainId,
    }

    const [row] = await this.db
      .insert(wallets)
      .values(values)
      .returning()

    return row
  }
}

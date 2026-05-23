// MARK: - Audit Log Service
// Read-side service for querying audit_logs. Write side is inline in each
// service (SESSION_CREATED, ACCOUNT_CREATED, WALLET_LINKED, ROLE_GRANTED, …).

import { and, eq, lt, desc } from 'drizzle-orm'
import type { Db, AuditLog } from '@atra/database'
import { auditLogs } from '@atra/database'

// MARK: - Types

export interface AuditLogPage {
  logs: AuditLog[]
  /** Pass as `cursor` on the next request to paginate. */
  nextCursor: string | null
}

// MARK: - Service

export class AuditLogService {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /**
   * Returns up to `limit` audit log entries for an account,
   * ordered newest-first. Pass `cursor` (a log id) to paginate.
   */
  async getLogsForAccount(
    accountId: string,
    limit = 50,
    cursor?: string
  ): Promise<AuditLogPage> {
    const safeLimit = Math.min(Math.max(1, limit), 200)

    // Build cursor condition: fetch rows with id < cursor (UUID v4 ordering
    // is not reliable; we rely on createdAt DESC + id for stable pagination)
    const conditions = cursor
      ? and(eq(auditLogs.accountId, accountId), lt(auditLogs.id, cursor))
      : eq(auditLogs.accountId, accountId)

    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(conditions)
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit + 1) // fetch one extra to detect next page

    const hasMore = rows.length > safeLimit
    const page = hasMore ? rows.slice(0, safeLimit) : rows
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    return { logs: page, nextCursor }
  }
}

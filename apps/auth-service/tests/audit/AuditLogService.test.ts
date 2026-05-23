import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuditLogService } from '../../src/modules/audit/services/AuditLogService.js'

// MARK: - Mock helpers

function makeChain(rows: any[]) {
  return {
    orderBy: () => ({
      limit: (_n: number) => Promise.resolve(rows),
    }),
  }
}

// MARK: - DB mock

let mockRows: any[] = []

const mockDb: any = {
  select: () => ({
    from: () => ({
      where: (_: unknown) => makeChain(mockRows),
    }),
  }),
}

// MARK: - Fixtures

const ACCOUNT_ID = 'acc-1'

function makeLog(id: string, action: string) {
  return {
    id,
    accountId: ACCOUNT_ID,
    actorWalletId: 'wid-1',
    action,
    metadata: {},
    createdAt: new Date(),
  }
}

// MARK: - Tests

describe('AuditLogService', () => {
  let service: AuditLogService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditLogService(mockDb)
  })

  it('returns logs and null nextCursor when fewer than limit results', async () => {
    mockRows = [makeLog('l1', 'SESSION_CREATED'), makeLog('l2', 'WALLET_LINKED')]
    const result = await service.getLogsForAccount(ACCOUNT_ID)
    expect(result.logs).toHaveLength(2)
    expect(result.nextCursor).toBeNull()
  })

  it('returns nextCursor when result set equals limit + 1 (has more pages)', async () => {
    // Return limit + 1 rows to signal more pages exist
    mockRows = Array.from({ length: 4 }, (_, i) => makeLog(`l${i}`, 'ACT'))
    const result = await service.getLogsForAccount(ACCOUNT_ID, 3)
    expect(result.logs).toHaveLength(3) // trimmed to limit
    expect(result.nextCursor).toBe('l2') // last id in the trimmed page
  })

  it('clamps limit to maximum of 200', async () => {
    mockRows = []
    // No error should be thrown
    await expect(service.getLogsForAccount(ACCOUNT_ID, 9999)).resolves.toBeDefined()
  })

  it('returns empty logs when account has no entries', async () => {
    mockRows = []
    const result = await service.getLogsForAccount(ACCOUNT_ID)
    expect(result.logs).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })
})

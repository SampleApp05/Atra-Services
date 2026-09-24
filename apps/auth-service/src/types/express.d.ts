// MARK: - Express augmentation
// Extends the Express Request type with auth context injected by the
// authenticate middleware.

import type { WalletRole } from '@atra/database'

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the authenticate middleware on every protected route.
       * Contains the verified JWT claims + the caller's walletId.
       */
      auth?: {
        accountId: string
        sessionId: string
        walletId: string          // the session's persisted authenticating wallet
        roles: WalletRole[]
        chainId: number
      }
    }
  }
}

export {}

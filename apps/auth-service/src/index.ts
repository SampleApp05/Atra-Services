// MARK: - Auth Service Entry Point

import 'dotenv/config'
import express from 'express'
import { db } from './db/index.js'
import { createIdentityRouter } from './modules/identity/routes/identityRoutes.js'
import { createAuthRouter } from './modules/auth/routes/authRoutes.js'
import { createWalletRouter } from './modules/wallets/routes/walletRoutes.js'
import { createRoleRoutes } from './modules/roles/routes/roleRoutes.js'
import { createRecoveryRoutes } from './modules/recovery/routes/recoveryRoutes.js'
import { createAuditRoutes } from './modules/audit/routes/auditRoutes.js'
import { createAuthMiddleware } from './middleware/authenticate.js'
import { NonceService } from './modules/identity/services/NonceService.js'
import { SignatureService } from './modules/identity/services/SignatureService.js'
// Side-effect import: augments Express Request type
import './types/express.js'

const app = express()
app.use(express.json())

// MARK: - Shared service instances
const nonceService = new NonceService(db)
const signatureService = new SignatureService()

// MARK: - Auth middleware (applied to all protected routes)
const authenticate = createAuthMiddleware(db)

// MARK: - Public routes (no JWT required)
app.use('/identity', createIdentityRouter(db))
app.use('/auth',     createAuthRouter(db))

// MARK: - Protected routes
app.use('/wallets',  authenticate, createWalletRouter(db))
app.use('/roles',    authenticate, createRoleRoutes(db, nonceService, signatureService))
app.use('/recovery', authenticate, createRecoveryRoutes(db, nonceService, signatureService))
app.use('/audit',    authenticate, createAuditRoutes(db))

// MARK: - Health (public)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// MARK: - Start

const PORT = process.env.PORT ?? 3001

app.listen(PORT, () => {
  console.log(`[auth-service] Listening on port ${PORT}`)
})

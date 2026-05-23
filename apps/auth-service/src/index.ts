// MARK: - Auth Service Entry Point

import 'dotenv/config'
import express from 'express'
import { db } from './db/index.js'
import { createIdentityRouter } from './modules/identity/routes/identityRoutes.js'
import { createAuthRouter } from './modules/auth/routes/authRoutes.js'
import { createWalletRouter } from './modules/wallets/routes/walletRoutes.js'
import { createRoleRoutes } from './modules/roles/routes/roleRoutes.js'
import { createRecoveryRoutes } from './modules/recovery/routes/recoveryRoutes.js'
import { NonceService } from './modules/identity/services/NonceService.js'
import { SignatureService } from './modules/identity/services/SignatureService.js'

const app = express()
app.use(express.json())

// MARK: - Shared service instances
const nonceService = new NonceService(db)
const signatureService = new SignatureService()

// MARK: - Routes

app.use('/identity', createIdentityRouter(db))
app.use('/auth',     createAuthRouter(db))
app.use('/wallets',  createWalletRouter(db))
app.use('/roles',    createRoleRoutes(db, nonceService, signatureService))
app.use('/recovery', createRecoveryRoutes(db, nonceService, signatureService))

// MARK: - Health

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// MARK: - Start

const PORT = process.env.PORT ?? 3001

app.listen(PORT, () => {
  console.log(`[auth-service] Listening on port ${PORT}`)
})

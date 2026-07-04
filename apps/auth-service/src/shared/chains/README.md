# Chain Configuration — `src/shared/chains/`

Internal multi-chain infrastructure module for the ATRA auth-service.  
All chain-awareness in the backend flows through this module — no other service should hard-code chain IDs.

---

## Files

| File | Purpose |
|---|---|
| `chain.types.ts` | `ChainConfig` interface definition |
| `chain.constants.ts` | Static chain metadata (Ethereum, Sepolia) |
| `chain.service.ts` | `ChainService` — runtime chain registry, reads env at init |

---

## Supported Chains

| Key | Chain ID | Name | Testnet |
|---|---|---|---|
| `ethereum` | `1` | Ethereum | No |
| `sepolia` | `11155111` | Ethereum Sepolia | Yes (default) |

Adding a new chain requires only a new entry in `chain.constants.ts`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `SUPPORTED_CHAINS` | Comma-separated list of enabled chain keys, e.g. `ethereum,sepolia` |
| `DEFAULT_CHAIN` | Key of the chain returned by `getDefault()`, e.g. `sepolia` |
| `ETHEREUM_RPC` | HTTP RPC URL for Ethereum mainnet |
| `ETHEREUM_WS` | WebSocket URL for Ethereum mainnet |
| `SEPOLIA_RPC` | HTTP RPC URL for Sepolia |
| `SEPOLIA_WS` | WebSocket URL for Sepolia |
| `ETHEREUM_RECOVERY_CONTRACT` | *(optional)* Recovery contract address on mainnet |
| `SEPOLIA_RECOVERY_CONTRACT` | *(optional)* Recovery contract address on Sepolia |

The ENV variables follow the pattern `{KEY_UPPERCASE}_{VAR}`.

---

## ChainService API

```ts
import { ChainService } from './shared/chains/chain.service.js'

const chainService = new ChainService(
  ['ethereum', 'sepolia'],  // enabled keys (from SUPPORTED_CHAINS)
  'sepolia'                 // default key (from DEFAULT_CHAIN)
)

chainService.isSupported(11155111)         // → true
chainService.get(1)                        // → ChainConfig for Ethereum
chainService.get('sepolia')               // → ChainConfig for Sepolia
chainService.getDefault()                 // → ChainConfig for Sepolia
chainService.getDefaultChainId()          // → 11155111
chainService.getSupportedChains()         // → ChainConfig[]
chainService.getRecoveryContract(11155111) // → '0x...' | undefined
```

`ChainService` is instantiated once in `src/index.ts` and injected into:
- `AccountService` — to validate `chainId` on challenge/verify
- `ConfigController` — to serve the `GET /config` response

---

## `ChainConfig` Shape

```ts
interface ChainConfig {
  id:             number
  key:            string
  name:           string
  testnet:        boolean
  nativeCurrency: string
  rpcUrl:         string    // from env at init
  wsUrl:          string    // from env at init
  explorer:       string
  contracts: {
    recovery?: string       // from env at init
  }
}
```

---

## `GET /config` Response

The config endpoint exposes a **safe subset** of `ChainConfig` — `rpcUrl` and `wsUrl` are never sent to clients.

```json
{
  "defaultChain": 11155111,
  "supportedChains": [
    { "id": 11155111, "key": "sepolia",  "name": "Ethereum Sepolia", "testnet": true  },
    { "id": 1,        "key": "ethereum", "name": "Ethereum",         "testnet": false }
  ]
}
```

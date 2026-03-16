# 🐾 OpenClaw Pay — AI-Native Crypto Payment Protocol

> **Let AI Agents pay securely — without ever touching private keys.**

## The Problem

AI Agents increasingly need the ability to make payments — purchasing API keys, tipping content creators, paying for cloud resources. But handing your private key to an AI is a **terrible idea**.

OpenClaw Pay solves this with a simple protocol:

```
AI Agent creates PaymentIntent → Protocol routes to Wallet → User approves in App → Wallet signs tx → On-chain execution
```

**The AI Agent never has access to private keys.** It can only express *payment intent*. The user retains full control through their wallet app.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       AI Agent                               │
│  "I need to pay 0.01 ETH to 0xABC for API access"          │
└──────────────────────┬──────────────────────────────────────┘
                       │ PaymentIntent
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  OpenClaw Protocol                           │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ PaymentIntent│→│Authorization │→│ SignedTransaction  │  │
│  │   Manager   │  │   Manager    │  │    Executor       │  │
│  └─────────────┘  └──────┬───────┘  └───────────────────┘  │
│                          │                                   │
└──────────────────────────┼──────────────────────────────────┘
                           │ Authorization Request
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Wallet App                        │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Key Vault  │  │  Auth UI     │  │  Tx Signer        │  │
│  │ (encrypted) │  │  (approve/   │  │  (sign & submit)  │  │
│  │             │  │   reject)    │  │                   │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
│                                                             │
│  Authorization Policies:                                    │
│  • Per-transaction approval (most secure)                   │
│  • Pre-authorized spending limits (convenient)              │
│  • Whitelisted recipients (auto-approve trusted addresses)  │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### Core Flow

1. **AI Agent** calls `agent.pay()` with a payment intent (recipient, amount, reason)
2. **Protocol Server** receives the intent, checks pre-authorization policies
3. If no policy matches → **Wallet App** pushes a real-time notification to the user
4. **User** reviews the request (amount, recipient, reason) and approves or rejects
5. **Wallet** signs the transaction with the private key and broadcasts to the blockchain
6. **AI Agent** receives the result (success + tx hash, or rejection reason)

### Authorization Modes

#### 1. Per-Transaction Approval (Most Secure)
```
Agent → PaymentIntent → Protocol → Wallet App (user reviews) → Sign → Broadcast
```
Every payment requires explicit user approval.

#### 2. Pre-Authorized Spending Limits (Convenient)
```
User sets policy: "Allow Agent to spend up to 0.1 ETH per day"
Agent → PaymentIntent → Protocol → Auto-check limits → Sign → Broadcast
```
Payments within the spending limit are automatically approved.

#### 3. Whitelist Mode
```
User sets policy: "Auto-approve payments to 0xABC"
Agent → PaymentIntent → Protocol → Check whitelist → Sign → Broadcast
```
Payments to trusted addresses are automatically approved.

## Quick Start

```bash
# Install dependencies
npm install

# Terminal 1: Start the authorization server
npm run server

# Terminal 2: Start the wallet app (opens in browser)
npm run wallet

# Terminal 3: Run the demo (AI Agent payment flow)
npm run demo
```

Then open `http://localhost:3101` in your browser to see the wallet UI and approve/reject payment requests from the AI Agent.

## Usage

### For AI Agent Developers

Integrate payments into your AI Agent with just a few lines:

```typescript
import { OpenClawAgent } from 'openclaw-pay';

const agent = new OpenClawAgent({
  agentId: 'my-shopping-assistant',
  agentName: 'Shopping Assistant',
  serverUrl: 'ws://localhost:3100',
});

await agent.connect();

// That's it — just call pay() when the agent needs to make a payment
const result = await agent.pay({
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  amount: '0.001',
  currency: 'ETH',
  reason: 'Purchase premium API key for GPT-5 service at $2.50/month',
});

if (result.status === 'success') {
  console.log(`Payment confirmed! TxHash: ${result.txHash}`);
} else if (result.status === 'rejected') {
  console.log(`User declined: ${result.rejectReason}`);
}
```

### For Wallet / Policy Configuration

Set up spending policies via the REST API:

```bash
# Add a daily spending limit policy
curl -X POST http://localhost:3100/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily ETH Limit",
    "type": "spending_limit",
    "enabled": true,
    "rules": [{
      "type": "max_daily",
      "params": {
        "maxAmount": "100000000000000000",
        "chainId": 11155111
      }
    }]
  }'

# Add a whitelisted address
curl -X POST http://localhost:3100/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trusted Services",
    "type": "whitelist",
    "enabled": true,
    "rules": [{
      "type": "whitelist_address",
      "params": {
        "addresses": ["0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"]
      }
    }]
  }'
```

## Project Structure

```
openclaw-pay/
├── src/
│   ├── protocol/          # Core protocol layer
│   │   ├── types.ts       # PaymentIntent, Authorization, Policy types
│   │   ├── intent-manager.ts   # Create & validate payment intents
│   │   └── auth-manager.ts     # Authorization flow & policy engine
│   ├── wallet/            # Wallet module
│   │   ├── key-vault.ts   # Encrypted key storage (AES-256-GCM)
│   │   └── tx-signer.ts   # Transaction builder & signer
│   ├── agent/             # AI Agent SDK
│   │   └── agent-sdk.ts   # Simple pay() API for agents
│   ├── server/            # Authorization server
│   │   └── index.ts       # WebSocket + REST API middleware
│   ├── demo/              # End-to-end demo
│   │   └── agent-payment.ts
│   └── index.ts           # Package entry point
├── wallet-app/            # Web-based wallet UI
│   └── index.html         # Approval interface (dark theme)
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Protocol & SDK | TypeScript, ethers.js v6 |
| Authorization Server | Express, WebSocket (ws) |
| Wallet App | Vanilla HTML/JS, WebSocket |
| Key Storage | AES-256-GCM encryption |
| Communication | WebSocket (real-time push) |

## Security Design

| Feature | Description |
|---------|-------------|
| **Key Isolation** | Private keys exist only in the wallet app, encrypted with AES-256-GCM |
| **Intent Signing** | AI Agent signs PaymentIntent with its identity key (not the payment key) to prevent tampering |
| **Time Windows** | Authorization requests expire after a configurable TTL, preventing replay attacks |
| **Spending Limits** | Pre-authorization policies support per-tx, daily, weekly, and monthly limits |
| **Audit Trail** | All payment requests and authorization decisions are logged and traceable |

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health & connection stats |
| `GET` | `/api/auth/pending` | List pending authorization requests |
| `GET` | `/api/auth/:id` | Get specific authorization request |
| `POST` | `/api/auth/:id/respond` | Submit authorization response |
| `GET` | `/api/policies` | List all policies |
| `POST` | `/api/policies` | Create a new policy |
| `DELETE` | `/api/policies/:id` | Delete a policy |
| `GET` | `/api/transactions` | Transaction history |

### WebSocket Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `agent_register` | Agent → Server | Register an AI Agent |
| `wallet_register` | Wallet → Server | Register a wallet |
| `intent_created` | Agent → Server | Submit a PaymentIntent |
| `auth_request` | Server → Wallet | Push authorization request |
| `auth_response` | Wallet → Server → Agent | Authorization result |
| `tx_status` | Server → Agent | Transaction status update |

## Roadmap

- [ ] MetaMask / Trust Wallet integration (WalletConnect v2)
- [ ] Multi-sig approval (require N-of-M approvers)
- [ ] ERC-4337 Account Abstraction support
- [ ] Mobile app (React Native)
- [ ] On-chain policy contracts (smart contract-enforced limits)
- [ ] MCP (Model Context Protocol) tool integration
- [ ] Multi-chain support (Solana, TON, etc.)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

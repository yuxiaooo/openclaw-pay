/**
 * 🐾 OpenClaw Pay — AI-Native Crypto Payment Protocol
 * 
 * Let AI Agents pay securely without exposing private keys.
 * 
 * @example
 * ```typescript
 * import { OpenClawAgent } from 'openclaw-pay';
 * 
 * const agent = new OpenClawAgent({
 *   agentId: 'my-agent',
 *   agentName: 'My AI Assistant',
 *   serverUrl: 'ws://localhost:3100',
 * });
 * 
 * await agent.connect();
 * 
 * const result = await agent.pay({
 *   to: '0x...',
 *   amount: '0.01',
 *   currency: 'ETH',
 *   reason: 'Purchase API access',
 * });
 * ```
 */

// Protocol
export {
  PaymentIntent,
  PaymentDetails,
  AuthorizationRequest,
  AuthorizationResponse,
  AuthorizationStatus,
  Policy,
  PolicyType,
  PolicyRule,
  SpendingLimitRule,
  WhitelistRule,
  TimeRangeRule,
  TransactionRecord,
  WSMessage,
  AgentIdentity,
} from './protocol/types';

export { IntentManager, CreateIntentParams } from './protocol/intent-manager';
export { AuthManager } from './protocol/auth-manager';

// Agent SDK
export { OpenClawAgent, AgentConfig, PayRequest, PayResult } from './agent/agent-sdk';

// Wallet
export { KeyVault } from './wallet/key-vault';
export { TxSigner, SignedTxResult, TxSignerConfig } from './wallet/tx-signer';

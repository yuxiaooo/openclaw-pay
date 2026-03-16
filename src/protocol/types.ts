/**
 * OpenClaw Pay Protocol — Core Types
 * 
 * 核心概念:
 * - PaymentIntent: AI Agent 发起的支付意图（不含私钥信息）
 * - AuthorizationRequest: 发送给钱包的授权请求
 * - AuthorizationResponse: 钱包的授权响应（含签名）
 * - Policy: 预授权策略（额度、白名单等）
 */

// ============================================================
// Payment Intent — AI Agent 发起的支付意图
// ============================================================

export interface PaymentIntent {
  /** 唯一标识 */
  id: string;
  /** 协议版本 */
  version: '1.0';
  /** 发起支付的 Agent 标识 */
  agentId: string;
  /** Agent 描述的支付原因 */
  reason: string;
  /** 支付详情 */
  payment: PaymentDetails;
  /** 创建时间 (Unix timestamp ms) */
  createdAt: number;
  /** 过期时间 (Unix timestamp ms) */
  expiresAt: number;
  /** Agent 对此 intent 的签名 (用 agent 的身份密钥, 非支付密钥) */
  agentSignature?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface PaymentDetails {
  /** 链 ID (1 = Ethereum Mainnet, 11155111 = Sepolia, etc.) */
  chainId: number;
  /** 收款地址 */
  to: string;
  /** 支付金额 (wei 字符串) */
  value: string;
  /** 可读金额 (如 "0.01 ETH") */
  displayAmount: string;
  /** Token 合约地址 (原生币支付则为 null) */
  tokenAddress?: string;
  /** Token 符号 */
  tokenSymbol?: string;
  /** 合约调用数据 (可选) */
  data?: string;
  /** Gas 限制 */
  gasLimit?: string;
  /** 最大 Gas 价格 */
  maxFeePerGas?: string;
  /** 最大优先 Gas 价格 */
  maxPriorityFeePerGas?: string;
}

// ============================================================
// Authorization — 钱包授权
// ============================================================

export interface AuthorizationRequest {
  /** 唯一标识 */
  id: string;
  /** 关联的 PaymentIntent */
  intentId: string;
  /** 完整的支付意图 */
  intent: PaymentIntent;
  /** 请求发送时间 */
  requestedAt: number;
  /** 授权过期时间 */
  expiresAt: number;
  /** 当前状态 */
  status: AuthorizationStatus;
}

export type AuthorizationStatus =
  | 'pending'      // 等待用户审批
  | 'approved'     // 用户已批准
  | 'rejected'     // 用户已拒绝
  | 'expired'      // 已过期
  | 'auto_approved' // 策略自动批准
  | 'executed'     // 已执行上链
  | 'failed';      // 执行失败

export interface AuthorizationResponse {
  /** 关联的请求 ID */
  requestId: string;
  /** 关联的 PaymentIntent ID */
  intentId: string;
  /** 授权状态 */
  status: 'approved' | 'rejected';
  /** 已签名的交易 (当 approved 时) */
  signedTransaction?: string;
  /** 交易哈希 (当已提交时) */
  txHash?: string;
  /** 拒绝原因 (当 rejected 时) */
  rejectReason?: string;
  /** 响应时间 */
  respondedAt: number;
  /** 钱包地址 */
  walletAddress: string;
}

// ============================================================
// Policy — 预授权策略
// ============================================================

export interface Policy {
  /** 策略 ID */
  id: string;
  /** 策略名称 */
  name: string;
  /** 策略类型 */
  type: PolicyType;
  /** 适用的 Agent ID (空则适用所有) */
  agentIds?: string[];
  /** 策略规则 */
  rules: PolicyRule[];
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

export type PolicyType =
  | 'spending_limit'  // 额度限制
  | 'whitelist'       // 白名单
  | 'time_window'     // 时间窗口
  | 'combined';       // 组合策略

export interface PolicyRule {
  /** 规则类型 */
  type: 'max_per_tx' | 'max_daily' | 'max_weekly' | 'max_monthly' | 'whitelist_address' | 'time_range';
  /** 规则参数 */
  params: Record<string, unknown>;
}

export interface SpendingLimitRule extends PolicyRule {
  type: 'max_per_tx' | 'max_daily' | 'max_weekly' | 'max_monthly';
  params: {
    /** 最大金额 (wei) */
    maxAmount: string;
    /** 链 ID */
    chainId: number;
    /** Token 地址 (原生币为 null) */
    tokenAddress?: string;
  };
}

export interface WhitelistRule extends PolicyRule {
  type: 'whitelist_address';
  params: {
    /** 白名单地址列表 */
    addresses: string[];
  };
}

export interface TimeRangeRule extends PolicyRule {
  type: 'time_range';
  params: {
    /** 开始时间 (HH:mm) */
    startTime: string;
    /** 结束时间 (HH:mm) */
    endTime: string;
    /** 时区 */
    timezone: string;
  };
}

// ============================================================
// Transaction Record — 交易记录
// ============================================================

export interface TransactionRecord {
  /** 记录 ID */
  id: string;
  /** PaymentIntent ID */
  intentId: string;
  /** Authorization ID */
  authorizationId: string;
  /** 交易哈希 */
  txHash: string;
  /** 链 ID */
  chainId: number;
  /** 发送方 */
  from: string;
  /** 接收方 */
  to: string;
  /** 金额 (wei) */
  value: string;
  /** 状态 */
  status: 'pending' | 'confirmed' | 'failed';
  /** Agent ID */
  agentId: string;
  /** 支付原因 */
  reason: string;
  /** 创建时间 */
  createdAt: number;
  /** 确认时间 */
  confirmedAt?: number;
  /** 区块号 */
  blockNumber?: number;
}

// ============================================================
// WebSocket Messages — 实时通信
// ============================================================

export type WSMessage =
  | { type: 'auth_request'; data: AuthorizationRequest }
  | { type: 'auth_response'; data: AuthorizationResponse }
  | { type: 'intent_created'; data: PaymentIntent }
  | { type: 'tx_status'; data: { intentId: string; status: string; txHash?: string } }
  | { type: 'policy_matched'; data: { intentId: string; policyId: string; action: 'auto_approve' | 'auto_reject' } }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; data: { code: string; message: string } };

// ============================================================
// Agent Identity — Agent 身份
// ============================================================

export interface AgentIdentity {
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 的身份公钥 (用于验证 intent 签名, 不是支付密钥!) */
  publicKey: string;
  /** 描述 */
  description?: string;
  /** 注册时间 */
  registeredAt: number;
}

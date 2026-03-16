/**
 * Authorization Manager
 * 
 * 管理授权流程:
 * 1. 接收 PaymentIntent
 * 2. 检查预授权策略（Policy）
 * 3. 如果策略匹配则自动授权，否则发送给用户审批
 * 4. 收集授权结果
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import {
  PaymentIntent,
  AuthorizationRequest,
  AuthorizationResponse,
  AuthorizationStatus,
  Policy,
  PolicyRule,
  TransactionRecord,
} from './types';
import { EventEmitter } from 'events';

export interface AuthManagerEvents {
  'auth:request': (request: AuthorizationRequest) => void;
  'auth:approved': (response: AuthorizationResponse) => void;
  'auth:rejected': (response: AuthorizationResponse) => void;
  'auth:auto_approved': (request: AuthorizationRequest, policyId: string) => void;
  'auth:expired': (request: AuthorizationRequest) => void;
}

export class AuthManager extends EventEmitter {
  private requests: Map<string, AuthorizationRequest> = new Map();
  private policies: Map<string, Policy> = new Map();
  private transactionHistory: TransactionRecord[] = [];
  private dailySpending: Map<string, bigint> = new Map(); // date_chainId_token -> amount

  /** 授权请求的默认过期时间 (ms) */
  private readonly AUTH_TTL = 3 * 60 * 1000; // 3 分钟

  /**
   * 处理一个 PaymentIntent，生成授权请求
   */
  async processIntent(intent: PaymentIntent): Promise<AuthorizationRequest> {
    // 1. 检查 Intent 是否过期
    if (Date.now() > intent.expiresAt) {
      throw new Error(`PaymentIntent ${intent.id} has expired`);
    }

    // 2. 创建授权请求
    const request: AuthorizationRequest = {
      id: uuidv4(),
      intentId: intent.id,
      intent,
      requestedAt: Date.now(),
      expiresAt: Date.now() + this.AUTH_TTL,
      status: 'pending',
    };

    // 3. 检查预授权策略
    const matchedPolicy = this.matchPolicy(intent);
    if (matchedPolicy) {
      request.status = 'auto_approved';
      this.requests.set(request.id, request);
      this.emit('auth:auto_approved', request, matchedPolicy.id);
      return request;
    }

    // 4. 需要用户手动审批
    this.requests.set(request.id, request);
    this.emit('auth:request', request);

    // 5. 设置过期定时器
    setTimeout(() => {
      const req = this.requests.get(request.id);
      if (req && req.status === 'pending') {
        req.status = 'expired';
        this.requests.set(request.id, req);
        this.emit('auth:expired', req);
      }
    }, this.AUTH_TTL);

    return request;
  }

  /**
   * 用户响应授权请求
   */
  respondToRequest(response: AuthorizationResponse): void {
    const request = this.requests.get(response.requestId);
    if (!request) {
      throw new Error(`Authorization request ${response.requestId} not found`);
    }

    if (request.status !== 'pending' && request.status !== 'auto_approved') {
      throw new Error(`Authorization request ${response.requestId} is not pending (status: ${request.status})`);
    }

    // 更新状态
    request.status = response.status === 'approved' ? 'approved' : 'rejected';
    this.requests.set(request.id, request);

    if (response.status === 'approved') {
      // 更新每日消费额度
      this.trackSpending(request.intent);
      this.emit('auth:approved', response);
    } else {
      this.emit('auth:rejected', response);
    }
  }

  /**
   * 标记交易已执行
   */
  markExecuted(requestId: string, txHash: string): void {
    const request = this.requests.get(requestId);
    if (request) {
      request.status = 'executed';
      this.requests.set(requestId, request);

      // 记录交易
      const record: TransactionRecord = {
        id: uuidv4(),
        intentId: request.intentId,
        authorizationId: request.id,
        txHash,
        chainId: request.intent.payment.chainId,
        from: '', // 由钱包填充
        to: request.intent.payment.to,
        value: request.intent.payment.value,
        status: 'pending',
        agentId: request.intent.agentId,
        reason: request.intent.reason,
        createdAt: Date.now(),
      };
      this.transactionHistory.push(record);
    }
  }

  // ============================================================
  // Policy 管理
  // ============================================================

  /**
   * 添加预授权策略
   */
  addPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * 移除策略
   */
  removePolicy(policyId: string): void {
    this.policies.delete(policyId);
  }

  /**
   * 获取所有策略
   */
  getPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }

  /**
   * 匹配策略 — 检查是否有适用的预授权策略
   */
  private matchPolicy(intent: PaymentIntent): Policy | null {
    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      // 检查 Agent 是否适用
      if (policy.agentIds && policy.agentIds.length > 0) {
        if (!policy.agentIds.includes(intent.agentId)) continue;
      }

      // 检查所有规则是否都通过
      const allRulesPass = policy.rules.every(rule => this.evaluateRule(rule, intent));
      if (allRulesPass) {
        return policy;
      }
    }
    return null;
  }

  /**
   * 评估单条规则
   */
  private evaluateRule(rule: PolicyRule, intent: PaymentIntent): boolean {
    switch (rule.type) {
      case 'max_per_tx': {
        const maxAmount = BigInt(rule.params.maxAmount as string);
        const txAmount = BigInt(intent.payment.value);
        const chainId = rule.params.chainId as number;
        return txAmount <= maxAmount && intent.payment.chainId === chainId;
      }

      case 'max_daily': {
        const maxDaily = BigInt(rule.params.maxAmount as string);
        const chainId = rule.params.chainId as number;
        if (intent.payment.chainId !== chainId) return false;

        const todayKey = this.getDailyKey(chainId, intent.payment.tokenAddress);
        const spent = this.dailySpending.get(todayKey) ?? 0n;
        const txAmount = BigInt(intent.payment.value);
        return (spent + txAmount) <= maxDaily;
      }

      case 'whitelist_address': {
        const addresses = (rule.params.addresses as string[]).map(a => a.toLowerCase());
        return addresses.includes(intent.payment.to.toLowerCase());
      }

      case 'time_range': {
        const { startTime, endTime } = rule.params as { startTime: string; endTime: string };
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        return currentTime >= startTime && currentTime <= endTime;
      }

      default:
        return false;
    }
  }

  /**
   * 追踪每日消费
   */
  private trackSpending(intent: PaymentIntent): void {
    const key = this.getDailyKey(intent.payment.chainId, intent.payment.tokenAddress);
    const current = this.dailySpending.get(key) ?? 0n;
    this.dailySpending.set(key, current + BigInt(intent.payment.value));
  }

  private getDailyKey(chainId: number, tokenAddress?: string): string {
    const date = new Date().toISOString().split('T')[0];
    const token = tokenAddress ?? 'native';
    return `${date}_${chainId}_${token}`;
  }

  // ============================================================
  // 查询
  // ============================================================

  getRequest(requestId: string): AuthorizationRequest | undefined {
    return this.requests.get(requestId);
  }

  getRequestByIntentId(intentId: string): AuthorizationRequest | undefined {
    return Array.from(this.requests.values()).find(r => r.intentId === intentId);
  }

  getPendingRequests(): AuthorizationRequest[] {
    return Array.from(this.requests.values())
      .filter(r => r.status === 'pending')
      .sort((a, b) => b.requestedAt - a.requestedAt);
  }

  getTransactionHistory(): TransactionRecord[] {
    return [...this.transactionHistory].sort((a, b) => b.createdAt - a.createdAt);
  }
}

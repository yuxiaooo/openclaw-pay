/**
 * PaymentIntent Manager
 * 
 * 管理 AI Agent 发起的支付意图
 * - 创建 PaymentIntent
 * - 验证 PaymentIntent
 * - 跟踪 Intent 状态
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { PaymentIntent, PaymentDetails } from './types';

/** Intent 创建参数 */
export interface CreateIntentParams {
  agentId: string;
  reason: string;
  payment: PaymentDetails;
  /** 过期时间（毫秒），默认 5 分钟 */
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export class IntentManager {
  private intents: Map<string, PaymentIntent> = new Map();

  /**
   * 创建一个 PaymentIntent
   * AI Agent 调用此方法发起支付请求
   */
  createIntent(params: CreateIntentParams): PaymentIntent {
    const now = Date.now();
    const ttl = params.ttlMs ?? 5 * 60 * 1000; // 默认 5 分钟

    // 验证支付参数
    this.validatePaymentDetails(params.payment);

    const intent: PaymentIntent = {
      id: uuidv4(),
      version: '1.0',
      agentId: params.agentId,
      reason: params.reason,
      payment: { ...params.payment },
      createdAt: now,
      expiresAt: now + ttl,
      metadata: params.metadata,
    };

    this.intents.set(intent.id, intent);
    return intent;
  }

  /**
   * 用 Agent 的身份密钥签名 Intent
   * 注意：这是 Agent 的身份密钥，不是支付私钥！
   */
  async signIntent(intent: PaymentIntent, agentPrivateKey: string): Promise<PaymentIntent> {
    const message = this.getIntentMessage(intent);
    const wallet = new ethers.Wallet(agentPrivateKey);
    const signature = await wallet.signMessage(message);

    const signedIntent = { ...intent, agentSignature: signature };
    this.intents.set(intent.id, signedIntent);
    return signedIntent;
  }

  /**
   * 验证 Intent 的 Agent 签名
   */
  verifyIntentSignature(intent: PaymentIntent, agentPublicKey: string): boolean {
    if (!intent.agentSignature) return false;

    const message = this.getIntentMessage(intent);
    try {
      const recoveredAddress = ethers.verifyMessage(message, intent.agentSignature);
      return recoveredAddress.toLowerCase() === agentPublicKey.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * 检查 Intent 是否已过期
   */
  isExpired(intent: PaymentIntent): boolean {
    return Date.now() > intent.expiresAt;
  }

  /**
   * 获取 Intent
   */
  getIntent(intentId: string): PaymentIntent | undefined {
    return this.intents.get(intentId);
  }

  /**
   * 获取 Agent 的所有 Intent
   */
  getIntentsByAgent(agentId: string): PaymentIntent[] {
    return Array.from(this.intents.values())
      .filter(i => i.agentId === agentId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取 Intent 的可签名消息
   */
  private getIntentMessage(intent: PaymentIntent): string {
    // 生成确定性的消息用于签名
    const payload = {
      id: intent.id,
      version: intent.version,
      agentId: intent.agentId,
      reason: intent.reason,
      payment: intent.payment,
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt,
    };
    return `OpenClaw Pay Intent:\n${JSON.stringify(payload, null, 0)}`;
  }

  /**
   * 验证支付参数
   */
  private validatePaymentDetails(payment: PaymentDetails): void {
    // 验证地址格式 (接受任意大小写, 统一用 getAddress 规范化)
    try {
      payment.to = ethers.getAddress(payment.to.toLowerCase());
    } catch {
      throw new Error(`Invalid recipient address: ${payment.to}`);
    }

    try {
      const value = BigInt(payment.value);
      if (value < 0n) {
        throw new Error('Payment value cannot be negative');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('negative')) throw e;
      throw new Error(`Invalid payment value: ${payment.value}`);
    }

    if (payment.tokenAddress) {
      try {
        payment.tokenAddress = ethers.getAddress(payment.tokenAddress.toLowerCase());
      } catch {
        throw new Error(`Invalid token address: ${payment.tokenAddress}`);
      }
    }
  }
}

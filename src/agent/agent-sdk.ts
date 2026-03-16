/**
 * OpenClaw Agent SDK
 * 
 * AI Agent 使用此 SDK 发起支付
 * Agent 永远不会接触私钥，只能发起 PaymentIntent
 * 
 * Usage:
 * ```typescript
 * const agent = new OpenClawAgent({
 *   agentId: 'my-ai-agent',
 *   agentName: 'Shopping Assistant',
 *   serverUrl: 'ws://localhost:3100',
 * });
 * 
 * const result = await agent.pay({
 *   to: '0x...',
 *   amount: '0.01',
 *   currency: 'ETH',
 *   reason: 'Purchase API access for user request',
 * });
 * 
 * if (result.status === 'success') {
 *   console.log('Payment confirmed:', result.txHash);
 * }
 * ```
 */

import { ethers } from 'ethers';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { PaymentIntent, WSMessage, AuthorizationResponse } from '../protocol/types';
import { IntentManager } from '../protocol/intent-manager';

export interface AgentConfig {
  /** Agent 唯一标识 */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** OpenClaw 授权服务地址 */
  serverUrl: string;
  /** Agent 身份密钥 (仅用于签名 Intent, 不是支付密钥!) */
  agentPrivateKey?: string;
  /** 支付请求超时 (ms) */
  paymentTimeout?: number;
}

export interface PayRequest {
  /** 收款地址 */
  to: string;
  /** 金额 (人类可读, 如 "0.01") */
  amount: string;
  /** 货币/Token 符号 (如 "ETH", "USDC") */
  currency: string;
  /** 支付原因 (AI Agent 描述为什么需要支付) */
  reason: string;
  /** 链 ID (默认 11155111 Sepolia testnet) */
  chainId?: number;
  /** Token 合约地址 (原生币不填) */
  tokenAddress?: string;
  /** 额外数据 */
  metadata?: Record<string, unknown>;
}

export interface PayResult {
  status: 'success' | 'rejected' | 'expired' | 'error';
  intentId: string;
  txHash?: string;
  error?: string;
  /** 用户拒绝原因 */
  rejectReason?: string;
}

export class OpenClawAgent {
  private config: AgentConfig;
  private intentManager: IntentManager;
  private ws: WebSocket | null = null;
  private pendingPayments: Map<string, {
    resolve: (result: PayResult) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: AgentConfig) {
    this.config = {
      paymentTimeout: 180_000, // 默认 3 分钟
      ...config,
    };
    this.intentManager = new IntentManager();

    // 如果没有提供 Agent 私钥，自动生成一个
    if (!this.config.agentPrivateKey) {
      this.config.agentPrivateKey = ethers.Wallet.createRandom().privateKey;
    }
  }

  /**
   * 连接到 OpenClaw 授权服务
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', () => {
        console.log(`[OpenClaw Agent] Connected to ${this.config.serverUrl}`);
        // 注册 Agent
        this.send({
          type: 'agent_register' as any,
          data: {
            agentId: this.config.agentId,
            agentName: this.config.agentName,
            publicKey: new ethers.Wallet(this.config.agentPrivateKey!).address,
          },
        });
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg: WSMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.error('[OpenClaw Agent] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[OpenClaw Agent] WebSocket error:', err);
        reject(err);
      });

      this.ws.on('close', () => {
        console.log('[OpenClaw Agent] Disconnected');
      });
    });
  }

  /**
   * 🎯 核心方法: AI Agent 发起支付
   * 
   * 这是 AI Agent 唯一需要调用的方法
   * 它会创建 PaymentIntent，发送给用户钱包等待授权，然后返回结果
   */
  async pay(request: PayRequest): Promise<PayResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const chainId = request.chainId ?? 11155111; // 默认 Sepolia

    // 将人类可读金额转换为 wei
    const value = ethers.parseEther(request.amount).toString();

    // 创建 PaymentIntent
    const intent = this.intentManager.createIntent({
      agentId: this.config.agentId,
      reason: request.reason,
      payment: {
        chainId,
        to: request.to,
        value,
        displayAmount: `${request.amount} ${request.currency}`,
        tokenAddress: request.tokenAddress,
        tokenSymbol: request.currency,
      },
      metadata: request.metadata,
    });

    // 签名 Intent
    const signedIntent = await this.intentManager.signIntent(
      intent,
      this.config.agentPrivateKey!,
    );

    // 发送给授权服务
    this.send({
      type: 'intent_created',
      data: signedIntent,
    });

    console.log(`[OpenClaw Agent] Payment intent created: ${intent.id}`);
    console.log(`[OpenClaw Agent] Waiting for user authorization...`);
    console.log(`  To: ${request.to}`);
    console.log(`  Amount: ${request.amount} ${request.currency}`);
    console.log(`  Reason: ${request.reason}`);

    // 等待授权结果
    return new Promise<PayResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingPayments.delete(intent.id);
        resolve({
          status: 'expired',
          intentId: intent.id,
          error: 'Payment authorization timed out',
        });
      }, this.config.paymentTimeout!);

      this.pendingPayments.set(intent.id, { resolve, timeout });
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // 清理所有待处理的支付
    for (const [intentId, pending] of this.pendingPayments) {
      clearTimeout(pending.timeout);
      pending.resolve({
        status: 'error',
        intentId,
        error: 'Agent disconnected',
      });
    }
    this.pendingPayments.clear();
  }

  /**
   * 处理来自服务器的消息
   */
  private handleMessage(msg: WSMessage): void {
    switch (msg.type) {
      case 'auth_response': {
        const response = msg.data as AuthorizationResponse;
        const pending = this.pendingPayments.get(response.intentId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingPayments.delete(response.intentId);

          if (response.status === 'approved') {
            console.log(`[OpenClaw Agent] ✅ Payment approved! TxHash: ${response.txHash}`);
            pending.resolve({
              status: 'success',
              intentId: response.intentId,
              txHash: response.txHash,
            });
          } else {
            console.log(`[OpenClaw Agent] ❌ Payment rejected: ${response.rejectReason}`);
            pending.resolve({
              status: 'rejected',
              intentId: response.intentId,
              rejectReason: response.rejectReason,
            });
          }
        }
        break;
      }

      case 'tx_status': {
        const { intentId, status, txHash } = msg.data;
        console.log(`[OpenClaw Agent] Transaction ${intentId}: ${status} (${txHash})`);
        break;
      }

      case 'error': {
        console.error(`[OpenClaw Agent] Error: ${msg.data.message}`);
        break;
      }

      case 'ping': {
        this.send({ type: 'pong' });
        break;
      }
    }
  }

  private send(msg: WSMessage | Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * OpenClaw Pay Authorization Server
 * 
 * 核心中间层，连接 AI Agent 和钱包 App:
 * - 接收 Agent 的 PaymentIntent
 * - 转发给钱包 App 请求授权
 * - 收集授权结果并回传给 Agent
 * - 管理预授权策略
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import {
  PaymentIntent,
  AuthorizationRequest,
  AuthorizationResponse,
  Policy,
  WSMessage,
} from '../protocol/types';
import { AuthManager } from '../protocol/auth-manager';
import { IntentManager } from '../protocol/intent-manager';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3100;

// ============================================================
// 初始化
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const authManager = new AuthManager();
const intentManager = new IntentManager();

// 连接管理
interface Connection {
  id: string;
  type: 'agent' | 'wallet';
  ws: WebSocket;
  agentId?: string;
  walletAddress?: string;
}

const connections: Map<string, Connection> = new Map();

// ============================================================
// WebSocket 处理
// ============================================================

wss.on('connection', (ws: WebSocket) => {
  const connId = uuidv4();
  const conn: Connection = { id: connId, type: 'agent', ws };
  connections.set(connId, conn);

  console.log(`[Server] New connection: ${connId}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWSMessage(connId, msg);
    } catch (e) {
      sendToConnection(connId, {
        type: 'error',
        data: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      });
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Connection closed: ${connId}`);
    connections.delete(connId);
  });

  ws.on('error', (err) => {
    console.error(`[Server] Connection error ${connId}:`, err.message);
  });
});

function handleWSMessage(connId: string, msg: any): void {
  const conn = connections.get(connId);
  if (!conn) return;

  switch (msg.type) {
    // Agent 注册
    case 'agent_register': {
      conn.type = 'agent';
      conn.agentId = msg.data.agentId;
      console.log(`[Server] Agent registered: ${msg.data.agentId} (${msg.data.agentName})`);
      break;
    }

    // 钱包 App 注册
    case 'wallet_register': {
      conn.type = 'wallet';
      conn.walletAddress = msg.data.address;
      console.log(`[Server] Wallet registered: ${msg.data.address}`);

      // 发送所有待处理的授权请求
      const pending = authManager.getPendingRequests();
      for (const req of pending) {
        sendToConnection(connId, { type: 'auth_request', data: req });
      }
      break;
    }

    // Agent 发起支付意图
    case 'intent_created': {
      const intent = msg.data as PaymentIntent;
      console.log(`[Server] New PaymentIntent from ${intent.agentId}: ${intent.id}`);
      console.log(`  Amount: ${intent.payment.displayAmount}`);
      console.log(`  To: ${intent.payment.to}`);
      console.log(`  Reason: ${intent.reason}`);

      // 处理 Intent（检查策略，生成授权请求）
      authManager.processIntent(intent).then((authReq) => {
        if (authReq.status === 'auto_approved') {
          console.log(`[Server] Auto-approved by policy!`);
          // 通知所有钱包签名
          broadcastToWallets({
            type: 'auth_request',
            data: { ...authReq, status: 'auto_approved' },
          });
        } else {
          console.log(`[Server] Waiting for wallet approval...`);
          // 发送给所有钱包 App
          broadcastToWallets({ type: 'auth_request', data: authReq });
        }
      }).catch(err => {
        console.error(`[Server] Failed to process intent:`, err.message);
        sendToConnection(connId, {
          type: 'error',
          data: { code: 'INTENT_ERROR', message: err.message },
        });
      });
      break;
    }

    // 钱包 App 授权响应
    case 'auth_response': {
      const response = msg.data as AuthorizationResponse;
      console.log(`[Server] Authorization response for ${response.intentId}: ${response.status}`);

      try {
        authManager.respondToRequest(response);

        if (response.status === 'approved' && response.txHash) {
          authManager.markExecuted(response.requestId, response.txHash);
        }

        // 转发给对应的 Agent
        const authReq = authManager.getRequest(response.requestId);
        if (authReq) {
          broadcastToAgents(authReq.intent.agentId, {
            type: 'auth_response',
            data: response,
          });
        }
      } catch (err: any) {
        console.error(`[Server] Failed to process auth response:`, err.message);
      }
      break;
    }

    case 'ping': {
      sendToConnection(connId, { type: 'pong' });
      break;
    }
  }
}

// ============================================================
// 消息广播
// ============================================================

function broadcastToWallets(msg: WSMessage): void {
  for (const conn of connections.values()) {
    if (conn.type === 'wallet' && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(msg));
    }
  }
}

function broadcastToAgents(agentId: string, msg: WSMessage): void {
  for (const conn of connections.values()) {
    if (conn.type === 'agent' && conn.agentId === agentId && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(msg));
    }
  }
}

function sendToConnection(connId: string, msg: WSMessage): void {
  const conn = connections.get(connId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(msg));
  }
}

// ============================================================
// REST API
// ============================================================

// 获取待处理的授权请求
app.get('/api/auth/pending', (_req, res) => {
  const pending = authManager.getPendingRequests();
  res.json({ requests: pending });
});

// 获取特定授权请求
app.get('/api/auth/:requestId', (req, res) => {
  const request = authManager.getRequest(req.params.requestId);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  res.json(request);
});

// 通过 REST 提交授权响应 (备用方式)
app.post('/api/auth/:requestId/respond', (req, res) => {
  try {
    const response: AuthorizationResponse = {
      requestId: req.params.requestId,
      intentId: req.body.intentId,
      status: req.body.status,
      signedTransaction: req.body.signedTransaction,
      txHash: req.body.txHash,
      rejectReason: req.body.rejectReason,
      respondedAt: Date.now(),
      walletAddress: req.body.walletAddress,
    };

    authManager.respondToRequest(response);

    if (response.status === 'approved' && response.txHash) {
      authManager.markExecuted(response.requestId, response.txHash);
    }

    // 通知 Agent
    const authReq = authManager.getRequest(req.params.requestId);
    if (authReq) {
      broadcastToAgents(authReq.intent.agentId, {
        type: 'auth_response',
        data: response,
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 策略管理
app.get('/api/policies', (_req, res) => {
  res.json({ policies: authManager.getPolicies() });
});

app.post('/api/policies', (req, res) => {
  try {
    const policy: Policy = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    authManager.addPolicy(policy);
    res.json({ success: true, policy });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/policies/:policyId', (req, res) => {
  authManager.removePolicy(req.params.policyId);
  res.json({ success: true });
});

// 交易历史
app.get('/api/transactions', (_req, res) => {
  res.json({ transactions: authManager.getTransactionHistory() });
});

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    connections: {
      total: connections.size,
      agents: Array.from(connections.values()).filter(c => c.type === 'agent').length,
      wallets: Array.from(connections.values()).filter(c => c.type === 'wallet').length,
    },
  });
});

// ============================================================
// 事件监听
// ============================================================

authManager.on('auth:request', (request) => {
  console.log(`\n📋 New Authorization Request:`);
  console.log(`   Intent: ${request.intentId}`);
  console.log(`   Agent: ${request.intent.agentId}`);
  console.log(`   Amount: ${request.intent.payment.displayAmount}`);
  console.log(`   To: ${request.intent.payment.to}`);
  console.log(`   Reason: ${request.intent.reason}`);
  console.log(`   ⏳ Waiting for wallet approval...\n`);
});

authManager.on('auth:approved', (response) => {
  console.log(`\n✅ Payment Approved!`);
  console.log(`   Intent: ${response.intentId}`);
  console.log(`   TxHash: ${response.txHash}\n`);
});

authManager.on('auth:rejected', (response) => {
  console.log(`\n❌ Payment Rejected!`);
  console.log(`   Intent: ${response.intentId}`);
  console.log(`   Reason: ${response.rejectReason}\n`);
});

authManager.on('auth:auto_approved', (request, policyId) => {
  console.log(`\n🤖 Auto-Approved by Policy ${policyId}`);
  console.log(`   Intent: ${request.intentId}\n`);
});

authManager.on('auth:expired', (request) => {
  console.log(`\n⏰ Authorization Expired!`);
  console.log(`   Intent: ${request.intentId}\n`);
  // 通知对应 Agent
  broadcastToAgents(request.intent.agentId, {
    type: 'auth_response',
    data: {
      requestId: request.id,
      intentId: request.intentId,
      status: 'rejected',
      rejectReason: 'Authorization request expired',
      respondedAt: Date.now(),
      walletAddress: '',
    },
  });
});

// ============================================================
// 启动服务器
// ============================================================

server.listen(PORT, () => {
  console.log(`\n🐾 OpenClaw Pay Authorization Server`);
  console.log(`   HTTP API:   http://localhost:${PORT}/api`);
  console.log(`   WebSocket:  ws://localhost:${PORT}`);
  console.log(`   Health:     http://localhost:${PORT}/api/health\n`);
});

export { app, server, wss };

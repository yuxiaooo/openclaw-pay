# 🐾 OpenClaw Pay — AI-Native Crypto Payment Protocol

> **让 AI Agent 安全支付，无需暴露私钥**

## 核心理念

AI Agent 需要支付能力，但直接将私钥交给 AI 太危险。OpenClaw Pay 协议解决了这个问题：

```
AI Agent 发起支付请求 → 协议生成授权请求 → 用户钱包 App 审批 → 钱包签名交易 → 链上执行
```

**AI Agent 永远不接触私钥**，它只能发起支付意图（PaymentIntent），由用户通过钱包 App 授权。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│  "我需要支付 0.01 ETH 给 0xABC 购买 API 服务"               │
└──────────────────────┬──────────────────────────────────────┘
                       │ PaymentIntent
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 OpenClaw Protocol                            │
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
│  支持策略:                                                   │
│  • 单笔授权 (每次审批)                                       │
│  • 预授权 (设定额度，自动审批)                                │
│  • 白名单 (信任的收款方自动通过)                              │
└─────────────────────────────────────────────────────────────┘
```

## 协议流程

### 1. 单笔授权模式 (最安全)
```
Agent → PaymentIntent → Protocol → Wallet App (用户审批) → 签名 → 上链
```

### 2. 预授权模式 (便捷)
```
用户预设: "允许 Agent 每天最多支付 0.1 ETH"
Agent → PaymentIntent → Protocol → 自动检查额度 → 签名 → 上链
```

### 3. 白名单模式
```
用户预设: "对地址 0xABC 的支付自动通过"
Agent → PaymentIntent → Protocol → 检查白名单 → 签名 → 上链
```

## 快速开始

```bash
# 安装依赖
npm install

# 启动授权服务
npm run server

# 启动钱包 App (Web UI)
npm run wallet

# 运行 Demo: AI Agent 支付流程
npm run demo
```

## 技术栈

- **协议层**: TypeScript, ethers.js
- **钱包 App**: React + WebSocket (实时授权)
- **AI Agent SDK**: TypeScript (可集成到任何 AI Agent)
- **通信**: WebSocket (实时推送授权请求)

## 安全设计

1. **私钥隔离**: 私钥仅存在于钱包 App，使用 AES-256 加密存储
2. **意图签名**: AI Agent 对 PaymentIntent 签名，防止篡改
3. **时间窗口**: 授权请求有过期时间，防止重放攻击
4. **额度控制**: 预授权模式支持金额/频率限制
5. **审计日志**: 所有支付请求和授权记录可追溯

## License

MIT

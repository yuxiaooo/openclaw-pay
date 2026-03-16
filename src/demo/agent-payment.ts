/**
 * 🐾 OpenClaw Pay Demo — AI Agent Payment Flow
 * 
 * 这个 Demo 模拟一个 AI Agent (购物助手) 需要代用户支付的场景：
 * 
 * 1. Agent 启动并连接到 OpenClaw 授权服务
 * 2. Agent 发起一笔支付请求 (PaymentIntent)
 * 3. 请求被转发到用户的钱包 App
 * 4. 用户在钱包 App 中批准/拒绝
 * 5. Agent 收到结果
 * 
 * 运行方式:
 *   终端1: npm run server    (启动授权服务)
 *   终端2: npm run wallet    (启动钱包 App, 在浏览器中打开)
 *   终端3: npm run demo      (运行此 Demo)
 */

import { OpenClawAgent } from '../agent/agent-sdk';

async function main() {
  console.log('');
  console.log('🐾 ════════════════════════════════════════════');
  console.log('   OpenClaw Pay — AI Agent Payment Demo');
  console.log('   ════════════════════════════════════════════');
  console.log('');

  // 创建 AI Agent
  const agent = new OpenClawAgent({
    agentId: 'shopping-assistant-001',
    agentName: 'AI Shopping Assistant',
    serverUrl: 'ws://localhost:3100',
    paymentTimeout: 120_000, // 2 分钟超时
  });

  try {
    // 连接到授权服务
    await agent.connect();

    console.log('');
    console.log('📋 Scenario: AI Agent needs to purchase an API key');
    console.log('   The agent will create a PaymentIntent and');
    console.log('   wait for user approval in the Wallet App.');
    console.log('');
    console.log('👉 Please open http://localhost:3101 in your browser');
    console.log('   to see the authorization request in the Wallet App.');
    console.log('');

    // 等一下让用户打开钱包
    await sleep(2000);

    // AI Agent 发起支付
    console.log('💳 Agent is requesting payment...');
    console.log('');

    const result = await agent.pay({
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: '0.001',
      currency: 'ETH',
      chainId: 11155111, // Sepolia Testnet
      reason: 'Purchase premium API access key for GPT-5 service. The user asked me to compare prices and this provider offers the best rate at $2.50/month.',
      metadata: {
        service: 'GPT-5 API',
        plan: 'premium',
        duration: '1 month',
      },
    });

    console.log('');
    console.log('═══════════════════════════════════');
    console.log('Payment Result:');
    console.log(`  Status: ${result.status}`);
    if (result.txHash) {
      console.log(`  TxHash: ${result.txHash}`);
    }
    if (result.rejectReason) {
      console.log(`  Reason: ${result.rejectReason}`);
    }
    console.log('═══════════════════════════════════');
    console.log('');

    // 再发起第二笔支付
    if (result.status === 'success') {
      console.log('💳 Agent sending another payment...');
      console.log('');

      const result2 = await agent.pay({
        to: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        amount: '0.0005',
        currency: 'ETH',
        chainId: 11155111,
        reason: 'Tip the content creator 0.0005 ETH for the excellent tutorial that helped complete the user\'s task.',
        metadata: {
          type: 'tip',
          creator: 'tutorial-author',
        },
      });

      console.log('');
      console.log('Second Payment Result:');
      console.log(`  Status: ${result2.status}`);
      if (result2.txHash) {
        console.log(`  TxHash: ${result2.txHash}`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    agent.disconnect();
    console.log('🏁 Demo completed!');
    process.exit(0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);

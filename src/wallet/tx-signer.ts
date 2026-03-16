/**
 * Transaction Signer
 * 
 * 从 PaymentIntent 构建以太坊交易并签名
 * 钱包 App 在用户授权后调用此模块
 */

import { ethers } from 'ethers';
import { PaymentIntent } from '../protocol/types';
import { KeyVault } from './key-vault';

export interface SignedTxResult {
  signedTransaction: string;
  txHash: string;
  from: string;
}

export interface TxSignerConfig {
  /** RPC 节点 URL */
  rpcUrl?: string;
  /** 默认 chain -> rpc 映射 */
  rpcUrls?: Record<number, string>;
}

// 默认 RPC URLs
const DEFAULT_RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',             // Ethereum Mainnet
  11155111: 'https://rpc.sepolia.org',       // Sepolia Testnet
  137: 'https://polygon-rpc.com',            // Polygon
  56: 'https://bsc-dataseed.binance.org',    // BSC
  42161: 'https://arb1.arbitrum.io/rpc',     // Arbitrum
  10: 'https://mainnet.optimism.io',         // Optimism
};

/** ERC20 Transfer ABI */
const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
];

export class TxSigner {
  private keyVault: KeyVault;
  private rpcUrls: Record<number, string>;

  constructor(keyVault: KeyVault, config?: TxSignerConfig) {
    this.keyVault = keyVault;
    this.rpcUrls = { ...DEFAULT_RPC_URLS, ...config?.rpcUrls };
  }

  /**
   * 从 PaymentIntent 构建并签名交易
   */
  async signIntent(intent: PaymentIntent, fromAddress: string): Promise<SignedTxResult> {
    const provider = this.getProvider(intent.payment.chainId);
    const nonce = await provider.getTransactionCount(fromAddress, 'pending');
    const feeData = await provider.getFeeData();

    let tx: ethers.TransactionLike;

    if (intent.payment.tokenAddress) {
      // ERC20 Token 转账
      tx = await this.buildERC20Transfer(intent, fromAddress, nonce, feeData);
    } else if (intent.payment.data) {
      // 合约调用
      tx = this.buildContractCall(intent, fromAddress, nonce, feeData);
    } else {
      // 原生币转账 (ETH, MATIC, BNB, etc.)
      tx = this.buildNativeTransfer(intent, fromAddress, nonce, feeData);
    }

    // 使用 KeyVault 签名
    const signedTx = await this.keyVault.signTransaction(fromAddress, tx);

    // 计算交易哈希
    const txHash = ethers.keccak256(signedTx);

    return {
      signedTransaction: signedTx,
      txHash,
      from: fromAddress,
    };
  }

  /**
   * 广播已签名的交易
   */
  async broadcastTransaction(chainId: number, signedTx: string): Promise<string> {
    const provider = this.getProvider(chainId);
    const txResponse = await provider.broadcastTransaction(signedTx);
    return txResponse.hash;
  }

  /**
   * 构建原生币转账交易
   */
  private buildNativeTransfer(
    intent: PaymentIntent,
    from: string,
    nonce: number,
    feeData: ethers.FeeData,
  ): ethers.TransactionLike {
    return {
      type: 2, // EIP-1559
      chainId: intent.payment.chainId,
      to: intent.payment.to,
      value: BigInt(intent.payment.value),
      nonce,
      maxFeePerGas: intent.payment.maxFeePerGas
        ? BigInt(intent.payment.maxFeePerGas)
        : feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: intent.payment.maxPriorityFeePerGas
        ? BigInt(intent.payment.maxPriorityFeePerGas)
        : feeData.maxPriorityFeePerGas ?? undefined,
      gasLimit: intent.payment.gasLimit ? BigInt(intent.payment.gasLimit) : 21000n,
    };
  }

  /**
   * 构建 ERC20 Token 转账
   */
  private async buildERC20Transfer(
    intent: PaymentIntent,
    from: string,
    nonce: number,
    feeData: ethers.FeeData,
  ): Promise<ethers.TransactionLike> {
    const iface = new ethers.Interface(ERC20_TRANSFER_ABI);
    const data = iface.encodeFunctionData('transfer', [
      intent.payment.to,
      BigInt(intent.payment.value),
    ]);

    return {
      type: 2,
      chainId: intent.payment.chainId,
      to: intent.payment.tokenAddress!,
      value: 0n,
      data,
      nonce,
      maxFeePerGas: feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      gasLimit: intent.payment.gasLimit ? BigInt(intent.payment.gasLimit) : 100000n,
    };
  }

  /**
   * 构建合约调用
   */
  private buildContractCall(
    intent: PaymentIntent,
    from: string,
    nonce: number,
    feeData: ethers.FeeData,
  ): ethers.TransactionLike {
    return {
      type: 2,
      chainId: intent.payment.chainId,
      to: intent.payment.to,
      value: BigInt(intent.payment.value),
      data: intent.payment.data,
      nonce,
      maxFeePerGas: feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      gasLimit: intent.payment.gasLimit ? BigInt(intent.payment.gasLimit) : 200000n,
    };
  }

  /**
   * 获取 Provider
   */
  private getProvider(chainId: number): ethers.JsonRpcProvider {
    const rpcUrl = this.rpcUrls[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl, chainId);
  }
}

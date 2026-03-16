/**
 * Key Vault — 安全密钥管理
 * 
 * 私钥仅存在于此模块中，永远不会暴露给 AI Agent
 * - AES-256-GCM 加密存储
 * - 内存中使用后清除
 */

import { ethers } from 'ethers';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface EncryptedKey {
  /** 加密后的私钥 */
  ciphertext: string;
  /** 初始化向量 */
  iv: string;
  /** 认证标签 */
  authTag: string;
  /** 盐 */
  salt: string;
  /** 钱包地址 */
  address: string;
}

interface KeyStore {
  version: 1;
  keys: EncryptedKey[];
}

export class KeyVault {
  private keyStorePath: string;
  private masterKey: Buffer | null = null;

  constructor(storePath?: string) {
    this.keyStorePath = storePath ?? path.join(process.cwd(), '.openclaw', 'keystore.json');
  }

  /**
   * 用密码解锁 Vault
   */
  unlock(password: string): void {
    const salt = this.getOrCreateSalt();
    this.masterKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  }

  /**
   * 锁定 Vault
   */
  lock(): void {
    if (this.masterKey) {
      this.masterKey.fill(0); // 安全清除
      this.masterKey = null;
    }
  }

  /**
   * 生成新钱包
   */
  async createWallet(password?: string): Promise<{ address: string; mnemonic: string }> {
    if (password) {
      this.unlock(password);
    }
    this.ensureUnlocked();

    const wallet = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic?.phrase;
    if (!mnemonic) throw new Error('Failed to generate mnemonic');

    await this.storeKey(wallet.privateKey, wallet.address);

    return {
      address: wallet.address,
      mnemonic,
    };
  }

  /**
   * 从助记词导入钱包
   */
  async importFromMnemonic(mnemonic: string, password?: string): Promise<string> {
    if (password) {
      this.unlock(password);
    }
    this.ensureUnlocked();

    const wallet = ethers.Wallet.fromPhrase(mnemonic);
    await this.storeKey(wallet.privateKey, wallet.address);
    return wallet.address;
  }

  /**
   * 从私钥导入
   */
  async importFromPrivateKey(privateKey: string, password?: string): Promise<string> {
    if (password) {
      this.unlock(password);
    }
    this.ensureUnlocked();

    const wallet = new ethers.Wallet(privateKey);
    await this.storeKey(wallet.privateKey, wallet.address);
    return wallet.address;
  }

  /**
   * 获取所有钱包地址
   */
  getAddresses(): string[] {
    const store = this.loadKeyStore();
    return store.keys.map(k => k.address);
  }

  /**
   * 签名消息
   */
  async signMessage(address: string, message: string): Promise<string> {
    const wallet = await this.getWallet(address);
    try {
      return await wallet.signMessage(message);
    } finally {
      // 使用后无法真正清除 JS 中的字符串，但至少不保留引用
    }
  }

  /**
   * 签名交易
   */
  async signTransaction(address: string, tx: ethers.TransactionLike): Promise<string> {
    const wallet = await this.getWallet(address);
    return await wallet.signTransaction(tx);
  }

  /**
   * 获取钱包实例 (内部使用)
   */
  private async getWallet(address: string): Promise<ethers.Wallet> {
    this.ensureUnlocked();

    const store = this.loadKeyStore();
    const encKey = store.keys.find(k => k.address.toLowerCase() === address.toLowerCase());
    if (!encKey) {
      throw new Error(`No key found for address: ${address}`);
    }

    const privateKey = this.decrypt(encKey);
    return new ethers.Wallet(privateKey);
  }

  /**
   * 存储加密的密钥
   */
  private async storeKey(privateKey: string, address: string): Promise<void> {
    this.ensureUnlocked();

    const store = this.loadKeyStore();

    // 检查是否已存在
    if (store.keys.some(k => k.address.toLowerCase() === address.toLowerCase())) {
      return; // 已存在，不重复添加
    }

    const encrypted = this.encrypt(privateKey);
    store.keys.push({
      ...encrypted,
      address,
    });

    this.saveKeyStore(store);
  }

  /**
   * AES-256-GCM 加密
   */
  private encrypt(plaintext: string): Omit<EncryptedKey, 'address'> {
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(16);

    // 从 masterKey 派生加密密钥
    const key = crypto.pbkdf2Sync(this.masterKey!, salt, 10000, 32, 'sha256');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag,
      salt: salt.toString('hex'),
    };
  }

  /**
   * AES-256-GCM 解密
   */
  private decrypt(encKey: EncryptedKey): string {
    const iv = Buffer.from(encKey.iv, 'hex');
    const salt = Buffer.from(encKey.salt, 'hex');
    const authTag = Buffer.from(encKey.authTag, 'hex');

    const key = crypto.pbkdf2Sync(this.masterKey!, salt, 10000, 32, 'sha256');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(encKey.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  private ensureUnlocked(): void {
    if (!this.masterKey) {
      throw new Error('KeyVault is locked. Call unlock() first.');
    }
  }

  private loadKeyStore(): KeyStore {
    try {
      if (fs.existsSync(this.keyStorePath)) {
        const data = fs.readFileSync(this.keyStorePath, 'utf8');
        return JSON.parse(data);
      }
    } catch {
      // 文件损坏，重建
    }
    return { version: 1, keys: [] };
  }

  private saveKeyStore(store: KeyStore): void {
    const dir = path.dirname(this.keyStorePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.keyStorePath, JSON.stringify(store, null, 2), 'utf8');
  }

  private getOrCreateSalt(): Buffer {
    const saltPath = this.keyStorePath + '.salt';
    try {
      if (fs.existsSync(saltPath)) {
        return Buffer.from(fs.readFileSync(saltPath, 'utf8'), 'hex');
      }
    } catch {
      // 重建
    }
    const salt = crypto.randomBytes(32);
    const dir = path.dirname(saltPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(saltPath, salt.toString('hex'), 'utf8');
    return salt;
  }
}

import type { Message, Config } from '../types.js';
import { ContextCompressor } from './context-compressor.js';

/**
 * Session memory layer: in-memory messages[] with context window management.
 * SPEC: 会话记忆——单次运行，messages[] + 上下文窗口管理
 */
export class SessionMemory {
  private messages: Message[] = [];
  private compressor: ContextCompressor;

  constructor(config: Config) {
    this.compressor = new ContextCompressor(
      config.llm.maxTokens,
      config.agent.contextThreshold,
    );
  }

  /**
   * Add a message and auto-trigger compression if threshold exceeded.
   */
  addMessage(message: Message): void {
    this.messages.push(message);
    this.maybeCompress();
  }

  /**
   * Get all current messages (compressed if threshold exceeded).
   */
  getMessages(): Message[] {
    return this.compressor.compress(this.messages);
  }

  /**
   * Get raw messages without compression logic (for inspection).
   */
  getRawMessages(): Message[] {
    return this.messages;
  }

  /**
   * Get current estimated token count.
   */
  getTokenCount(): number {
    return this.compressor.estimateTokens(this.messages);
  }

  /**
   * Check if compression is currently needed.
   */
  needsCompression(): boolean {
    return this.compressor.needsCompression(this.messages);
  }

  /**
   * Compress and persist the compressed state.
   */
  compressNow(): void {
    this.messages = this.compressor.compress(this.messages);
  }

  /**
   * Internal: auto-compress when threshold is exceeded.
   */
  private maybeCompress(): void {
    if (this.compressor.needsCompression(this.messages)) {
      this.messages = this.compressor.compress(this.messages);
    }
  }
}

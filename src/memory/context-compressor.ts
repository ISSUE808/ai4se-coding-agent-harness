import type { Message } from '../types.js';

export class ContextCompressor {
  private readonly recentRounds: number = 8;

  constructor(
    private readonly maxTokens: number,
    private readonly contextThreshold: number,
  ) {}

  /**
   * Estimate token count using deterministic character-length / 4.
   * SPEC: "用简单的字符数/4 近似（确定性算法）"
   */
  estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    return Math.floor(totalChars / 4);
  }

  /**
   * Check whether token count exceeds threshold.
   * Threshold is a fraction of maxTokens (e.g., 0.8 means 80% of maxTokens).
   */
  needsCompression(messages: Message[]): boolean {
    return this.estimateTokens(messages) > this.maxTokens * this.contextThreshold;
  }

  /**
   * Compress messages by replacing content of old, non-important messages
   * with "[Compressed]" and marking compressed: true.
   *
   * Rules:
   * - Only compress when token threshold is exceeded
   * - Messages in the most recent 8 rounds keep full text
   * - Messages with metadata.important === true are never compressed
   * - Compressed messages get content = "[Compressed]", metadata.compressed = true
   */
  compress(messages: Message[]): Message[] {
    if (!this.needsCompression(messages)) {
      return messages;
    }

    const maxRound = this.getMaxRound(messages);
    // All rounds are "recent" if total rounds <= recentRounds
    if (maxRound <= this.recentRounds) {
      return messages;
    }

    const cutoffRound = maxRound - this.recentRounds;
    // Messages in rounds > cutoffRound are recent (keep full text)
    // Messages in rounds <= cutoffRound are old (candidate for compression)

    const roundAssignments = this.getRoundAssignments(messages);

    return messages.map((msg, i) => {
      const round = roundAssignments[i];
      const isRecent = round > cutoffRound;
      const isImportant = msg.metadata?.important === true;

      if (isRecent || isImportant) {
        return msg;
      }

      // Compress this message
      return {
        ...msg,
        content: '[Compressed]',
        metadata: {
          ...msg.metadata,
          compressed: true,
        },
      };
    });
  }

  /**
   * Assign each message to a round number.
   * Each assistant message increments the round counter.
   * Messages before the first assistant are round 1.
   */
  private getRoundAssignments(messages: Message[]): number[] {
    const rounds: number[] = [];
    let round = 1;
    let hasSeenAssistant = false;
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (hasSeenAssistant) {
          round++;
        }
        hasSeenAssistant = true;
      }
      rounds.push(round);
    }
    return rounds;
  }

  /**
   * Get the maximum round number in messages.
   */
  private getMaxRound(messages: Message[]): number {
    const rounds = this.getRoundAssignments(messages);
    if (rounds.length === 0) return 0;
    return Math.max(...rounds);
  }
}

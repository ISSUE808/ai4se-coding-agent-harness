import type { LLMProvider, LLMResponse, Message, Tool } from '../types.js';

export class MockProvider implements LLMProvider {
  private responses: LLMResponse[];
  private index: number;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
    this.index = 0;
  }

  get remaining(): number {
    return this.responses.length - this.index;
  }

  async complete(_messages: Message[], _tools: Tool[]): Promise<LLMResponse> {
    if (this.index >= this.responses.length) {
      throw new Error('MockProvider: no more responses available');
    }
    return this.responses[this.index++];
  }
}

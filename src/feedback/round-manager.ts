export class RoundManager {
  readonly maxRounds: number;
  private _currentRound: number;

  /**
   * @param maxRounds 0 means unlimited (no round cap); negative values are
   * rejected — a hard cap is the harness's runaway-loop guardrail.
   */
  constructor(maxRounds: number) {
    if (maxRounds < 0) {
      throw new Error(`maxRounds must be >= 0 (0 = unlimited), got ${maxRounds}`);
    }
    this.maxRounds = maxRounds;
    this._currentRound = 1;
  }

  get currentRound(): number {
    return this._currentRound;
  }

  nextRound(): void {
    this._currentRound++;
  }

  shouldUpgrade(): boolean {
    return this.maxRounds === 0 ? false : this._currentRound > this.maxRounds;
  }

  reset(): void {
    this._currentRound = 1;
  }
}

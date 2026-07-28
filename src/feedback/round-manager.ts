export class RoundManager {
  readonly maxRounds: number;
  private _currentRound: number;

  constructor(maxRounds: number) {
    if (maxRounds < 1) {
      throw new Error(`maxRounds must be >= 1, got ${maxRounds}`);
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
    return this._currentRound > this.maxRounds;
  }

  reset(): void {
    this._currentRound = 1;
  }
}

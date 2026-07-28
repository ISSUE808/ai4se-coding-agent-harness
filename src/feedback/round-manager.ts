export class RoundManager {
  readonly maxRounds: number;
  currentRound: number;

  constructor(maxRounds: number) {
    this.maxRounds = maxRounds;
    this.currentRound = 1;
  }

  nextRound(): void {
    this.currentRound++;
  }

  shouldUpgrade(): boolean {
    return this.currentRound > this.maxRounds;
  }

  reset(): void {
    this.currentRound = 1;
  }
}

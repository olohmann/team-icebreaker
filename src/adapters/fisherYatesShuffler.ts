import { randomInt } from "node:crypto";
import type { Shuffler } from "../domain/ports";

/** Fisher-Yates shuffle using crypto-grade randomness. */
export class FisherYatesShuffler implements Shuffler {
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

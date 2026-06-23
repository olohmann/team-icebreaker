import { describe, expect, it } from "vitest";
import type { Card } from "../../src/domain/types";
import {
  clampStep,
  nextStep,
  orderCards,
  prevStep,
  revealView,
  totalSteps,
} from "../../src/domain/reveal";

function card(participantId: string, name: string, statement: string): Card {
  return { participantId, name, statement, createdAt: "t", updatedAt: "t" };
}

const cards: Card[] = [
  card("p1", "Alice", "loves climbing"),
  card("p2", "Bob", "has 3 cats"),
];

describe("step arithmetic", () => {
  it("computes total steps as two per card", () => {
    expect(totalSteps(0)).toBe(0);
    expect(totalSteps(2)).toBe(4);
  });

  it("clamps steps into [0, 2n]", () => {
    expect(clampStep(-5, 2)).toBe(0);
    expect(clampStep(99, 2)).toBe(4);
    expect(clampStep(3, 2)).toBe(3);
    expect(clampStep(NaN, 2)).toBe(0);
  });

  it("steps forward and back within bounds", () => {
    expect(nextStep(0, 2)).toBe(1);
    expect(nextStep(4, 2)).toBe(4);
    expect(prevStep(1, 2)).toBe(0);
    expect(prevStep(0, 2)).toBe(0);
  });
});

describe("revealView (staged, no peeking)", () => {
  it("reveals nothing at step 0", () => {
    expect(revealView(cards, 0)).toEqual({
      totalCards: 2,
      step: 0,
      index: -1,
      statement: null,
      name: null,
      done: false,
    });
  });

  it("reveals the first statement but not the name at step 1", () => {
    const v = revealView(cards, 1);
    expect(v.index).toBe(0);
    expect(v.statement).toBe("loves climbing");
    expect(v.name).toBeNull();
    expect(v.done).toBe(false);
  });

  it("reveals the first name at step 2", () => {
    const v = revealView(cards, 2);
    expect(v.index).toBe(0);
    expect(v.statement).toBe("loves climbing");
    expect(v.name).toBe("Alice");
  });

  it("moves to the second card's statement at step 3 and hides its name", () => {
    const v = revealView(cards, 3);
    expect(v.index).toBe(1);
    expect(v.statement).toBe("has 3 cats");
    expect(v.name).toBeNull();
  });

  it("is done after the final name at step 4", () => {
    const v = revealView(cards, 4);
    expect(v.name).toBe("Bob");
    expect(v.done).toBe(true);
  });

  it("never exposes a card other than the current one", () => {
    // At step 1 only the first card's statement is present anywhere in the view.
    const v = revealView(cards, 1);
    expect(JSON.stringify(v)).not.toContain("Bob");
    expect(JSON.stringify(v)).not.toContain("has 3 cats");
  });
});

describe("orderCards", () => {
  it("orders cards by revealOrder and drops unknown ids", () => {
    const ordered = orderCards(["p2", "p1", "ghost"], cards);
    expect(ordered.map((c) => c.participantId)).toEqual(["p2", "p1"]);
  });
});

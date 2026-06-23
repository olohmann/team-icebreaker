import type { Card, RevealView } from "./types";

/** Total number of linear steps for n cards (statement + name each). */
export function totalSteps(n: number): number {
  return n * 2;
}

export function clampStep(step: number, n: number): number {
  const max = totalSteps(n);
  if (Number.isNaN(step)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(step)));
}

export function nextStep(step: number, n: number): number {
  return clampStep(step + 1, n);
}

export function prevStep(step: number, n: number): number {
  return clampStep(step - 1, n);
}

/**
 * Projects the reveal state into exactly what the master is allowed to see.
 * Only the current card's content is ever exposed, and the name only once its
 * step is reached — so nobody (not even the owner) can peek ahead.
 *
 * @param orderedCards cards ordered by the session's revealOrder.
 */
export function revealView(orderedCards: readonly Card[], step: number): RevealView {
  const totalCards = orderedCards.length;
  const s = clampStep(step, totalCards);

  if (s <= 0) {
    return { totalCards, step: s, index: -1, statement: null, name: null, done: false };
  }

  const index = Math.floor((s - 1) / 2);
  const card = orderedCards[index];
  const nameStep = 2 * index + 2;
  const showName = s >= nameStep;

  return {
    totalCards,
    step: s,
    index,
    statement: card ? card.statement : null,
    name: card && showName ? card.name : null,
    done: s >= totalSteps(totalCards),
  };
}

/** Orders the cards according to revealOrder, ignoring ids with no card. */
export function orderCards(revealOrder: readonly string[], cards: readonly Card[]): Card[] {
  const byId = new Map(cards.map((c) => [c.participantId, c]));
  const ordered: Card[] = [];
  for (const id of revealOrder) {
    const c = byId.get(id);
    if (c) ordered.push(c);
  }
  return ordered;
}

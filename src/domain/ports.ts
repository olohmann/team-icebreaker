import type { Card, RevealUpdate, Session } from "./types";

/**
 * Persistence port. Adapters: InMemorySessionStore (tests/dev),
 * TableStorageSessionStore (Azure). Kept deliberately small so it is easy to
 * mock in London-school unit tests and to satisfy in a shared contract test.
 */
export interface SessionStore {
  createSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getCard(sessionId: string, participantId: string): Promise<Card | undefined>;
  listCards(sessionId: string): Promise<Card[]>;
  countCards(sessionId: string): Promise<number>;
  upsertCard(sessionId: string, card: Card): Promise<void>;
  updateReveal(sessionId: string, update: RevealUpdate): Promise<void>;
}

export interface Clock {
  /** Current time as an ISO-8601 string. */
  now(): string;
}

export interface IdGenerator {
  newSessionId(): string;
  newOwnerToken(): string;
}

export interface Shuffler {
  /** Returns a new array with the items in random order. */
  shuffle<T>(items: readonly T[]): T[];
}

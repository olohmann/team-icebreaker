import type { SessionStore } from "../domain/ports";
import type { Card, RevealUpdate, Session } from "../domain/types";

/** In-memory SessionStore for tests, the acceptance suite and local dev. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly cards = new Map<string, Map<string, Card>>();

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, clone(session));
    this.cards.set(session.sessionId, new Map());
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const s = this.sessions.get(sessionId);
    return s ? clone(s) : undefined;
  }

  async getCard(sessionId: string, participantId: string): Promise<Card | undefined> {
    const c = this.cards.get(sessionId)?.get(participantId);
    return c ? clone(c) : undefined;
  }

  async listCards(sessionId: string): Promise<Card[]> {
    return [...(this.cards.get(sessionId)?.values() ?? [])].map(clone);
  }

  async countCards(sessionId: string): Promise<number> {
    return this.cards.get(sessionId)?.size ?? 0;
  }

  async upsertCard(sessionId: string, card: Card): Promise<void> {
    const bucket = this.cards.get(sessionId);
    if (!bucket) throw new Error(`Unknown session ${sessionId}`);
    bucket.set(card.participantId, clone(card));
  }

  async updateReveal(sessionId: string, update: RevealUpdate): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    session.phase = update.phase;
    session.revealOrder = [...update.revealOrder];
    session.revealStep = update.revealStep;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

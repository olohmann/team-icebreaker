import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { Clock, IdGenerator, SessionStore, Shuffler } from "./ports";
import { nextStep, orderCards, prevStep, revealView } from "./reveal";
import type { Card, MasterState, ParticipantState, Session } from "./types";

export const NAME_MAX = 80;
export const STATEMENT_MAX = 280;
export const TITLE_MAX = 140;
const PARTICIPANT_ID_MAX = 200;

export interface CreateSessionResult {
  sessionId: string;
  ownerToken: string;
}

export interface SubmitCardInput {
  participantId: string;
  name: string;
  statement: string;
}

/**
 * Application use-cases. Depends only on ports so it can be driven entirely with
 * test doubles (London-school). Holds no Azure or HTTP concerns.
 */
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly shuffler: Shuffler,
  ) {}

  async createSession(input: { title?: string } = {}): Promise<CreateSessionResult> {
    const sessionId = this.ids.newSessionId();
    const ownerToken = this.ids.newOwnerToken();
    const session: Session = {
      sessionId,
      ownerToken,
      title: sanitizeTitle(input.title),
      phase: "collect",
      revealOrder: [],
      revealStep: 0,
      createdAt: this.clock.now(),
    };
    await this.store.createSession(session);
    return { sessionId, ownerToken };
  }

  async submitCard(sessionId: string, input: SubmitCardInput): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.phase !== "collect") {
      throw new ConflictError("Submissions are closed");
    }
    const participantId = requireField(input.participantId, "participantId", PARTICIPANT_ID_MAX);
    const name = requireField(input.name, "name", NAME_MAX);
    const statement = requireField(input.statement, "statement", STATEMENT_MAX);

    const existing = await this.store.getCard(sessionId, participantId);
    const now = this.clock.now();
    const card: Card = {
      participantId,
      name,
      statement,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.upsertCard(sessionId, card);
  }

  async getParticipantState(
    sessionId: string,
    participantId: string | undefined,
  ): Promise<ParticipantState> {
    const session = await this.requireSession(sessionId);
    let card: ParticipantState["card"];
    if (participantId) {
      const existing = await this.store.getCard(sessionId, participantId);
      if (existing) card = { name: existing.name, statement: existing.statement };
    }
    return {
      phase: session.phase,
      submissionsOpen: session.phase === "collect",
      title: session.title,
      card,
    };
  }

  async getMasterState(sessionId: string, ownerToken: string | undefined): Promise<MasterState> {
    const session = await this.requireOwner(sessionId, ownerToken);
    if (session.phase === "collect") {
      // Blind master: only a count, never names or statements.
      const submittedCount = await this.store.countCards(sessionId);
      return { phase: "collect", title: session.title, submittedCount };
    }
    const cards = await this.store.listCards(sessionId);
    const ordered = orderCards(session.revealOrder, cards);
    const view = revealView(ordered, session.revealStep);
    return { phase: "reveal", title: session.title, ...view };
  }

  async startReveal(sessionId: string, ownerToken: string | undefined): Promise<void> {
    const session = await this.requireOwner(sessionId, ownerToken);
    if (session.phase !== "collect") {
      throw new ConflictError("Reveal has already started");
    }
    const cards = await this.store.listCards(sessionId);
    if (cards.length === 0) {
      throw new ConflictError("There are no cards to reveal");
    }
    const revealOrder = this.shuffler.shuffle(cards.map((c) => c.participantId));
    await this.store.updateReveal(sessionId, { phase: "reveal", revealOrder, revealStep: 0 });
  }

  async stepReveal(
    sessionId: string,
    ownerToken: string | undefined,
    direction: "next" | "back",
  ): Promise<void> {
    const session = await this.requireOwner(sessionId, ownerToken);
    if (session.phase !== "reveal") {
      throw new ConflictError("The reveal has not started yet");
    }
    const n = session.revealOrder.length;
    const revealStep =
      direction === "next" ? nextStep(session.revealStep, n) : prevStep(session.revealStep, n);
    await this.store.updateReveal(sessionId, {
      phase: "reveal",
      revealOrder: session.revealOrder,
      revealStep,
    });
  }

  async resetReveal(sessionId: string, ownerToken: string | undefined): Promise<void> {
    await this.requireOwner(sessionId, ownerToken);
    await this.store.updateReveal(sessionId, { phase: "collect", revealOrder: [], revealStep: 0 });
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = await this.store.getSession(sessionId);
    if (!session) throw new NotFoundError("Session not found");
    return session;
  }

  private async requireOwner(sessionId: string, ownerToken: string | undefined): Promise<Session> {
    const session = await this.requireSession(sessionId);
    if (!ownerToken || ownerToken !== session.ownerToken) {
      throw new ForbiddenError("Invalid owner token");
    }
    return session;
  }
}

function requireField(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new ValidationError(`${field} is required`);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return trimmed;
}

function sanitizeTitle(title: unknown): string | undefined {
  if (typeof title !== "string") return undefined;
  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, TITLE_MAX) : undefined;
}

import { describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator, SessionStore, Shuffler } from "../../src/domain/ports";
import { SessionService } from "../../src/domain/sessionService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../src/domain/errors";
import type { Card, Session } from "../../src/domain/types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "S1",
    ownerToken: "OWNER",
    title: "Favourite movie?",
    phase: "collect",
    revealOrder: [],
    revealStep: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCard(participantId: string, name: string, statement: string): Card {
  return { participantId, name, statement, createdAt: "OLD", updatedAt: "OLD" };
}

/** Builds fully-mocked ports so we can assert on interactions (London school). */
function makeDoubles() {
  const store: { [K in keyof SessionStore]: ReturnType<typeof vi.fn> } = {
    createSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(undefined),
    getCard: vi.fn().mockResolvedValue(undefined),
    listCards: vi.fn().mockResolvedValue([]),
    countCards: vi.fn().mockResolvedValue(0),
    upsertCard: vi.fn().mockResolvedValue(undefined),
    updateReveal: vi.fn().mockResolvedValue(undefined),
  };
  const clock: { now: ReturnType<typeof vi.fn> } = { now: vi.fn().mockReturnValue("NOW") };
  const ids = {
    newSessionId: vi.fn().mockReturnValue("S1"),
    newOwnerToken: vi.fn().mockReturnValue("OWNER"),
  };
  const shuffler = { shuffle: vi.fn((items: unknown[]) => [...items].reverse()) };
  const service = new SessionService(
    store as unknown as SessionStore,
    clock as unknown as Clock,
    ids as unknown as IdGenerator,
    shuffler as unknown as Shuffler,
  );
  return { service, store, clock, ids, shuffler };
}

describe("createSession", () => {
  it("persists a fresh collect-phase session and returns its ids", async () => {
    const { service, store, ids } = makeDoubles();

    const result = await service.createSession({ title: "  Favourite movie?  " });

    expect(result).toEqual({ sessionId: "S1", ownerToken: "OWNER" });
    expect(ids.newSessionId).toHaveBeenCalledTimes(1);
    expect(ids.newOwnerToken).toHaveBeenCalledTimes(1);
    expect(store.createSession).toHaveBeenCalledWith({
      sessionId: "S1",
      ownerToken: "OWNER",
      title: "Favourite movie?",
      phase: "collect",
      revealOrder: [],
      revealStep: 0,
      createdAt: "NOW",
    });
  });
});

describe("submitCard", () => {
  it("upserts a new card stamped with the clock", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());

    await service.submitCard("S1", { participantId: "p1", name: "Alice", statement: "climbs" });

    expect(store.upsertCard).toHaveBeenCalledWith("S1", {
      participantId: "p1",
      name: "Alice",
      statement: "climbs",
      createdAt: "NOW",
      updatedAt: "NOW",
    });
  });

  it("preserves createdAt when editing an existing card", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());
    store.getCard.mockResolvedValue(makeCard("p1", "Alice", "old"));

    await service.submitCard("S1", { participantId: "p1", name: "Alice", statement: "new" });

    expect(store.upsertCard).toHaveBeenCalledWith(
      "S1",
      expect.objectContaining({ createdAt: "OLD", updatedAt: "NOW", statement: "new" }),
    );
  });

  it("rejects submissions once the reveal has started without touching the store", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession({ phase: "reveal" }));

    await expect(
      service.submitCard("S1", { participantId: "p1", name: "Alice", statement: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.upsertCard).not.toHaveBeenCalled();
  });

  it("validates required fields", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());

    await expect(
      service.submitCard("S1", { participantId: "p1", name: "  ", statement: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.upsertCard).not.toHaveBeenCalled();
  });

  it("fails when the session does not exist", async () => {
    const { service } = makeDoubles();
    await expect(
      service.submitCard("missing", { participantId: "p1", name: "A", statement: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getMasterState (blind during collect)", () => {
  it("returns only a count during collect and never reads card content", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());
    store.countCards.mockResolvedValue(3);

    const state = await service.getMasterState("S1", "OWNER");

    expect(state).toEqual({ phase: "collect", title: "Favourite movie?", submittedCount: 3 });
    expect(store.listCards).not.toHaveBeenCalled();
  });

  it("rejects a wrong owner token", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());

    await expect(service.getMasterState("S1", "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("projects the staged reveal view during reveal", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(
      makeSession({ phase: "reveal", revealOrder: ["p2", "p1"], revealStep: 1 }),
    );
    store.listCards.mockResolvedValue([
      makeCard("p1", "Alice", "climbs"),
      makeCard("p2", "Bob", "has cats"),
    ]);

    const state = await service.getMasterState("S1", "OWNER");

    // Step 1 reveals the first card in revealOrder (p2 = Bob) statement only.
    expect(state).toMatchObject({ phase: "reveal", index: 0, statement: "has cats", name: null });
  });
});

describe("startReveal", () => {
  it("shuffles participant ids and persists the reveal order", async () => {
    const { service, store, shuffler } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());
    store.listCards.mockResolvedValue([makeCard("p1", "A", "x"), makeCard("p2", "B", "y")]);

    await service.startReveal("S1", "OWNER");

    expect(shuffler.shuffle).toHaveBeenCalledWith(["p1", "p2"]);
    expect(store.updateReveal).toHaveBeenCalledWith("S1", {
      phase: "reveal",
      revealOrder: ["p2", "p1"],
      revealStep: 0,
    });
  });

  it("refuses to start with no cards", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());
    store.listCards.mockResolvedValue([]);

    await expect(service.startReveal("S1", "OWNER")).rejects.toBeInstanceOf(ConflictError);
    expect(store.updateReveal).not.toHaveBeenCalled();
  });
});

describe("stepReveal", () => {
  it("advances the step forward, clamped to the collaborators' state", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(
      makeSession({ phase: "reveal", revealOrder: ["p1", "p2"], revealStep: 0 }),
    );

    await service.stepReveal("S1", "OWNER", "next");

    expect(store.updateReveal).toHaveBeenCalledWith("S1", {
      phase: "reveal",
      revealOrder: ["p1", "p2"],
      revealStep: 1,
    });
  });

  it("steps back without going below zero", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(
      makeSession({ phase: "reveal", revealOrder: ["p1", "p2"], revealStep: 0 }),
    );

    await service.stepReveal("S1", "OWNER", "back");

    expect(store.updateReveal).toHaveBeenCalledWith(
      "S1",
      expect.objectContaining({ revealStep: 0 }),
    );
  });
});

describe("getParticipantState", () => {
  it("returns the caller's own card only", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession());
    store.getCard.mockResolvedValue(makeCard("p1", "Alice", "climbs"));

    const state = await service.getParticipantState("S1", "p1");

    expect(state).toEqual({
      phase: "collect",
      submissionsOpen: true,
      title: "Favourite movie?",
      card: { name: "Alice", statement: "climbs" },
    });
  });

  it("reports closed submissions during reveal", async () => {
    const { service, store } = makeDoubles();
    store.getSession.mockResolvedValue(makeSession({ phase: "reveal" }));

    const state = await service.getParticipantState("S1", undefined);

    expect(state.submissionsOpen).toBe(false);
    expect(store.getCard).not.toHaveBeenCalled();
  });
});

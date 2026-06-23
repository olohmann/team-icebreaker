import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../src/adapters/inMemoryStore";
import { SystemClock } from "../../src/adapters/systemClock";
import { CryptoIdGenerator } from "../../src/adapters/cryptoIdGenerator";
import type { Shuffler } from "../../src/domain/ports";
import { SessionService } from "../../src/domain/sessionService";

/** Deterministic shuffler so the acceptance flow is predictable. */
const identityShuffler: Shuffler = { shuffle: (items) => [...items] };

function makeService() {
  return new SessionService(
    new InMemorySessionStore(),
    new SystemClock(),
    new CryptoIdGenerator(),
    identityShuffler,
  );
}

describe("icebreaker meeting flow", () => {
  it("runs the full lifecycle: collect blind, then staged reveal", async () => {
    const service = makeService();

    // Owner starts a session.
    const { sessionId, ownerToken } = await service.createSession({ title: "Favourite movie?" });

    // Three participants each submit exactly one card via the join link.
    await service.submitCard(sessionId, { participantId: "a", name: "Alice", statement: "Amelie" });
    await service.submitCard(sessionId, { participantId: "b", name: "Bob", statement: "Heat" });
    await service.submitCard(sessionId, { participantId: "c", name: "Cara", statement: "Dune" });

    // A participant edits their single card; still one card total.
    await service.submitCard(sessionId, { participantId: "b", name: "Bob", statement: "The Matrix" });

    // The master is blind during collect: count only, no names or statements.
    const collect = await service.getMasterState(sessionId, ownerToken);
    expect(collect).toEqual({ phase: "collect", title: "Favourite movie?", submittedCount: 3 });

    // A participant sees only their own card.
    const bobState = await service.getParticipantState(sessionId, "b");
    expect(bobState.card).toEqual({ name: "Bob", statement: "The Matrix" });

    // Owner starts the reveal. Submissions are now closed.
    await service.startReveal(sessionId, ownerToken);
    await expect(
      service.submitCard(sessionId, { participantId: "d", name: "Dan", statement: "late" }),
    ).rejects.toThrow();

    // Step 1: first card's statement, no name yet (the room guesses).
    await service.stepReveal(sessionId, ownerToken, "next");
    let view = await service.getMasterState(sessionId, ownerToken);
    expect(view).toMatchObject({ phase: "reveal", index: 0, statement: "Amelie", name: null });

    // Step 2: the name is revealed.
    await service.stepReveal(sessionId, ownerToken, "next");
    view = await service.getMasterState(sessionId, ownerToken);
    expect(view).toMatchObject({ statement: "Amelie", name: "Alice" });

    // Mis-click recovery: step back to hide the name again.
    await service.stepReveal(sessionId, ownerToken, "back");
    view = await service.getMasterState(sessionId, ownerToken);
    expect(view).toMatchObject({ statement: "Amelie", name: null });

    // Walk to the very end.
    for (let i = 0; i < 10; i++) await service.stepReveal(sessionId, ownerToken, "next");
    view = await service.getMasterState(sessionId, ownerToken);
    expect(view).toMatchObject({ done: true, statement: "Dune", name: "Cara" });
  });

  it("forbids reveal control with the wrong token", async () => {
    const service = makeService();
    const { sessionId } = await service.createSession();
    await service.submitCard(sessionId, { participantId: "a", name: "A", statement: "x" });

    await expect(service.startReveal(sessionId, "not-the-owner")).rejects.toThrow();
    await expect(service.getMasterState(sessionId, "not-the-owner")).rejects.toThrow();
  });
});

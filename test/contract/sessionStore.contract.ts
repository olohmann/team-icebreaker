import { expect, it } from "vitest";
import type { SessionStore } from "../../src/domain/ports";
import type { Card, Session } from "../../src/domain/types";

function session(id: string): Session {
  return {
    sessionId: id,
    ownerToken: `${id}-owner`,
    title: "Prompt",
    phase: "collect",
    revealOrder: [],
    revealStep: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function card(participantId: string, statement: string): Card {
  return {
    participantId,
    name: `name-${participantId}`,
    statement,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

/**
 * Shared behavioural contract every SessionStore adapter must satisfy.
 * Invoked from a describe() block by both the in-memory and Table Storage suites.
 */
export function sessionStoreContract(makeStore: () => Promise<SessionStore> | SessionStore): void {
  it("creates and reads back a session", async () => {
    const store = await makeStore();
    await store.createSession(session("s1"));

    const loaded = await store.getSession("s1");
    expect(loaded).toMatchObject({ sessionId: "s1", phase: "collect", ownerToken: "s1-owner" });
    expect(await store.getSession("missing")).toBeUndefined();
  });

  it("upserts and reads cards, isolated per session", async () => {
    const store = await makeStore();
    await store.createSession(session("s1"));
    await store.createSession(session("s2"));

    expect(await store.getCard("s1", "p1")).toBeUndefined();

    await store.upsertCard("s1", card("p1", "first"));
    await store.upsertCard("s1", card("p1", "edited")); // upsert replaces
    await store.upsertCard("s1", card("p2", "second"));

    expect((await store.getCard("s1", "p1"))?.statement).toBe("edited");
    expect(await store.countCards("s1")).toBe(2);
    expect(await store.countCards("s2")).toBe(0);

    const ids = (await store.listCards("s1")).map((c) => c.participantId).sort();
    expect(ids).toEqual(["p1", "p2"]);
  });

  it("updates reveal phase, order and step", async () => {
    const store = await makeStore();
    await store.createSession(session("s1"));

    await store.updateReveal("s1", { phase: "reveal", revealOrder: ["p2", "p1"], revealStep: 3 });

    const loaded = await store.getSession("s1");
    expect(loaded).toMatchObject({ phase: "reveal", revealOrder: ["p2", "p1"], revealStep: 3 });
  });
}

import { describe } from "vitest";
import { InMemorySessionStore } from "../../src/adapters/inMemoryStore";
import { sessionStoreContract } from "../contract/sessionStore.contract";

describe("InMemorySessionStore", () => {
  sessionStoreContract(() => new InMemorySessionStore());
});

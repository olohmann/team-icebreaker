import { randomBytes } from "node:crypto";
import { describe } from "vitest";
import { TableStorageSessionStore } from "../../src/adapters/tableStorageStore";
import { sessionStoreContract } from "../contract/sessionStore.contract";

const connectionString =
  process.env.AZURE_STORAGE_CONNECTION_STRING ?? "UseDevelopmentStorage=true";

function uniqueTableName(): string {
  return `it${randomBytes(8).toString("hex")}`;
}

// Probe the emulator/storage once; skip the suite cleanly if it is unreachable.
let available = false;
try {
  await TableStorageSessionStore.create(connectionString, uniqueTableName());
  available = true;
} catch {
  available = false;
}

describe.skipIf(!available)("TableStorageSessionStore (Azurite/Azure)", () => {
  sessionStoreContract(() => TableStorageSessionStore.create(connectionString, uniqueTableName()));
});

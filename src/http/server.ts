import path from "node:path";
import express, { type Express } from "express";
import { InMemorySessionStore } from "../adapters/inMemoryStore";
import { CryptoIdGenerator } from "../adapters/cryptoIdGenerator";
import { FisherYatesShuffler } from "../adapters/fisherYatesShuffler";
import { SystemClock } from "../adapters/systemClock";
import { TableStorageSessionStore } from "../adapters/tableStorageStore";
import type { SessionStore } from "../domain/ports";
import { SessionService } from "../domain/sessionService";
import { createApiRouter, errorHandler } from "./router";

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

export function createApp(service: SessionService): Express {
  const app = express();
  app.set("trust proxy", true); // honour x-forwarded-proto behind App Service
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createApiRouter(service));
  app.use(express.static(PUBLIC_DIR));
  app.use(errorHandler);
  return app;
}

async function resolveStore(): Promise<SessionStore> {
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (accountUrl) {
    return TableStorageSessionStore.createWithCredential(accountUrl);
  }
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return TableStorageSessionStore.create(connectionString);
  }
  // eslint-disable-next-line no-console
  console.warn(
    "Neither AZURE_STORAGE_ACCOUNT_URL nor AZURE_STORAGE_CONNECTION_STRING is set — " +
      "using the in-memory store (data is not persisted).",
  );
  return new InMemorySessionStore();
}

async function main(): Promise<void> {
  const store = await resolveStore();
  const service = new SessionService(
    store,
    new SystemClock(),
    new CryptoIdGenerator(),
    new FisherYatesShuffler(),
  );
  const app = createApp(service);
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Icebreaker listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

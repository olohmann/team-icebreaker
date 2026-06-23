#!/usr/bin/env node
// Launches the Azurite storage emulator for local development.
//
// This machine's Azurite picks up a non-canonical account key by default, which
// makes the Azure SDK fail with AuthorizationFailure. We pin the well-known
// devstoreaccount1 key so it matches `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEV_KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMA==";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const location = path.join(root, ".azurite");

const child = spawn(
  "npx",
  [
    "azurite",
    "--skipApiVersionCheck",
    "--location",
    location,
    "--tableHost",
    "127.0.0.1",
    "--tablePort",
    "10002",
    "--blobPort",
    "10000",
    "--queuePort",
    "10001",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, AZURITE_ACCOUNTS: `devstoreaccount1:${DEV_KEY}` },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));

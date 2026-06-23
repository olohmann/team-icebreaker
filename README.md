# Icebreaker

A tiny web app for team-meeting icebreakers. The **owner** starts a session and
gets two links:

- **Master link** — drives a staged reveal and is the screen shared with the
  room. It is **blind** while people are submitting: it shows only a count, never
  names or statements, until each reveal step unlocks them. The owner token lives
  in the URL fragment (`#owner=...`) so it never reaches the server during normal
  navigation.
- **Participant link** — input only. Each participant adds **one card** (their
  name + a statement, e.g. their favourite movie), editable until the reveal
  starts.

During the reveal the master shows one card's **statement** first (the room
guesses who wrote it), then the **name** on the next click. Order is random and
fixed at reveal start; Next/Back let the owner step and undo.

## Architecture

Ports & adapters (hexagonal), built outside-in with London-school TDD:

- `src/domain/` — framework-free core.
  - `sessionService.ts` — use-cases; depends only on ports. Enforces the blind
    master and phase rules.
  - `reveal.ts` — pure reveal stepping + projection (peek protection: only the
    current step's content is ever serialised).
  - `ports.ts` — `SessionStore`, `Clock`, `IdGenerator`, `Shuffler` (mock seams).
- `src/adapters/` — `inMemoryStore`, `tableStorageStore` (Azure Table Storage),
  `systemClock`, `cryptoIdGenerator`, `fisherYatesShuffler`.
- `src/http/` — thin Express `router` + `server` (wires adapters, serves
  `public/`).
- `public/` — three dependency-free pages (`index`, `join`, `master`) + `app.js`.

Data lives in a single Table Storage table partitioned by `sessionId`: one meta
row (`session`) and one row per card (`card_<participantId>`).

## Local development

Storage is the **Azurite** emulator. Note: this machine's Azurite needs the
canonical account key forced via `AZURITE_ACCOUNTS`; `npm run azurite` already
does that (see `scripts/start-azurite.mjs`).

```bash
npm install
npm run azurite        # terminal 1 — starts Azurite with the canonical key
AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true npm run dev   # terminal 2
# open http://localhost:3000
```

`npm run build && npm start` runs the compiled server instead of `tsx watch`.

## Tests

```bash
npm test          # Vitest: unit + acceptance + router + Table Storage contract
```

The Table Storage integration/contract tests run against Azurite, so start it
(`npm run azurite`) first. Layers:

- **Acceptance** (`test/acceptance`) — full meeting flow against the in-memory fake.
- **Unit** (`test/unit`) — `sessionService` and `router` with mocked
  collaborators (interaction assertions); `reveal` classicist.
- **Contract** (`test/contract`) — one suite run against both store adapters.
- **Integration** (`test/integration`) — Table Storage adapter vs Azurite.

## Configuration

| Variable | Purpose |
|---|---|
| `AZURE_STORAGE_ACCOUNT_URL` | Table endpoint, e.g. `https://<acct>.table.core.windows.net`. When set, the app authenticates with `DefaultAzureCredential` (managed identity in Azure, your `az`/dev credentials locally). **Takes precedence.** |
| `AZURE_STORAGE_CONNECTION_STRING` | Shared-key connection string. Use `UseDevelopmentStorage=true` for Azurite. |
| `PORT` | HTTP port (App Service injects its own). |

If neither storage variable is set the app falls back to a non-persistent
in-memory store (handy for a quick demo).

## Deploy to Azure

`deploy.sh` provisions everything in a fresh resource group and ships a
self-contained build.

```bash
./deploy.sh                      # random resource suffix
SUFFIX=demo123 ./deploy.sh       # or pin your own names
SUBSCRIPTION=<id> ./deploy.sh    # target a specific subscription
```

It uses whichever subscription `az` is currently set to (override with the
`SUBSCRIPTION` env var) and creates: resource group (`rg-icebreaker`,
**swedencentral**), a Standard_LRS StorageV2 account, a Linux **B1** App Service
plan, and a **Node 22 LTS** web app.

**Auth note:** the storage account in this subscription forbids shared-key access
by policy, so the web app uses its **system-assigned managed identity**. The
script enables the identity, grants it **Storage Table Data Contributor** on the
account, and sets `AZURE_STORAGE_ACCOUNT_URL`; the app then uses
`DefaultAzureCredential`. No keys or connection strings are stored on the app.

The build is done locally and deployed as a prebuilt zip (prod `node_modules` +
compiled `dist/`) with `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, so server-side
Oryx builds are not relied on.

When it finishes it prints the live URL — open `/` to create a session.

### Tear down

```bash
az group delete -n rg-icebreaker --yes --no-wait
```

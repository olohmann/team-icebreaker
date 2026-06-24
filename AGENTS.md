# AGENTS.md

Guidance for AI coding agents (and humans) working on **team-icebreaker**.
Read this before making changes — it captures the architecture, conventions, and
the non-obvious gotchas that cost real time to discover.

## What this app is

A team-meeting icebreaker web app. An **owner** starts a session and gets two
links:

- **Master link** — drives a staged reveal, shown on the room's shared screen.
  It is **blind during the collect phase**: the server returns only a submission
  count, never names/statements, until each reveal step unlocks them. The owner
  token lives in the URL fragment (`#owner=...`) so it never hits the server
  during navigation; it's sent explicitly as the `x-owner-token` header.
- **Participant link** — input only, token-less. Each participant adds **one**
  card (name + statement), editable until the reveal starts.

Reveal shows a card's **statement** first (room guesses who), then the **name**
on the next step. Order is random, fixed at reveal start; Next/Back step & undo.

## Golden rules for agents

1. **Stay outside-in / TDD (London school).** Write/extend a failing test first,
   then implement. Domain logic is mock-tested on its ports; pure logic is
   classicist-tested. Don't add code paths with no test.
2. **Keep the domain framework-free.** `src/domain/` must not import Express,
   Azure SDKs, Node `fs`, etc. It depends only on the port interfaces. All I/O
   lives in `src/adapters/`.
3. **Never weaken the blind master.** `SessionService.getMasterState` must not
   read card content during the collect phase, and `reveal.ts#revealView` must
   only ever serialize the *current* step's content (peek protection). Any change
   here needs a test proving other cards aren't leaked.
4. **Don't commit secrets or build output.** `.gitignore` already excludes
   `node_modules/`, `dist/`, `.env`, `*.log`, `.azurite/`, `.deploypkg/`. Don't
   hardcode subscription IDs, keys, or tokens. The only key in source is the
   **public, documented Azurite emulator key** — leave it, don't add others.
5. **Include the Copilot co-author trailer** on commits:
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Architecture (ports & adapters / hexagonal)

```
src/
  domain/        framework-free core
    types.ts         Session, Card, RevealUpdate
    ports.ts         SessionStore, Clock, IdGenerator, Shuffler  <- mock seams
    errors.ts        DomainError with a `code` (not_found|forbidden|validation|conflict)
    reveal.ts        PURE stepping + revealView projection (peek protection)
    sessionService.ts use-cases; enforces blind-master + phase rules
  adapters/      one concrete impl per port
    inMemoryStore.ts        SessionStore for tests/demo
    tableStorageStore.ts    Azure Table Storage (key OR managed identity)
    systemClock.ts, cryptoIdGenerator.ts, fisherYatesShuffler.ts
  http/
    router.ts      REST routes; maps DomainError.code -> HTTP status; buildLinks
    server.ts      createApp(service) factory + resolveStore() + bootstrap
public/          3 dependency-free pages + app.js (no build step, no framework)
```

Data model: a **single table** partitioned by `sessionId`. One meta row
(`rowKey="session"`: ownerToken, title, phase, revealOrder JSON, revealStep,
createdAt) and one card row per participant (`rowKey="card_<participantId>"`).

DomainError → HTTP mapping (in `router.ts`): `not_found`→404, `forbidden`→403,
`validation`→400, `conflict`→409. Validation limits: NAME_MAX=80,
STATEMENT_MAX=280, TITLE_MAX=140.

## Adding a feature — the recipe

1. If it's a new use-case, add a method to `SessionService` and unit-test it with
   `vi.fn()` mocks of the ports (assert interactions, e.g. `shuffler.shuffle`
   called with the card ids).
2. If it needs new persistence, add the method to the `SessionStore` port, then
   implement in **both** `inMemoryStore` and `tableStorageStore`, and cover it in
   the shared `test/contract/sessionStore.contract.ts` (runs against both).
3. Expose it via `router.ts` and add a Supertest case in `test/unit/router.test.ts`.
4. Update the relevant `public/*.html` + `app.js` (vanilla, dispatch by
   `document.body.dataset.page`; 2s polling; participantId in localStorage).
5. Run `npm test` (start Azurite first — see below).

## Local development

Storage is the **Azurite** emulator. ⚠️ **Critical gotcha:** this machine's
Azurite does not use the canonical `devstoreaccount1` key by default, so the
`@azure/data-tables` SDK fails with `AuthorizationFailure`. `scripts/start-azurite.mjs`
(run via `npm run azurite`) forces the canonical key through `AZURITE_ACCOUNTS`.
Always start Azurite that way; don't launch the bare `azurite` binary.

```bash
npm install
npm run azurite        # terminal 1 — Azurite with the canonical key
AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true npm run dev   # terminal 2
```

`tableStorageStore.ts#resolveConnectionString` expands the
`UseDevelopmentStorage=true` shortcut (the Tables SDK doesn't understand it) into
the full Azurite connection string.

## Tests

`npm test` (Vitest). The contract + integration suites talk to Azurite, so it
must be running. Layers: acceptance (full flow vs in-memory fake), unit
(`sessionService`/`router` mocked, `reveal` classicist), contract (both stores),
integration (Table Storage vs Azurite). Keep all green before pushing.

## Storage auth: two modes — pick by env

`server.ts#resolveStore` chooses in this order:

1. `AZURE_STORAGE_ACCOUNT_URL` set → **Microsoft Entra ID / managed identity**
   via `DefaultAzureCredential` (`TableStorageSessionStore.createWithCredential`).
2. else `AZURE_STORAGE_CONNECTION_STRING` set → shared key (Azurite locally).
3. else in-memory (non-persistent) with a warning.

**Why managed identity matters:** the storage account used in deployment has
**shared-key auth disabled by subscription policy** (`KeyBasedAuthenticationNotPermitted`,
and `allow-shared-key-access` cannot be re-enabled). So in Azure the app MUST use
AAD. Don't "fix" a deploy auth error by trying to turn on shared keys — wire up
the managed identity + RBAC role instead.

## Deploying to Azure (`deploy.sh`)

`deploy.sh` is the source of truth and is idempotent enough to re-run. It:
RG `rg-icebreaker` in **swedencentral** → Standard_LRS StorageV2 account → Linux
**B1** plan → **Node 22 LTS** web app → enables system-assigned identity → grants
it **Storage Table Data Contributor** on the account → sets
`AZURE_STORAGE_ACCOUNT_URL` → builds locally and deploys a prebuilt zip.

Hard-won deployment gotchas (don't re-learn these):

- **Node 20 LTS is no longer offered** for new Linux App Service apps — use 22+
  (`az webapp list-runtimes --os-type linux` to confirm current options).
- **Don't rely on Oryx server-side build.** `az webapp deploy --type zip` did not
  reliably run `npm run build`, leaving `dist/` missing → container start
  timeout / endless "Starting the site". Instead **build locally and ship a
  self-contained zip** (compiled `dist/` + prod-only `node_modules`) with
  `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. Both runtime deps (`express`,
  `@azure/data-tables`, `@azure/identity`) are pure JS, so a macOS-built
  `node_modules` runs fine on Linux.
- **RBAC propagation** takes a moment; `deploy.sh` sleeps ~30s before deploying so
  the identity can read/write the table on first start.
- **Subscription:** `deploy.sh` uses the current `az` subscription by default;
  override with `SUBSCRIPTION=<id>`. Never hardcode a subscription GUID.
- **Diagnosing a stuck container:** `az webapp log download` and grep the
  `ContainerStream` lines for `Failed to start server` — that's the app's stdout.

### Subscription policy reverts — "it worked yesterday, now it's down"

This tenant runs Azure Policy remediations that periodically **undo** the
deploy-time configuration overnight. If a previously-working app suddenly returns
errors, suspect a policy revert **before** suspecting the code. Two confirmed cases:

- **App returns 403 / state `QuotaExceeded`** → the App Service plan was flipped
  back to **Free (F1)**, whose 60-min/day CPU quota then tripped. Fix:
  `az appservice plan update -n icebreaker-plan -g rg-icebreaker --sku B1`,
  then `az webapp restart`. `deploy.sh` enforces B1 and fails loudly on F1.
- **App crashes on startup with `AuthorizationFailure` on Table Storage** (managed
  identity token IS acquired, RBAC role IS present and matches) → the storage
  account's **`publicNetworkAccess` was flipped to `Disabled`**, blocking the app's
  public-endpoint table calls. Confirm with
  `az storage account show -n icebreaker6f9a0ab5 -g rg-icebreaker --query "{pna:publicNetworkAccess,def:networkRuleSet.defaultAction}"`.
  Fix: `az storage account update -n icebreaker6f9a0ab5 -g rg-icebreaker --public-network-access Enabled --default-action Allow`,
  then `az webapp restart`. `deploy.sh` asserts this and fails loudly if it sticks.
  - Note: `AuthorizationFailure` here is a **networking** denial, not a missing
    role. `AuthorizationPermissionMismatch` would mean the RBAC role is wrong —
    different problem. Don't churn on role assignments for `AuthorizationFailure`.
  - A durable fix would be a **private endpoint + VNet integration** (needs a
    Standard+ plan), but that's overkill for an icebreaker; re-enabling public
    access is the pragmatic remediation.

Tear down: `az group delete -n rg-icebreaker --yes --no-wait`.

## Environment notes

- `kill` in this sandbox requires an explicit numeric PID — `pgrep -f <name>`
  first, then `kill <pid>`. `pkill`/`killall`/`for p in $(pgrep...)` are blocked.
- Frontend has **no build step**; don't introduce a bundler/framework without a
  strong reason — it's intentionally dependency-free static files.

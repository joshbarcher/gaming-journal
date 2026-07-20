# Server Feature Documentation Guidance

These docs cover the **backend data services** under `src/lib/server/relay/` — the fetch/cache/sync/serve layer that was folded in from the former standalone relay server (2026-07-17). They are the server-side counterpart to `docs/features/`, which covers the frontend/user-facing areas.

They exist for one reason: **give a developer (human or AI) enough context to answer questions and make changes to one backend area without re-deriving everything from scratch.** Dense reference sheets, not tutorials or changelogs.

---

## Architecture in one paragraph

There is no separate relay process or `:8050` anymore. Services live in `src/lib/server/relay/<area>/`, are exposed as SvelteKit route handlers at `src/routes/relay/api/<x>/+server.ts` (wrapped by `relayRoute()` from `shared/route-helpers.ts`, public path `/relay/api/*` on `:8061`), and boot from `src/lib/server/relay/boot.js` (`bootRelay()`, called by `src/hooks.server.ts`). SSR loaders reach the API via `journalRelayBase()` (self); there is no `RELAY_URL`. Data lives under the relay data root resolved by `featureDir()` (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay/`). Schedulers run only when `ENABLE_SCHEDULERS=true` (prod). See `core/startup.md`, `core/sync-tick.md`, `core/managed-file.md`.

---

## What to include

1. **Overview** (2–4 sentences) — what the feature does, from the operator's view.
2. **Data flow** — the most important section. Trace trigger → service → disk for the happy path. Be specific about real file names, function names, and `/relay/api/...` endpoints.
3. **Key files** — only the load-bearing files (a `File | Role` table), with **verified** `src/lib/server/relay/...` and `src/routes/relay/...` paths.
4. **Storage layout** — the on-disk tree, relative to the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay/`).
5. **Common questions** — real questions from past debugging, answered directly.
6. **Gotchas** — non-obvious behavior, constraints, historical decisions.

## What to omit

- Things obvious from the code, full API references, setup steps, authorship, aspirational behavior.

## Format rules

- Short sentences, one fact each. Specific over general. Code-format paths/functions/routes. Keep under ~150 lines; split if larger. Update the doc in the same change as the code.

---

## Layout

```
docs/server/
  guidance.md   ← this file
  core/         ← infrastructure: startup (boot.js), sync tick, ManagedFile
  steam/        ← Steam services + data stores (account, games, achievements, sessions, …)
  external/     ← ProtonDB, Reddit, PCGW, IGDB, Nexus
  guides/       ← guide download/parse/search pipeline
  hltb/         ← HowLongToBeat sync
  itad/         ← IsThereAnyDeal pricing
  system/       ← pin, provision, recommend
```

> Not here: **mail** (moved to the standalone `emails` app) and **sms** (moved to `beacon`) — they left the journal at decommission and are not part of these services.

---

## Accuracy rule

The fold-in changed paths, the process model, the storage root, and removed `RELAY_URL`/the catch-all proxy. When writing or updating a doc, **confirm every path, endpoint, function, and storage location against the actual code** — don't carry a fact forward on faith. If unsure, add a `> ⚠️ Verify: ...` callout rather than assert it. Document only what the code does today.

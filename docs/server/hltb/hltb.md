# HowLongToBeat (HLTB)

Fetches and caches completion time estimates (main story, main+extras, completionist) from HowLongToBeat for all owned Steam games. Per-game files with exponential-backoff retries for unmatched games. Folded into the gaming-journal SvelteKit app — no standalone relay process.

## Data flow

### Single game sync
1. `syncGame(appid, { steamName })` resolves the name from the passed `steamName`, else looks it up in `featureDir('steam')/games.json`.
2. Skips only when the existing entry is `matched=true` AND has real times (non-zero `gameplayMain`/`gameplayMainExtra`/`gameplayCompletionist`). Matched-but-zero-time entries are retried.
3. Fetches a fresh HLTB auth token via `GET /api/bleed/init`.
4. POSTs the cleaned search term to `POST /api/bleed` (`cleanSearchName` strips ®©™ and punctuation).
5. `pickBestMatch`: prefers an exact Steam appid hit (`profile_steam`); else Dice-coefficient bigram name similarity (min `MIN_SIMILARITY = 0.4`).
6. Writes `hltb/{appid}.json` — match confidence, HLTB id, times (seconds → hours), retry tracking.
7. Rebuilds `hltb/index.json` (matched entries only).

A 200-but-empty search result does NOT wipe good cached times — the existing matched entry is kept. A thrown search error propagates and leaves the entry untouched.

### Retry scheduler
- `startHltbRetryScheduler()` — wired in `boot.js` via `startScheduler('hltb', …)`, gated by `ENABLE_SCHEDULERS=true` (`SCHED_HLTB=off` disables just this one).
- First run ~15 s after boot, then every 30 min. Each tick queues only games whose `nextRetryAt` is in the past.
- Backoff base 30 min, doubles each attempt, capped at 7 days: 30m → 1h → 2h → 4h → 8h → 16h → ~32h → 7d.
- On any new match it also runs `rebuild('games')` so the merged games cache picks up the times.

### Bulk sync
`syncAll()` iterates `getAllGames()` with a 3–6 s jittered delay between calls. Used for initial backfill and admin full refresh.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/hltb/hltb.service.js` | `syncGame`, `syncAll`, `getEntry`, `getIndex`, `startHltbRetryScheduler`, backoff, `cleanSearchName`, `pickBestMatch` |
| `src/lib/server/relay/boot.js` | Registers the retry scheduler (`startScheduler('hltb', …)`) |
| `src/routes/relay/api/hltb/+server.ts` | `GET /relay/api/hltb` — index |
| `src/routes/relay/api/hltb/[appid]/+server.ts` | `GET /relay/api/hltb/:appid` — single entry |
| `src/routes/relay/api/hltb/sync/+server.ts` | `POST /relay/api/hltb/sync` — fire-and-forget full sync (409 guard) |
| `src/routes/relay/api/hltb/sync/[appid]/+server.ts` | `POST /relay/api/hltb/sync/:appid` — single sync |

Public base URL `/relay/api/…` (port :8061). Handlers are wrapped by `relayRoute('hltb', …)` (`shared/route-helpers.ts`).

## Storage layout

Root is `relayDataRoot()` = `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`; falls back to `$DATA_DIR/relay/`). `featureDir('hltb')` = that root + `/hltb`.

```
<relay-data-root>/hltb/
  {appid}.json   ← { appid, steamName, fetchedAt, matched, matchedName, confidence, hltbId,
                     gameplayMain, gameplayMainExtra, gameplayCompletionist, imageUrl, retryCount, nextRetryAt }
  index.json     ← [{ appid, steamName, matchedName, confidence, hltbId,
                     gameplayMain, gameplayMainExtra, gameplayCompletionist }]  — matched games only
```

## Common questions

**Q: What does `matched=true` with `gameplayMain=null` mean?**
HLTB matched the game by name/appid but has no submitted times yet (common for new releases). Treated as unmatched for retry purposes — it keeps getting retried until times exist.

**Q: What is `confidence`?**
Dice-coefficient bigram similarity between the Steam name and the HLTB match name (0–1). `1.0` means an exact appid match. Below `0.4` is rejected.

**Q: Why `cleanSearchName` before searching?**
HLTB search is sensitive to special characters. Trademark symbols and punctuation are replaced with spaces to improve match rates.

## Gotchas

- Each search needs a short-lived token trio (`x-auth-token`, `x-hp-key`, `x-hp-val`) fetched fresh from `/api/bleed/init`. Tokens are not reusable across requests.
- Times arrive in seconds (`comp_main`, `comp_plus`, `comp_100`) and are stored in hours.
- `retryCount` resets to 0 only when matched AND non-zero times; a match with zero times increments it and sets `nextRetryAt`.
- The scheduler wakes every 30 min but only processes games whose `nextRetryAt` is past — a game at 7-day backoff is retried at most weekly.
- Dev instances read the NAS but don't run schedulers (`ENABLE_SCHEDULERS` unset), so no background retries there.
```

# ProtonDB

Fetches Linux/Steam Deck compatibility ratings from ProtonDB for owned games.
Per-game files, rebuilt index, weekly sync scheduler.

## Data flow

1. `startProtonDbScheduler()` runs from `bootRelay()` behind
   `startScheduler('protondb', …)`. It sets a `setInterval` at
   `PROTONDB_SYNC_INTERVAL_HOURS` (default 168 h = 7 days) — it does **not** fire an
   immediate sync at startup.
2. `syncAll()` reads all owned games via `getAllGames()`.
3. Per game, the TTL depends on the cached tier:
   - `native` or `platinum` → 30 days (settled — rarely changes)
   - everything else → 7 days (the scheduler interval)
4. Fetches `https://www.protondb.com/api/v1/reports/summaries/{appid}.json`.
5. `fetchSummary` distinguishes **confirmed not-found** (HTTP 404 / an HTML body)
   from a **transient** failure (429 / 5xx / network — it throws).
6. `shapeEntry()` extracts `tier`, `bestReportedTier`, `trendingTier`, `confidence`,
   `score`, `total`. Written to `{appid}.json`; `rebuildIndex()` regenerates
   `index.json` after the batch. Jittered 100–300 ms between requests.

### Single-game sync
`syncOne(appid, { force })` — on-demand fetch. `provisionGame()` calls it at step 6
with `{ force: true }`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/protondb/protondb.service.js` | `syncAll`, `syncOne`, `getEntry`, `getIndex`, `startProtonDbScheduler`, `shapeEntry`, `tierSignature`, `fetchSummary` |
| `src/lib/server/relay/provision.service.js` | Calls `syncOne` at step 6 of `provisionGame` |
| `src/routes/relay/api/protondb/[appid]/+server.ts` | `GET /relay/api/protondb/:appid` (`?fetch=true` = synchronous on-demand fetch) |
| `src/routes/relay/api/protondb/sync/+server.ts`, `sync/[appid]/+server.ts` | Manual full / single sync triggers |

## Storage layout

All paths relative to `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`):

```
protondb/
  {appid}.json   ← { appid, tier, bestReportedTier, trendingTier, confidence, score, total, fetchedAt }
                    (a confirmed not-found writes { appid, tier: null, notFound: true, fetchedAt })
  index.json     ← [{ appid, tier, bestReportedTier, trendingTier, confidence, score, total }]
```

### Tier values
`native`, `platinum`, `gold`, `silver`, `bronze`, `borked` — descending compatibility.

## Common questions

**Q: `tier` vs `bestReportedTier` vs `trendingTier`?**
`tier` = ProtonDB's calculated overall rating; `bestReportedTier` = the best single
report; `trendingTier` = rating from recent reports only.

**Q: What is `tierSignature`?**
A `tier|bestReportedTier|trendingTier` fingerprint. `syncAll` counts a game as
`updated` only when this changes — `score`/`total` drift weekly and would otherwise
report a change for nearly every game every run.

## Gotchas

- **Transient failures never clobber good cache.** A 429/5xx/network error throws
  in `fetchSummary`; `syncOne`/`syncAll` catch it and keep the existing entry —
  they only write the `notFound` sentinel on a confirmed 404 or HTML body. This is
  what stops a rate-limit blip from wiping a good tier for the whole 7/30-day TTL.
- ProtonDB serves an **HTML** page (not JSON) for unknown appids; detected via the
  `Content-Type` header, treated as a confirmed not-found.
- `syncIntervalHours()` reads `PROTONDB_SYNC_INTERVAL_HOURS` (default 168) and is
  used for the scheduler cadence and the non-settled entry TTL — not the 30-day
  settled TTL.

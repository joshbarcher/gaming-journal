# Achievements

Per-game achievement schema + player progress, stored in per-game sharded files under `steam/achievements/{appid}.json`. Backed by an in-memory `_achCache` Map for fast synchronous reads. Synced on the 30-min tick and on-demand when a new game session starts. Lives in `src/lib/server/relay/steam/steam.service.js`.

## Data flow

### Cache load at startup
1. `loadAchievementsCache()` runs `_migrateAchievementsMonolith()` first — migrates the old monolithic `achievements.json` to per-game files (renames monolith to `achievements.json.migrated`; no-op if already migrated).
2. Reads all `{appid}.json` files in `achievements/` in batches of 20 concurrent reads.
3. Populates `_achCache: Map<String(appid), entry>`. Called from `boot.js` (`loadAchievementsCache().catch(...)`).

### Full sync (30-min tick)
1. `syncAchievements()` reads `getGames()` and builds candidates: `playtime_forever >= 1` OR `has_community_visible_stats === true`.
2. The currently-active game (from the persisted open session, `getOpenSession()`) is always force-included.
3. Non-active candidates queue when ANY of: never fetched (`!entry.fetchedAt`); needs repair (`_needsRepair` — has achievements but first has no `displayName`); cache older than `ACHIEVEMENTS_TTL_MS` (6h) AND `rtime_last_played > fetchedAt`; `_needsPlayerData` (schema but `hasPlayerData === false`, not blocked); `force`. Games with 0 achievements recheck at `NO_ACH_TTL_MS` (30 days).
4. Per candidate (batch: 0.5 req/s, 1s jitter): schema via `GetSchemaForGame/v2/`; fallback scrape of the Community stats page via `scrapeAchievementSchema(appid)` when the API returns empty; player progress via `GetPlayerAchievements/v1/` (400/403 not fatal — sets `playerDataBlocked`, shows schema without progress).
5. Merged result written via `_writeGameAchievements(appid, entry)` (transient ManagedFile per game) and `_achCache` updated.
6. Returns `{ synced, failed, skipped, syncedAppids[] }` — the tick uses `syncedAppids` to immediately download achievement icons via `syncAchievementImages({ appids })`.

### On-demand & mid-session
- `syncAchievementsForGame(appid, name)` — called by the now-playing poller when a session opens. If schema is cached → delegates to `refreshPlayerAchievements`; else fetches schema + progress. No-ops if a full `syncAchievements()` is running.
- `refreshPlayerAchievements(appid)` — player-progress-only refresh; merges `GetPlayerAchievements` into the cached schema. Called on mid-session unlock detection and at session close.
- `fetchPlayerAchievementsNow(appid)` — returns `[{ apiname, achieved, unlocktime }]` (or `[]` on any error); used for session baseline/diff.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/steam.service.js` | `loadAchievementsCache`, `syncAchievements`, `getAchievements`, `getAchievementsForGame`, `refreshPlayerAchievements`, `syncAchievementsForGame`, `fetchPlayerAchievementsNow`, `repairAchievements`, `_achCache`, `_writeGameAchievements`, `_localAchPath` |
| `src/lib/server/relay/steam/achievement-schema-scraper.js` | `scrapeAchievementSchema` — Puppeteer fallback |
| `src/lib/server/relay/steam/images.service.js` | `syncAchievementImages` — reads the sharded cache via `getAchievements()`/`getAchievementsForGame()` |
| `src/routes/relay/api/steam/achievements/+server.ts` | `GET /relay/api/steam/achievements` (`relayRoute('steam')`); also `/[appid]`, `/sync`, `/repair` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  achievements/
    {appid}.json   ← { fetchedAt, gameName, achievements[], hasPlayerData, playerDataBlocked }
```

Each `achievements[]` entry: `{ apiname, displayName, description, icon (CDN URL), icongray (CDN URL), hidden, achieved (0|1), unlocktime }`. `getAchievements()`/`getAchievementsForGame()` add `localIcon`/`localIconGray` — `/relay/images/steam/achievements/{appid}/{safeName}_{color|gray}_{filename}` (served by `src/routes/relay/images/steam/[...file]/+server.ts`).

## Common questions

**Q: Why is the TTL check done before `_needsPlayerData`?**
`_needsPlayerData` is true for any played game with schema but a permanent 400/403 on player stats. TTL-gate-first means those games are only retried when the cache is stale, not every tick.

**Q: `getAchievements()` vs `getAchievementsForGame(appid)`?**
First returns the full map, second a single game. Both read `_achCache` synchronously and compute `localIcon`/`localIconGray`.

## Gotchas

- `_achCache` keys are strings — always `.get(String(appid))`.
- `_writeGameAchievements` uses a transient ManagedFile (`load`/`set`/`flush`/`close` per write), not a singleton.
- Empty schema from both API and scraper does NOT overwrite an existing stored list (transient-failure preservation) — only writes `[]` when nothing was stored.
- The scraper fallback joins by array position, not `apiname`.
- `_syncAchievementsImpl` currently only force-includes the active game from the persisted open session; the in-memory now-playing fallback is present but commented out (a stale Wave-4 seam). The persisted-session path is live, so an active game is still refreshed each tick.

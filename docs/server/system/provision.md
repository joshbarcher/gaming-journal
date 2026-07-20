# Provisioning Pipeline

Runs the full data pipeline for newly acquired games (and wishlist items): store details → images → screenshots → ITAD pricing → HLTB times → PCGW data → ProtonDB rating. Folded into the gaming-journal SvelteKit app; the five feature syncs are imported directly from the local ported services (no HTTP shim).

## Data flow

### `provisionGame(appid, name)` — single game
Each step is individually guarded (one failure doesn't abort the rest):
1. Store details (`syncStoreOne`) — must run first; images need store data for hash-based CDN URLs. Its returned `name` becomes `resolvedName` for later steps.
2. Game art (`syncOneGame`) then screenshots (`syncOneScreenshots`).
3. ITAD pricing (`syncItadOne`).
4. HLTB times (`syncHltbGame`).
5. PCGW data (`syncPcgwGame`) — manages its own Puppeteer browser.
6. ProtonDB rating (`syncProtondbOne`, `force:true`).

### `provisionNewGames(prevIds)` — new library/wishlist games
Runs inside the 30-min steam tick (`sessions.service.js` snapshot scheduler), not `boot.js`:
1. `getKnownAppids()` snapshots current appids BEFORE `syncGames()` + `syncWishlist()`.
2. After the syncs, `provisionNewGames(prevIds)` diffs the new game/wishlist lists against `prevIds`.
3. Each new appid runs through `provisionGame()`. New *library* ids are stamped in `library-firstseen.json` (powers the home "Just Bought" card); wishlist-only additions are excluded.
4. Ends with `rebuild('games')`.

### `backfill()` — startup backfill
Wired in `boot.js` via `startScheduler('provision', …)` (gated by `ENABLE_SCHEDULERS`; `SCHED_PROVISION=off` until the cutover window). For each known game it checks for missing store/itad/hltb/pcgw/protondb files and game-image/screenshot dirs, then provisions the ones missing anything. Fire-and-forget — the app serves immediately.

### `recheckUnavailableWishlistItems()`
Runs at boot (after `backfill`) and on the 30-min tick. Re-asks Steam for wishlisted games whose store file is flagged `unavailable` and older than 24 h (`recheckAppDetail`); recovered games are re-provisioned. Respects the 1 req/s store API limit. (This rechecks Steam store availability — not ITAD/HLTB.)

### `cleanupLocalWishlist()`
Removes entries from the journal-owned `local-wishlist.json` for games that have since appeared in the Steam library. Runs on the 30-min tick.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/provision.service.js` | `provisionGame`, `provisionNewGames`, `backfill`, `recheckUnavailableWishlistItems`, `cleanupLocalWishlist`, `getKnownAppids`, `getLibraryFirstSeen` |
| `src/lib/server/relay/steam/store.service.js` | `syncOne` (store), `recheckAppDetail` |
| `src/lib/server/relay/steam/images.service.js` | `syncOneGame`, `syncOneScreenshots` |
| `src/lib/server/relay/itad/itad.service.js` | `syncOne` (ITAD) |
| `src/lib/server/relay/hltb/hltb.service.js` | `syncGame` (HLTB) |
| `src/lib/server/relay/pcgw/pcgw.service.js` | `syncGame` (PCGW) |
| `src/lib/server/relay/protondb/protondb.service.js` | `syncOne` (ProtonDB) |
| `src/lib/server/relay/steam/sessions.service.js` | 30-min tick that calls `getKnownAppids`/`provisionNewGames`/`recheck`/`cleanup` |
| `src/routes/relay/api/admin/provision/[appid]/+server.ts` | `POST` — provision one game on demand |
| `src/routes/relay/api/admin/backfill/+server.ts` | `POST` — trigger the backfill |

## Storage layout

Paths go through `featureDir(<cat>)` = `relayDataRoot()/<cat>` (prod `/mnt/data-dir/gaming-journal/relay/`). Per-game files land under `steam/store/`, `itad/`, `hltb/`, `pcgw/`, `protondb/`, `steam/images/games/`, `steam/images/screenshots/`.

```
<relay-data-root>/steam/library-firstseen.json   ← { [appid]: firstSeenIso }
$DATA_DIR/gaming-journal/local-wishlist.json      ← journal-owned; cleaned by cleanupLocalWishlist
```

## Common questions

**Q: What triggers provisioning for a brand-new library game?**
The 30-min tick snapshots `getKnownAppids()` before `syncGames()`, then `provisionNewGames(prevIds)` after; any appid not in `prevIds` runs `provisionGame()`.

**Q: Why must store run first?**
Steam CDN image URLs use a hash only present in the store API response. Images depend on store data to resolve it. ITAD, HLTB, PCGW, ProtonDB are independent.

## Gotchas

- PCGW uses a shared Puppeteer browser; if it crashes, PCGW steps fail (logged, non-fatal) until it relaunches on the next call.
- `loadFirstSeen()` deliberately does NOT memoize `{}` on a transient read error — caching empty would make `recordFirstSeen()` treat every game as new and overwrite real acquire dates with today. It returns `null` (unmemoized) so the next call retries.
- `localWishlistPath()` = `$DATA_DIR/gaming-journal/local-wishlist.json` — the journal client's own data area, on the same filesystem; `cleanupLocalWishlist` modifies a journal-owned file.
- `backfill` can be slow for a large library with many gaps; it runs fire-and-forget behind `SCHED_PROVISION`.
```

# Steam Account & Friends

Fetches and caches Steam profile data (profile card, level, badges, bans) and the friends list (with profile summaries). Ported into the journal as `src/lib/server/relay/steam/account.service.js`.

## Data flow

### Account sync
1. `syncAccount()` calls four Steam API endpoints in sequence:
   - `ISteamUser/GetPlayerSummaries/v2/` → profile
   - `IPlayerService/GetSteamLevel/v1/` → level
   - `IPlayerService/GetBadges/v1/` → badges
   - `ISteamUser/GetPlayerBans/v1/` → bans
2. Empty-response guard: if all four come back empty/null (Steam returns HTTP 200 with a partial body under load), the cached account is kept and `fetchedAt` is not re-stamped. Otherwise each field falls back fresh → prior-cached → default.
3. Result written to the `account.json` singleton (`ManagedFile.set()` → `flush()`).
4. `getAccount()` returns `(await _loadAccountFile()).get()` — synchronous in-memory read.
5. TTL is 6h (`ACCOUNT_TTL_MS`). Fresh cache short-circuits the API calls. Served on-demand by `GET /relay/api/steam/account`; forced by `POST /relay/api/steam/account/sync`.

### Friends sync
1. `syncFriends()` fetches the friend list via `ISteamUser/GetFriendList/v1/`.
2. Batches friend steamids in groups of 100 (`FRIEND_SUMMARY_BATCH`) and calls `GetPlayerSummaries/v2/` per batch (1s delay between batches).
3. Merges friend list entries with profile summaries; writes to `friends.json` singleton.
4. `getFriends()` returns the in-memory cache. TTL is 24h (`FRIENDS_TTL_MS`).

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/account.service.js` | `syncAccount`, `getAccount`, `syncFriends`, `getFriends`; both singletons |
| `src/lib/server/relay/account/account.service.js` | `build`/`get`/`ensureBuilt` — the composite journal aggregate (imported by `boot.js` as `buildAccountCache`) |
| `src/routes/relay/api/steam/account/+server.ts` | `GET /relay/api/steam/account` (`relayRoute('steam')`) |
| `src/routes/relay/api/steam/friends/+server.ts` | `GET /relay/api/steam/friends` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  account.json   ← { fetchedAt, profile, level, bans, badges }
  friends.json   ← { fetchedAt, friendCount, friends[] }
```

`friends[]` entries: `{ steamid, relationship, friend_since, profile }` where `profile` is the raw Steam player summary or `null` if the summary batch failed.

## Common questions

**Q: Is account sync triggered on the 30-min tick?**
Not directly. `syncAccount` is lazy (called when the endpoint is hit; 6h TTL). The tick instead calls `rebuild('account')`, which rebuilds the *composite* aggregate in `account/account.service.js` from whatever files are on disk — it does not re-hit the Steam account API.

**Q: What is the difference between the two account services?**
`steam/account.service.js` is the raw Steam profile/friends fetcher. `account/account.service.js` `build()` assembles a composite home-page cache from `account.json` + `games.json` + `recently-played.json` + `reviews.json` + `wishlist.json` + the in-memory play-log sessions. `boot.js` calls it (as `buildAccountCache`) after `loadPlayLog()`.

## Gotchas

- `badges` is the raw `GetBadges/v1/` response object (contains `badges[]`, `player_level`, `player_xp`), not an array.
- Friends sync uses a 1s inter-batch delay; a 500+ friend list takes ~5s in the profile phase.
- The two TTLs are checked independently by their respective sync functions.
> **Known bug (as of this writing):** `build()` reads a monolithic `steam/achievements.json` for `achievementsUnlocked`, but achievements were sharded into per-game files (`steam/achievements/{appid}.json`) and the monolith was renamed to `.migrated`. That read now returns `null`, so `achievementsUnlocked` derives **0** and the account page's "Achievements" stat ([Account.svelte](../../../src/lib/svelte/account/Account.svelte)) shows 0/—. Same class as the `steam:images` sharding regression. Fix: source the count from the sharded cache (`getAchievements()`/`_achCache` in `steam/steam.service.js`) instead of the monolith read.

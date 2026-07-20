# Steam App List

Full Steam game catalog used for name→appid resolution. Cached locally, rebuilt weekly, held in memory as a normalized search index. Lives in `src/lib/server/relay/steam/applist.service.js`.

## Data flow

1. `buildApplist()` (called from `boot.js` behind the `applist` scheduler) checks `applist.json` age (TTL 7 days, `CACHE_MAX_AGE`).
2. If stale or missing: paginates `IStoreService/GetAppList/v1/` in batches of 50k using the `last_appid` cursor until `have_more_results` is false. Query params filter server-side: `include_games=true`, `include_dlc=false`, `include_software=false`, `include_videos=false`, `include_hardware=false`.
3. Written to `applist.json` (raw `[{ appid, name }]`).
4. Builds in-memory `_index: [{ appid, name, _lower }]` — noise-filtered; `_lower` is the lowercase name.
5. `search(query, { limit, offset })` splits `_index` into `startsWith` and `contains` (substring) matches, each sorted by name length, and returns a page. Each result adds `headerImage` (Akamai CDN header URL). Sets `_built = true`.

### Noise filtering
Names matching any of these are excluded from `_index` (not from `applist.json`): soundtrack, `ost`, `demo`, dedicated server, `trailer`, test app, playtest, `beta`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/applist.service.js` | `buildApplist`, `search`, `isReady`, `getAllAppids`, `_index`, `_built` |
| `src/routes/relay/api/discover/search/+server.ts` | `GET /relay/api/discover/search?q=&limit=&offset=` (`relayRoute('discover')`) — calls `search()`, annotates each result with `isAdult` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  applist.json   ← [{ appid, name }] — raw from Steam API (~172k entries)
```

## Common questions

**Q: Why is the applist needed when `getGames()` already has all owned games?**
`getGames()` only covers the user's library. The applist covers the full Steam catalog — needed for guide search by name, ITAD lookups, and resolving store appids for non-owned games (wishlist items, recommendations).

**Q: Does the build block startup?**
No — `boot.js` starts it via `startScheduler('applist', ...)` (fire-and-forget, prod-only). `search()` returns empty (`isReady()` false) until the index is ready; the search route returns HTTP 503 (`App index not ready yet`) meanwhile.

## Gotchas

- `_index` only reflects the last download; new Steam games appear on the next weekly rebuild.
- Noise filtering happens at index-build time; `applist.json` retains all entries.
- `_built` guards against redundant rebuilds within a process lifetime; `buildApplist({ force: true })` bypasses both the file TTL and the `_built` guard.
- The exported search fn is `search`, not `searchApplist`.

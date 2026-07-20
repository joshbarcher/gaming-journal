# Recently Played Games

Caches the Steam recently-played list — games with playtime in the last two weeks per Steam's own recency window.

## Data flow

1. `syncRecentlyPlayed()` in `steam.service.js` calls `IPlayerService/GetRecentlyPlayedGames/v1/` with `count=0` (all games).
2. Shaped response `{ fetchedAt, totalCount, games }` written to `recently-played.json` via `file.set()` → `file.flush()`.
3. `getRecentlyPlayed()` returns `(await _loadRecentlyPlayedFile()).get()`.
4. Runs early in the 30-min steam tick (right after snapshot + derive) so the following `rebuild('account')` sees fresh data.
5. TTL is 1 hour (`RECENT_PLAYED_TTL_MS`) — shorter than games/wishlist because it is the most time-sensitive staleness signal.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/steam.service.js` | `syncRecentlyPlayed`, `getRecentlyPlayed`, `_loadRecentlyPlayedFile` |
| `src/routes/relay/api/steam/recently-played/+server.ts` | `GET /relay/api/steam/recently-played` → `getRecentlyPlayed()` |
| `src/routes/relay/api/steam/recently-played/sync/+server.ts` | `POST .../sync?force=` — synchronous sync + `rebuild('account')` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  recently-played.json   ← { fetchedAt, totalCount, games[] }
```

`games[]` entries from the Steam API include `appid`, `name`, `playtime_2weeks`, `playtime_forever`.

## Common questions

**Q: How is this different from `playtime-snapshots.json`?**
`recently-played.json` is a point-in-time fetch of Steam's own 14-day window with cumulative playtime. `playtime-snapshots.json` is the relay's rolling 30-day record of polling observations that drives session derivation.

**Q: Is recently-played used by the now-playing poller?**
No. The now-playing poller (`now-playing.service.js`) independently polls `GetRecentlyPlayedGames` every 60 s to detect active sessions. `recently-played.json` feeds the account/home page, not session tracking.

## Gotchas

- Steam's 2-week recency window is unrelated to the relay's 30-day snapshot retention — a game last played 20 days ago appears in snapshots but not here.
- During an active session, `playtime_2weeks`/`playtime_forever` here are stale (Steam updates totals only after a session ends); the now-playing service tracks live elapsed time separately.
- `totalCount` comes from the API `total_count`; `games.length` may differ if Steam truncates.
- `POST .../sync` is synchronous (caller waits) — unlike the reviews/store sync routes which are fire-and-forget.

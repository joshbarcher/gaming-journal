# Top Games

Steam player count leaderboard at `/top-games`. Shows the top 100 most-played games on Steam with current player counts, peak stats, and 24h trend sparklines. Refreshes automatically every 30 minutes.

## Data

`GET /relay/api/player-counts/top?n=100&includeFiltered=true` — returns up to 100 `TopGameEntry` records:

```ts
{
  appid:        number
  name?:        string
  latest?:      number      // current player count
  peak24h?:     number
  peak7d?:      number
  peakAllTime?: number
  samples24h?:  [number, number][]  // [timestamp, count] pairs for sparkline
  filtered:     boolean     // user has hidden this game
  owned?:       boolean     // in your Steam library
  wishlisted?:  boolean     // in your local wishlist
}
```

Auto-refreshes every 30 minutes via `setInterval`. `updatedAt` shows the local time of the last refresh.

## Table columns

| Column | Description |
|--------|-------------|
| # | Rank (filtered games show "—") |
| Game | Header thumbnail + name + owned/wishlisted badges |
| Now | Current player count |
| 24h Peak | Peak in last 24 hours (muted) |
| 7d Peak | Peak in last 7 days (muted) |
| All-Time | All-time peak (muted) |
| 24h Trend | SVG sparkline of 24h sample data |

Numbers formatted as `1.2M`, `34.5K`, or plain integers. `0` or null shows as "—".

## Filtering (hide games)

Each row has a mute button (circle-slash icon). Clicking it toggles `entry.filtered`:
- **Filtered/hidden**: `POST /relay/api/player-counts/filtered/{appid}` — adds to hidden list
- **Restored**: `DELETE /relay/api/player-counts/filtered/{appid}` — removes from hidden list

Filtered games still appear in the table (rank shows "—", row is visually muted) unless the "Hide filtered" toggle is active.

**Hide filtered toggle**: appears in the header when at least one game is filtered. Shows count of hidden games. Clicking it toggles `hideFiltered` — when active, filtered games are removed from `displayRows` entirely.

## Ownership badges

`owned` and `wishlisted` badges appear inline on the game name. These come from the relay's game ownership data embedded in the top games response.

## Sparkline

`samples24h` is an array of `[timestamp, count]` pairs. The sparkline downsamples to at most 30 points for rendering. Values are normalized to a 0–100 Y axis. Drawn as an SVG `<path>` with `non-scaling-stroke` so the line weight stays constant regardless of viewport width.

## No data state

If `allEntries.length === 0` (no data collected yet), the page shows a message: `"No data yet — trigger a collection first via POST /relay/api/player-counts/collect"`. Player count collection must be triggered at least once from the relay before the page shows anything.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/top-games/TopGames.svelte` | Top Games component |
| `src/routes/top-games/+page.svelte` | Route shell |
| `relay-server/src/controllers/player-counts/player-counts.controller.js` | `GET /api/player-counts/top`, filter endpoints |

## Common questions

**Q: The page shows "No data yet."**
The relay hasn't collected player count data. Trigger `POST /relay/api/player-counts/collect` from the relay (or wait for the scheduled collection to run). Once collected, the page populates.

**Q: A game I hid keeps showing up at rank "—".**
Filtering hides the rank but keeps the row. Use the "Hide filtered" toggle button in the header to remove filtered games from the table entirely.

**Q: The "Now" count seems stale.**
Player counts refresh every 30 minutes. The `updatedAt` timestamp in the subtitle shows when the last refresh completed. The relay fetches from Steam's player count API — there may be a further delay between Steam's data and what the relay has cached.

## Gotchas

- **`includeFiltered=true`** — the API always returns filtered games so the UI can show them muted. Filtering is client-side display logic, not a server-side exclusion.
- **`loadGameFilter()`** is applied client-side to the results — games the user has marked as software or filtered (via Settings) are removed from `allEntries` before display. This is separate from the top-games-specific per-entry `filtered` toggle.
- **Sparkline is SVG innerHTML** — `sparkline()` returns an HTML string injected via `{@html ...}`. It's a pure function; no component overhead.

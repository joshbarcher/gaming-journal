# Account Page

Steam account overview at `/account`. Shows the user's Steam profile, aggregate stats, recently played games, most-played games, and a session history log. All data comes from `GET /relay/api/account`.

## Data

Single fetch on mount: `GET /relay/api/account` — returns:

```ts
{
  profile: {
    name:        string
    realName?:   string
    avatar?:     string       // URL to avatar image
    memberSince?: string
    lastLogoff?:  string      // ISO timestamp
    profileUrl?:  string      // Steam profile URL
  },
  steam: {
    level?: number
    xp?:    number
  },
  stats: {
    totalHoursPlayed?:      number
    gamesPlayed?:           number
    achievementsUnlocked?:  number
    reviewsWritten?:        number
    totalGames?:            number
    wishlistCount?:         number
  },
  recentlyPlayed:  SteamGame[]
  mostPlayed:      SteamGame[]
  sessions:        Record<string, AccountGameRecord>  // appid → { name, sessions[] }
}
```

`loadGameFilter()` is applied to `recentlyPlayed`, `mostPlayed`, and sessions to exclude hidden/filtered games before display.

## Sections

### Hero

Avatar image, display name, real name (if set), Steam level badge, XP count, member-since date, last-logoff date, link to Steam profile.

### Stats strip

6 stat tiles: Hours Played, Games Played, Achievements, Reviews, Library size, Wishlist size. Values from `stats.*`.

### Recently Played

Horizontal card row of games played recently. Each card shows: header image, game name, "Xh Ym this week" (from `playtime2weeks`) or last played date, total hours.

### Most Played

Ranked list with a proportional fill bar. Bar width = `(playtimeMin / maxPlaytime) * 100%` relative to the #1 game. Shows rank number, header image, name, fill bar, total hours.

### Session History

All tracked sessions grouped by calendar day (local timezone via `localDateStr()`), sorted newest-first. Each session shows game name and duration. Live sessions (no `endedAt`) show a "Now Playing" badge and a live-ticking duration that updates every 30 seconds.

**Live sessions**: sessions with `endedAt === null` get a `liveTimer` that calls `tickLive()` every 30s. `tickLive()` computes `Math.max(1, floor((now - startedAt) / 60_000))` and updates `liveTimes[s.startedAt]`.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/account/Account.svelte` | Account page component |
| `src/routes/account/+page.svelte` | Route shell |
| `relay-server/src/controllers/account/account.controller.js` | `GET /api/account` aggregation |

## Common questions

**Q: Stats show "—" for everything.**
`stats` comes from the relay's account aggregation. If the relay hasn't synced account data from Steam yet (first run, or sync failed), stats fields will be null/undefined. Trigger a Steam account sync from the relay.

**Q: Session history is empty.**
Sessions are tracked by the relay's session poller — they accumulate over time. A fresh install with no tracked sessions will show "No sessions recorded yet."

**Q: Recently Played shows games I don't remember playing.**
`recentlyPlayed` comes from Steam's own recently-played API (`playtime2weeks > 0`). It reflects Steam's data, which may include brief accidental launches. `loadGameFilter()` removes hidden/filtered games but not ones you simply don't recognize.

## Gotchas

- **`localDateStr()` uses local time** — sessions are grouped by local calendar date, not UTC. Midnight-crossing sessions may appear split across two days.
- **Live timer leaks if component is destroyed during an active session** — the `liveTimer` `clearInterval` runs in the layout's `onDestroy` return. If you navigate away while a session is live, the timer stops correctly.
- **`recentlyPlayed` uses `playtime2weeks`** — this is Steam's rolling 2-week window, not a fixed "last N sessions." It resets periodically regardless of actual play.

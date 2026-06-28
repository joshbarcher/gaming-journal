# Journal Sessions

Sessions are automatically recorded play periods. The dashboard shows the active session live, the most recent closed session as a card, and a scrollable history rail of past sessions.

## Session data source

Sessions come from `GET /relay/api/account` → `account.sessions[appid].sessions[]`. The relay tracks session start/end by watching the Steam "now playing" state via polling.

Each session object:
```ts
{
  startedAt:    string    // ISO timestamp
  endedAt:      string | null
  durationMin:  number | null
  achievements: { apiname, unlocktime }[]  // earned during this session
}
```

The "now playing" endpoint (`GET /relay/api/steam/now-playing`) returns the active session separately:
```ts
{
  playing: {
    appid:            number
    sessionStartedAt: string   // when this session began
    achievementsDuring: { apiname, unlocktime }[]
    effectiveMin:     number   // playtime including current session
  } | null
}
```

## Playtime calculation during an active session

Steam's `playtimeMinutes` on the game object is **stale during an active session** — it doesn't update until the session ends. The dashboard compensates:

```
basePlaytimeMin   = game.playtimeMinutes (from relay at load time)
sessionElapsedMin = Math.floor((Date.now() - renderTime) / 60_000)  // updated every 30s
effectivePlaytimeMin = basePlaytimeMin + sessionElapsedMin
```

`renderTime` is captured at `onMount`. The 30-second timer (`startSessionTimer`) recalculates `sessionElapsedMin` from `activeSession.sessionStartedAt` — not from `renderTime` — to stay accurate if the page is left open for hours.

The HLTB pin position uses `effectivePlaytimeMin`, so it moves in real time during play.

See memory: [Playtime source of truth](../../../docs/play-times.md)

## Polling during an active session

When `activeSession` is set, two pollers start:

**Fast poller** (every 60s):
- Polls `GET /relay/api/steam/now-playing`
- If session ended: calls `loadData()` to reload everything, then restarts pollers
- If still active: checks `achievementsDuring` for new unlocks and updates `achDuring`

**Slow poller** (every 5 min):
- Polls achievements + game data
- Updates `rawAchList` if schema loaded or new achievements unlocked
- Updates `basePlaytimeMin` if not in an active session (passive refresh)

**Schema poller** (every 15s, max 8 tries):
- Only starts if `rawAchList` is empty at load time
- Retries until the achievement schema is available (can take time on first load)
- Stops once data arrives or after 8 attempts

## Key components

### LastSessionCard
Shows the most recent **closed** session (sorted by `startedAt`, not by `endedAt`). Displays duration and achievements earned. Uses the game header image as a background (`/relay/images/steam/games/{appid}/header.jpg`).

During an active session, this card is replaced by the "Now Playing" live view showing elapsed time and `achievementsDuring`.

### SessionHistoryRail
Horizontal scrolling row of session chips — up to 30 shown, each colored by a deterministic hash of `startedAt`. Displays date, duration, and achievement count. Sessions under 10 minutes are filtered out before this component receives props.

### SessionAchievements
Renders achievement icon strips. Used in both `LastSessionCard` (last session's achievements) and the active session card (achievements earned so far this session). Takes an `achMap` (apiname → AchievementItem) to resolve icons and labels.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalDashboard.svelte` | Polling logic, `activeSession` state, `startPollers/stopPollers` |
| `src/lib/svelte/journal/LastSessionCard.svelte` | Last closed session display |
| `src/lib/svelte/journal/SessionHistoryRail.svelte` | Past sessions horizontal scroll rail |
| `src/lib/svelte/journal/SessionAchievements.svelte` | Achievement icon strip for a session |
| `relay-server/src/services/steam/sessions.service.js` | Session recording + now-playing tracking |
| `relay-server/src/controllers/steam/sessions.controller.js` | `/api/steam/now-playing`, `/api/account` endpoints |

## Common questions

**Q: Why does playtime appear to jump when the session ends?**
At session end, `loadData()` reloads `game.playtimeMinutes` from Steam (now updated). This replaces the estimated `effectivePlaytimeMin` with the authoritative value, which may differ slightly from the timer estimate.

**Q: The "Now Playing" card isn't showing even though the game is running.**
The fast poller only starts if `activeSession` was set at page load. If you opened the journal dashboard before launching the game, the initial `GET /relay/api/steam/now-playing` returned null — so polling never started. Refresh the page.

**Q: Sessions under 10 minutes don't appear in the history. Is that a bug?**
No — intentional filter. `closedSessions` in `JournalDashboard` filters `durationMin >= 10` before passing to `SessionHistoryRail` and `LastSessionCard`. Brief accidental launches are suppressed.

**Q: Why does `achievementsDuring` sometimes show achievements the player already had?**
This shouldn't happen — the relay tracks achievements earned *after* `sessionStartedAt`. If it does occur, it's likely a relay-side timing issue with the session boundary. Check the relay's session tracking logic.

## Gotchas

- **`effectiveMin` vs `playtimeMinutes`**: the relay's now-playing response includes `effectiveMin` (playtime including current session). The HLTB doc notes that `game.js` still reads the stale Steam base value in one place — see the playtime memory for the known gap.
- **Pollers don't restart on route change** — they're tied to `JournalDashboard` lifecycle. Navigating away (e.g. to a guide) stops the pollers via `onDestroy`. They restart when the dashboard remounts.
- **`schemaTimer` stops itself** after 8 tries — it won't retry indefinitely if achievements are unavailable for a game.

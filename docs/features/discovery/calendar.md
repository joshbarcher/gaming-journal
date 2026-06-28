# Calendar

Play history and upcoming release calendar at `/calendar`. Two modes share the same `Calendar` component — switched via URL param.

## Modes

| Mode | URL | Description |
|------|-----|-------------|
| `play` | `/calendar` | Play session history — which games were played on which days |
| `releases` | `/calendar?mode=releases` | Upcoming release dates from wishlisted/discovered games |

Mode is derived from the URL: `page.url.searchParams.get('mode') === 'releases'`. Switching modes updates the URL param; the `localMode` state inside Calendar mirrors it.

## Play mode

### Data

- `GET /relay/api/steam/games` (via the cached `LP_CACHE_KEY` in localStorage with a 7-day TTL) — list of all games with `rtime_last_played` timestamps
- Session data from relay (play sessions with start/end times) — processed via `buildDayMap()` into a `Map<dateString, DayEntry[]>`

`DayEntry`:
```ts
{
  appid:       number
  name:        string
  durationMin: number
  isLive?:     boolean
}
```

### Live session overlay

Calendar plays a live session poller while `localMode === 'play'`. Every tick:
1. Reads the current `NowPlayingSession` from the relay
2. Computes `liveMin = floor((now - effectiveStart) / 60_000)`
3. Builds `effectiveDayMap` — a copy of `dayMap` with today's entry updated (or added) to show the live session duration with `isLive: true`

The `effectiveDayMap` is `$derived` off `liveTick` (an integer that increments each poll), so the calendar cell re-renders without a full data reload.

`liveEffectiveStart` is set when the poller first detects a session — it tracks the start of the current tick window to prevent drift from poller scheduling delays.

### Calendar rendering

`CalendarMonth` renders a grid of weeks for the current month/year. Each day cell (`CalendarCell`) shows:
- Colored dots or bars for each game played that day (color mapped per game via a stable hash)
- Live badge if `isLive: true`
- Hover tooltip with session details

Navigate months with prev/next arrows. Year can be changed. Today's date is highlighted.

## Releases mode

`buildReleaseMap()` — processes games with known `store.releaseDateIso` values into a `Map<dateString, ReleaseEntry[]>`.

`ReleaseEntry`:
```ts
{
  appid:       number
  name:        string
  releaseDate: string  // ISO date string
}
```

Calendar cells in release mode show upcoming release dates from your wishlist and discovered games. Days in the past with no sessions are empty; future days show release bubbles.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/calendar/Calendar.svelte` | Main calendar component, mode/data orchestration |
| `src/lib/svelte/calendar/CalendarMonth.svelte` | Month grid layout |
| `src/lib/svelte/calendar/CalendarCell.svelte` | Individual day cell |
| `src/lib/js/views/calendar-render.js` | `buildDayMap()`, `buildReleaseMap()`, `buildLastPlayedOverlay()`, `localDateStr()`, `splitAtMidnight()` |
| `src/routes/calendar/+page.svelte` | Route shell (derives mode from URL, mounts Calendar) |

## Common questions

**Q: Play mode shows no sessions for days I definitely played.**
Sessions are built from relay session data. If the relay wasn't running during play (or the Steam poller didn't detect the session), sessions won't appear. The calendar only shows tracked sessions, not Steam's raw `rtime_last_played`.

**Q: The live session bar doesn't update.**
The live poller only runs in `play` mode. Switching to `releases` mode stops the poller. If the poller is running but not updating, check that the relay's now-playing endpoint is responding.

**Q: Release mode shows games I didn't add to my wishlist.**
Releases mode includes games from both the local wishlist and "discovered" games (games found via the Discover page that the relay has cached). Not just the local wishlist.

## Gotchas

- **`LP_CACHE_KEY`** — the game list (for `rtime_last_played` overlays) is cached in localStorage for 7 days. Stale game data may show old "last played" overlays. Clear `cal-lp-games` to force a fresh fetch.
- **`splitAtMidnight()`** — sessions that cross midnight are split into two day entries so each day's duration is correct. A 3-hour session starting at 11pm appears as ~1h on day 1 and ~2h on day 2.
- **`localDateStr()`** uses local time, not UTC** — all day keys are local calendar dates. Sessions stored in UTC are converted to local time before being placed in the day map. This means your calendar matches your local timezone, not the server's.

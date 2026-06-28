# Journal Progress Trackers

Per-game progress trackers let users track completion of objectives, segments, collectibles, etc. Four tracker types, all stored as `Page` records and rendered at `/{pageId}`.

## Tracker types

| Type | Component | Use case |
|------|-----------|----------|
| `progress` | `Progress.svelte` | Single segmented progress bar (chapters, acts, zones) |
| `progress-bars` | `ProgressBars.svelte` | Multiple independent bars (e.g. each character's story) |
| `counter` | `Counter.svelte` | Single numeric counter with a target (e.g. collectibles: 47/100) |
| `multi-counter` | `MultiCounter.svelte` | Multiple named counters in one tracker |

## Data flow

1. `JournalProgress` → `GET /api/pages?appid={appid}` → filters for `TRACKER_TYPES`
2. "+ Progress" / "+ Multi-Bar" etc. → `POST /api/pages` with type + default data → relay creates record → `navigate(page.id)` → opens tracker editor
3. Each tracker component loads its own data at `/{pageId}` and saves changes via `PUT /api/pages/{pageId}`

## Dashboard preview

`JournalDashboard` calls `globalSegments(page)` to render a mini segment bar for each tracker in the summary cards. `globalSegments` extracts the visual state from the page's data without rendering the full tracker component.

Segment bar fields: `{ color, label?, stateLabel?, flex? }` — colored blocks that add up to represent overall completion.

## HLTB integration

The HLTB (HowLongToBeat) card on the dashboard shows milestones (Main, Main + Extras, Completionist) against the player's current playtime as a pin on a bar.

- Data source: `game.hltb` from `GET /relay/api/games/{appid}` — fields: `gameplayMain`, `gameplayMainExtra`, `gameplayCompletionist` (all in hours)
- Scale: square-root (`√h / √hltbMaxScale * 100`) to prevent extreme right-skew
- Pin position: `hltbPinPct` derived from `effectivePlaytimeMin / 60` (live during sessions)
- The HLTB data is fetched/refreshed from HowLongToBeat.com via a relay scraper; a "Refresh HLTB" button in the dashboard header triggers `POST /relay/api/hltb/refresh/{appid}`

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalProgress.svelte` | Tracker list, create, delete |
| `src/lib/svelte/progress-tracker/Progress.svelte` | Single segmented bar tracker |
| `src/lib/svelte/progress/ProgressBars.svelte` | Multi-bar tracker |
| `src/lib/svelte/counter/Counter.svelte` | Single counter |
| `src/lib/svelte/multi-counter/MultiCounter.svelte` | Multi-counter |
| `src/lib/svelte/game/HltbSection.svelte` | HLTB display on game page |
| `src/lib/js/views/progress-helpers.js` | `globalSegments()`, `pagePct()`, `percentToColor()` |
| `relay-server/src/controllers/hltb/hltb.controller.js` | HLTB fetch + cache |

## Common questions

**Q: How does `globalSegments` know how to render a tracker it hasn't mounted?**
It reads the page's `data` field directly and interprets it by `page.type`. Each tracker type stores its segments/counters in a known schema. `globalSegments` is a pure function — no DOM involved.

**Q: The HLTB data is wrong or missing. How do I refresh it?**
Click the refresh icon next to the HLTB card header on the dashboard. This triggers `POST /relay/api/hltb/refresh/{appid}` which re-scrapes HowLongToBeat. The match is fuzzy by game name — if the wrong game was matched, there's no UI to correct it; it must be fixed in the relay data.

**Q: Can trackers be shared between games?**
No — each tracker has an `appid` field and is scoped to one game. The `JournalProgress` list filters by `appid`.

## Gotchas

- **`TRACKER_TYPES` constant** (`journal-render.js`) is the single source of truth for which page types are trackers vs. pages. If adding a new tracker type, update this list or it won't appear in JournalProgress.
- **Deleting a tracker is irreversible** — there's a `confirmDialog` guard, but no soft delete or undo. The page record and all its data are permanently removed.
- **HLTB pin uses live playtime** (`effectivePlaytimeMin`) during an active session, so it moves as you play. After the session ends and data reloads, it snaps to the authoritative Steam playtime.

# Journal Overview

The journal is the per-game hub: a dashboard showing playtime, achievements, session history, review, progress trackers, guides, and HLTB data for one game. Accessed at `/journal/{appid}`.

## URL structure & sub-routes

```
/journal/{appid}                          ← JournalDashboard (main hub)
/journal/{appid}/guides                   ← GuidesList (downloaded guides)
/journal/{appid}/guides/{source}/{id}     ← Guide landing page
/journal/{appid}/guides/{source}/{id}/{slug}  ← Guide section
```

The `[[sub]]` segment in the route (`src/routes/journal/[appid]/[[sub]]/+page.svelte`) handles sub-pages like `notes`, `progress`, `pages` within the journal. These render different Svelte components inside `GameJournal.svelte` based on the sub value.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalDashboard.svelte` | Main hub component — all cards, data loading, polling |
| `src/lib/svelte/journal/GameJournal.svelte` | Outer wrapper, routes sub-pages (notes/progress/pages/guides) |
| `src/lib/svelte/journal/LastSessionCard.svelte` | "Last Session" card — most recent session stats |
| `src/lib/svelte/journal/SessionHistoryRail.svelte` | Horizontal scroll rail of past session chips |
| `src/lib/svelte/journal/SessionAchievements.svelte` | Achievement icons earned during a session |
| `src/lib/svelte/journal/AchievementStrip.svelte` | Compact achievement row (recent unlocks) |
| `src/lib/svelte/journal/JournalNotes.svelte` | Sticky-note wall sub-page |
| `src/lib/svelte/journal/JournalProgress.svelte` | Progress tracker list sub-page |
| `src/lib/svelte/journal/JournalPages.svelte` | Rich pages list sub-page |

## Dashboard data loading

On `onMount`, `loadData()` fires 7 parallel fetches:

| Data | Endpoint |
|------|----------|
| Game data (name, playtime, store info, HLTB) | `GET /relay/api/games/{appid}` |
| Local review | `GET /api/local-reviews/{appid}` |
| Pages (journal pages + trackers) | `GET /api/pages?appid={appid}` |
| Journal notes (sticky notes) | `GET /api/journal-notes/{appid}` |
| Steam achievements | `GET /relay/api/steam/achievements/{appid}` |
| Account (sessions per game) | `GET /relay/api/account` |
| Now playing | `GET /relay/api/steam/now-playing` |

Two additional non-blocking fetches run in parallel (guides list + search cache) — they resolve independently and don't block the initial render.

## Dashboard card layout

The dashboard uses a CSS grid (`gj-grid--with-guides`). Key positions:

- **Col 1–2**: Last Session card (or "Now Playing" during active session), HLTB card, Session History Rail
- **Col 3**: Guides card (always, spans rows 2–3)
- **Additional cards**: Achievement strip, review summary, recent journal pages, progress tracker previews

The Guides card must appear before the HLTB card in the DOM so CSS auto-placement fills cols 1–2 around it.

## Page types

Pages (from `GET /api/pages`) are split into two groups:

- **Tracker types** (`TRACKER_TYPES`): `progress`, `progress-bars`, `counter`, `multi-counter` — shown in JournalProgress
- **Page types**: `page`, `notes` — shown in JournalPages

Both groups show preview segments on the dashboard.

## Common questions

**Q: The dashboard shows stale playtime during an active session. Why?**
Steam playtime is only updated when a session ends. The dashboard uses `effectivePlaytimeMin = basePlaytimeMin + sessionElapsedMin`, where `sessionElapsedMin` is calculated from `activeSession.sessionStartedAt` via a 30-second timer. See [sessions.md](sessions.md) and the playtime memory entry.

**Q: Where are journal notes stored?**
Server-side via `api.journalNotes.set(appid, notes)` → relay endpoint → JSON on disk. Not localStorage.

**Q: How does the dashboard know a game is currently being played?**
`GET /relay/api/steam/now-playing` returns `{ playing: { appid, sessionStartedAt, achievementsDuring, … } }`. If `playing.appid === Number(appid)`, an `activeSession` is set and the live session UI activates.

## Gotchas

- **`closedSessions` filters out sessions under 10 minutes** (`durationMin >= 10`) — very short sessions (e.g. launch-then-close) are hidden from the history rail and Last Session card.
- **Achievement list merges Steam + session data** — `mergeSessionAchievements(rawAchList, achDuring)` overlays achievements earned during the current session onto the base Steam list so unlocks appear immediately without waiting for a Steam sync.
- **HLTB uses a square-root scale** — `hltbPct(h) = (√h / √hltbMaxScale) * 100`. Raw linear scale would cluster short games on the left with outliers far right.

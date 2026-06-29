# AI Auto-Trackers

When a user clicks ✦ on the journal dashboard, Claude searches the web for completion guides and generates a set of progress tracker definitions that are automatically saved as pages.

## Data flow

1. User clicks ✦ → `JournalDashboard.enqueueTrackerSuggest()` → `POST /relay/api/progress-suggest/jobs` with `{ steamId, gameName }`
2. Relay adds job to the in-memory queue (`suggest-job-queue.js`), immediately broadcasts it to all SSE clients, then runs `suggestTrackers()` async
3. `suggestTrackers()` calls `claude-sonnet-4-6` with the `web_search_20260209` tool. Claude searches for completion guides, trophies, collectible counts, etc. — typically 10–25 searches
4. Web search responses may trigger `pause_turn`; the service loops up to 10 turns to handle this
5. When Claude returns `end_turn`, `parseTrackers()` extracts the JSON array from the response and adds per-item `id` fields via `withIds()`
6. The relay broadcasts job status updates (`pending → running → done/error`) over SSE at `GET /relay/api/progress-suggest/jobs/stream`
7. `trackerSuggestJobStore` (singleton, connected in `+layout.svelte`) receives events and updates reactive state
8. `DownloadsPage.svelte` detects the completed job via `$effect`, calls `api.pages.create({ ...tracker, appid })` for each tracker definition
9. Created job IDs are persisted to `localStorage['tracker-jobs-created']` to prevent re-creation on revisit

**While a job is in-flight,** the dashboard ✦ button is replaced by an "→ Downloads" link so the user can navigate to watch progress.

## Progress calculation

| Phase | Progress value |
|-------|---------------|
| Each web search completed | `min(85, round(count / 15 * 85))` — asymptotic to 85% |
| Writing (text block starts) | 90% |
| Done | 100% |

## Prompt rules

The system prompt instructs Claude to:
- Use actual in-game names for all sub-items (never "Task 1", "Item 2", etc.)
- Not double-count: if a total counter exists (e.g. 173 Personas), don't also list sub-components
- Choose tracker type based on content shape (sequential = `progress`, repeated-steps = `progress-bars`, large unnamed collection = `counter`, multiple named totals = `multi-counter`)
- Cap at 12 trackers; let the guides found determine how many are needed — no artificial minimum

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/progress-suggest/progress-suggest.service.js` | `suggestTrackers()` — Claude API call, multi-turn loop, `parseTrackers()`, `withIds()` |
| `relay-server/src/services/progress-suggest/suggest-job-queue.js` | In-memory job queue, SSE broadcast, async job runner |
| `relay-server/src/controllers/progress-suggest/progress-suggest.controller.js` | `POST /jobs`, `GET /jobs`, `GET /jobs/stream`, `DELETE /jobs/:id` |
| `relay-server/src/routers/progress-suggest/progress-suggest.router.js` | Route wiring |
| `src/lib/tracker-suggest-jobs.svelte.ts` | `TrackerSuggestJobStore` — Svelte 5 singleton, EventSource client, `jobFor(steamId)` |
| `src/routes/+layout.svelte` | Connects/disconnects `trackerSuggestJobStore` alongside `jobStore` |
| `src/lib/svelte/journal/JournalDashboard.svelte` | ✦ button, active-job link, `enqueueTrackerSuggest()` |
| `src/lib/svelte/downloads/DownloadsPage.svelte` | Creates pages on job completion, persists `pageCreated` to localStorage |

## Common questions

**Q: Why does the ✦ button show "→ Downloads" instead of a spinner?**
The job runs in the relay, not the page. Navigating away doesn't cancel it. The link lets the user go watch progress without blocking the dashboard.

**Q: Why are pages created in `DownloadsPage` and not in the relay when the job finishes?**
The relay has no knowledge of the gaming-journal's page storage. Tracker JSON is a relay-side concern; creating `Page` records is a gaming-journal concern. The relay just delivers the final tracker array.

**Q: How do I re-run if I don't like the results?**
Delete the generated trackers from `/journal/{appid}/progress` (each has a delete button), then clear `localStorage['tracker-jobs-created']` in devtools, then click ✦ again. Clearing localStorage is required because the Downloads page uses it to avoid double-creating.

**Q: The relay shows the job as running but nothing created. What happened?**
The job broadcasts are in-memory. If the relay restarted while the job was running, the job is gone. The SSE stream will have closed; the gaming-journal store will show stale state until page reload. Re-run the job.

## Gotchas

- **Jobs are in-memory on the relay.** A relay restart clears all pending and running jobs, including their completed tracker data. If the relay restarts before the Downloads page creates pages, the tracker JSON is lost.
- **`parseTrackers` uses a bracket-counting scanner**, not a regex. This is intentional — Claude's response sometimes contains explanatory text with `[1]` citation brackets before the JSON array, which breaks a greedy `[\s\S]*]` match. The scanner walks left-to-right, respects string contents, and validates each candidate array is an array of objects before accepting it.
- **The SSE connection is layout-level**, opened on `onMount` in `+layout.svelte`. It stays alive across page navigation and is only torn down when the app unmounts. A network error closes the EventSource; it does not auto-reconnect.
- **`tsInitialized` flag in `DownloadsPage`** — the `$effect` that auto-creates pages is gated on `tsInitialized`, which is set to `true` at the end of `onMount` after `localStorage` is loaded. This prevents a race where the effect fires before the `pageCreated` Set is populated, which would double-create pages on every revisit.

# Progress Suggest

AI-powered feature that auto-generates game-specific progress trackers for a completionist run. Pipes a research prompt through the `claude` CLI (`WebSearch`/`WebFetch` allowed), parses a structured tracker-definition array, and (post fold-in) saves the trackers into the journal itself.

## Data flow

### Job lifecycle
1. Client `POST /relay/api/progress-suggest/jobs` with `{ steamId, gameName }`.
2. `enqueueJob()` adds a job to `_jobs[]` (in-memory, not persisted). Dedupes: returns the existing `pending`/`running` job for the same steamId.
3. `_runJob()` calls `suggestTrackersViaCli()`.
4. Progress + log events broadcast via SSE to all clients (`GET /relay/api/progress-suggest/jobs/stream`). A `snapshot` frame is sent on connect; then whole-job frames plus `{type:'log',id,line}` per-line deltas.
5. On success, `_persistTrackerPages()` POSTs each tracker to the journal's own `/api/pages` (loopback), then the job goes `done`. If nothing saved, the job goes `error`.

### CLI path (`suggestTrackersViaCli` — `progress-suggest-cli.service.js`)
- Spawns `claude -p --model claude-opus-4-8 --output-format stream-json --verbose --allowedTools WebSearch,WebFetch` (`shell: true` for the Windows `.cmd` wrapper), pipes the prompt to stdin.
- Strips `ANTHROPIC_API_KEY` from the child env so it bills against the Max/OAuth subscription. Prepends the node bin dir to `PATH` so `claude` resolves.
- Parses NDJSON stream events, blends time + tool-activity progress, saves a failure dump to `data/failed-responses/` on non-zero exit or parse error. 15-min timeout.
- Shares `buildPrompt` / `parseTrackers` (which applies `withIds`) from `progress-suggest.service.js`.

### Tracker types
`progress` (tasks), `progress-bars` (bars), `counter` (numeric target), `multi-counter` (counters[]). Each task/counter gets a UUID `id` via `withIds()` inside `parseTrackers`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/progress-suggest/suggest-job-queue.js` | Queue, SSE broadcast, `enqueueJob`, `getJobs`, `cancelJob`, `addSseClient`, `_persistTrackerPages` |
| `src/lib/server/relay/progress-suggest/progress-suggest-cli.service.js` | `suggestTrackersViaCli` — the only execution path |
| `src/lib/server/relay/progress-suggest/progress-suggest.service.js` | `buildPrompt`, `parseTrackers` (+ private `withIds`) |
| `src/lib/server/relay/progress-suggest/tracker-timings.store.js` | `getEstimatedMs`, `recordCompletion` — progress-bar ETA |
| `src/routes/relay/api/progress-suggest/*` | `/jobs` (GET/POST), `/jobs/stream` (SSE), `/jobs/[jobId]`, `/[appid]` (POST direct SSE, debug) |

## Common questions

**Q: How are jobs billed?**
Every job runs via `claude -p` against the Max/OAuth subscription (~0 marginal cost). The old Anthropic-API path was removed entirely — there is deliberately no fallback and no `USE_CLAUDE_CLI` toggle in the folded-in code.

**Q: Where do generated trackers go now?**
Post fold-in, the queue saves them directly to `/api/pages` in the same process (`JOURNAL_URL`, default `http://localhost:$PORT`) via `_persistTrackerPages`. The job's final state reflects whether the save succeeded — a save failure marks the job `error`, not `done`.

**Q: Why in-memory jobs?**
Jobs finish in minutes; a restart clears them. `_jobs` is module-level with no size cap (bounded only by restart); logs are capped at 300 lines per job.

## Gotchas

- Job statuses are `pending` / `running` / `done` / `error` / `cancelled` — note `done`, not `completed`.
- The model is pinned to `claude-opus-4-8` so dev and prod don't drift to each machine's CLI default.
- The `POST /[appid]` route streams the CLI directly as SSE with no job entry and no page persistence — debug/dev only.
- Replacing the `/api/pages` HTTP loopback with a direct service call is a noted follow-up (validation + task-id normalization live in the route handler).

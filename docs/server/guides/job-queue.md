# Guides Job Queue

In-memory queue that manages guide download jobs. Each job runs two sequential child-process phases (fetch, then parse). SSE broadcast keeps all browser tabs in sync. Cleared on server restart.

## Data flow

1. Client POSTs `POST /relay/api/guides/jobs` with `{ steamId, source, guideId, url, gameName }` → `enqueueJob(...)`, `202` + the job object.
2. `enqueueJob` dedups: an existing `pending`/`running` job for the same `(steamId, source, guideId)` is returned instead of creating a duplicate.
3. New job pushed to module-level `_jobs[]`; `_schedule()` runs immediately.
4. `_schedule()` picks the first `pending` job whose `source` has no `running` job. **One job per source at a time.**
5. `_runJob(job)` runs two phases via `_runScript`, spawning `process.execPath` on the tool in `TOOLS_DIR`:
   - **Fetch**: `fetch-guide.js --url <u> --steam-id <id> --source <src> --guide-id <id>`
   - **Parse**: `parse-guide.js --steam-id <id> --source <src> --guide-id <id>`
6. Child stdout/stderr is read line-by-line. `[PROGRESS] {json}` updates the `pages`/`subtask`/`download` bars (tolerated even mid-line). Legacy `[n/N]` lines update `download` unless the child already emitted a `[PROGRESS] download`. All other lines append to `job.log[]` (rolling last 100).
7. On success: `sizeBytes` = `dirSize()` of the guide dir; status → `done`; broadcast.
8. `_schedule()` runs again in `finally` to start the next pending job.

### SSE endpoint
`GET /relay/api/guides/jobs/stream` — clients receive every job update. On connect it sends a `: connected` comment, then a full-state `{ type: 'snapshot', jobs }` frame if any jobs exist, so a late-joining tab hydrates immediately. The route wraps the Express-shaped client the queue expects (`write`/`writableEnded`/`on('close')`) around a `ReadableStream` controller.

### Alternate direct-download path
`POST /relay/api/guides/:steamId/download` (`beginDownload`) runs the same fetch→parse child pipeline but streams progress over its own SSE response (`{ phase: 'fetch'|'parse'|'progress'|'done'|'error' }`) **without** going through `_jobs[]`. It has its own in-flight guard (`_downloading` set, `409` if busy). The queue and this endpoint are two independent entry points to the same two tools.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/guides/job-queue.js` | `enqueueJob`, `cancelJob`, `getJobs`, `addSseClient`, `_schedule`, `_runJob`, `_runScript`, `broadcast` |
| `src/routes/relay/api/guides/jobs/+server.ts` | `GET` list · `POST` enqueue (202) |
| `src/routes/relay/api/guides/jobs/[jobId]/+server.ts` | `DELETE` cancel (409 if not cancellable) |
| `src/routes/relay/api/guides/jobs/stream/+server.ts` | SSE stream + snapshot hydration |
| `src/lib/server/relay/guides/tools-dir.js` | `TOOLS_DIR` = `<cwd>/src/lib/server/relay/guides/tools` |

## Common questions

**Q: What does "one job per source" mean?**
A second gamefaqs guide waits behind a running gamefaqs one, but an ign guide runs in parallel. Prevents hammering a single source.

**Q: Can a job be cancelled?**
Only while `status === 'pending'` (`cancelJob` → `DELETE …/jobs/:jobId`). A running child process cannot be interrupted; it runs to completion.

**Q: Does the queue survive a server restart?**
No. `_jobs` is module-level, in-memory. Restart clears it. Any partially fetched `_raw/` on disk stays; re-enqueueing skips pages already downloaded.

## Gotchas

- `_runScript` spawns with `process.execPath` and inherits `process.env`, so `DATA_DIR` (and any `RELAY_DATA_ROOT`) must be in the app's environment for the tools to find storage.
- The rolling log keeps only the last 100 lines; full child output is not separately persisted.
- `dirSize` for `sizeBytes` walks the full guide dir after completion — cost scales with images on disk.
- `TOOLS_DIR` resolves from `process.cwd()` (not `import.meta.dirname`) because the adapter-node build relocates bundled modules; the spawned tools must load from the `src/` source tree, which both `vite dev` and the prod pm2 process run from.

# Guide Download Queue — Design

## Problem with the current model

Downloads are driven by an SSE connection owned by the browser tab. A page refresh kills the connection, losing progress visibility even if the child process is still running. Search and download share a Puppeteer browser singleton, causing search to be locked out during downloads. There is no queue — each download is ad-hoc with no awareness of other in-flight jobs.

## Architecture

### Server: persistent job queue

The relay holds an in-memory job queue — an array of job objects:

```
{
  id:          string (uuid)
  steamId:     string
  source:      'gamefaqs' | 'ign' | 'steam' | 'game8' | 'gamerguides' | 'fandom'
  guideId:     string
  url:         string
  gameName:    string
  status:      'pending' | 'running' | 'done' | 'error'
  progress:    { download: number, pages: number, subtask: number }
  error?:      string
  createdAt:   ISO string
  startedAt?:  ISO string
  completedAt? ISO string
}
```

Jobs are in-memory only — lost on relay restart, which is acceptable since relay restarts are rare and re-queuing is trivial.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/guides/jobs` | Enqueue a job. Returns `{ jobId }`. |
| `GET`  | `/api/guides/jobs` | Full job list — used to hydrate on page load. |
| `GET`  | `/api/guides/jobs/stream` | SSE — broadcasts every job state change to all connected clients. |
| `DELETE` | `/api/guides/jobs/:jobId` | Cancel a pending job. |

### Concurrency rules

- **One job per source at a time.** The scheduler inspects what is currently running before pulling the next pending job. If the next job targets a source already in use, it skips to the first pending job whose source is free.
- **Up to 6 parallel jobs** (one per source: gamefaqs, ign, steam, game8, gamerguides, fandom). In practice 2–3 concurrent is typical.
- Each running job launches its **own Puppeteer browser instance** at job start and closes it when the job finishes or errors. Browser instances are never shared between jobs.

### Search browser — separate singleton

Search (`POST /api/guides/:steamId/search`) uses its own per-source browser singletons, completely separate from the download queue. Nothing in the download path touches these instances. Search is never locked out by a running download.

Search browsers are warm singletons (launch once, reuse). Download browsers are per-job (launch at start, close at end).

## Frontend

### Nav element

A "Downloads" entry in the left sidebar nav. Displays a live badge with the count of active + pending jobs. Badge disappears when the queue is empty.

### Downloads page

Clicking the nav entry opens a dedicated `/downloads` route (not a floating widget — avoids z-index and hover-cover issues). Shows:

- Active jobs with per-phase progress bars (Fetch / Parse / Contents)
- Pending jobs in queue order
- Recently completed / errored jobs
- Cancel button on pending jobs

### Job store

A single Svelte store (`jobQueue`) at the root layout level. On mount: `GET /api/guides/jobs` to hydrate. Then opens SSE to `/api/guides/jobs/stream` and patches the store on every event. All pages read from this store — they never manage their own download SSE connections.

### GuidesModal integration

The download button checks the job store before acting:

- If a job for this `(steamId, source, guideId)` is `pending` or `running` → show queued/downloading state, disable button
- If `done` → show as downloaded (same as today)
- Otherwise → show Download button, clicking enqueues via `POST /api/guides/jobs`

The modal updates reactively as job state changes in the store — no manual polling.

## What this replaces

- `handleDownload` in `guides.controller.js` — replaced by job enqueue + worker
- Per-download SSE in `GuidesModal.svelte` — replaced by the global job store
- Shared browser singleton in fetchers — replaced by per-job browser instances
- Search lockout during downloads — eliminated by full separation

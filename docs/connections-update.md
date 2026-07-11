# Connection Architecture Update

## The Problem

Opening 8+ game tabs causes the last 1-2 to hang indefinitely. Root cause: HTTP/1.1 caps at **6 concurrent connections per origin**. With 8 tabs each firing ~7 requests on mount, plus 2 SSE connections permanently held by the SharedWorker, requests pile up behind a 4-slot queue that never fully clears.

### What's eating the connection pool

**Permanent (always open):**
- 2 × `EventSource` in the SharedWorker — guide-jobs stream + tracker-jobs stream
- These are held open indefinitely, even when browsing game pages with no active downloads

**Burst on mount (per tab, every open):**
- `fetch('/api/pages')`
- `fetch('/api/flags')` + `fetch('/relay/api/account')` + `fetch('/api/franchises')` — collection counts
- `fetch('/api/alerts')`
- `fetch('/relay/api/steam/playtime/last-played')` — history backdrop
- `fetch('/relay/api/steam/now-playing')` + `fetch('/relay/api/pin')` — previously moved to SharedWorker

8 tabs × ~7 requests = ~56 requests competing for 4 remaining slots (after SSE takes 2).

---

## Options Considered and Dismissed

### HTTP/2
Multiplexes all HTTP traffic over one TCP connection — eliminates the 6-connection limit entirely. But browsers require TLS for HTTP/2, even on localhost. User does not want to run everything over HTTPS.

### WebSocket (shared via SharedWorker)
`ws://` requires no TLS. One WebSocket in the SharedWorker carries all push updates, doesn't count against the HTTP connection pool. Solves the persistent-connection problem. But regular `fetch()` calls still use the HTTP pool — mount burst still happens. WebSocket only helps the SSE portion of the problem, not the request burst.

### Reduce per-tab connections (visibility deferral)
Guard `onMount` fetches with `document.hidden` — background tabs defer until focused. Quick fix, reduces burst. But doesn't address the architectural misuse (fetching in every tab what should be fetched once).

---

## The Plan

Three changes, independent of each other, ordered by impact:

### 1. SSR the sidebar data — `+layout.server.ts`

Move all layout mount fetches to a server load function. Data arrives with the initial HTML — zero extra connections on page load.

```ts
// src/routes/+layout.server.ts
export async function load() {
    const [flags, account, franchises, pages, alerts, playtime, nowPlaying, pin] =
        await Promise.all([...])

    return { counts, pages, alertsCount, historyAppid, nowPlaying, pin }
}
```

Server-to-relay calls are direct (no proxy hop). They never touch the browser's connection pool.

**On client-side navigation:** SvelteKit does NOT re-run `+layout.server.ts` unless its dependencies change. The data is cached for the session. Navigation is instant.

**Invalidation strategy:**
- `invalidate('app:pages')` — call this after creating or deleting a page (1–2 spots)
- Everything else (counts, alerts): let navigation handle it. SvelteKit re-runs the load naturally when you move between pages. For a single-user personal app, "counts update on next navigation" is fine.
- Don't try to wire `invalidate()` into every flag mutation — you'll miss one, and the staleness is unimportant.

### 2. Shared now-playing/pin poll via BroadcastChannel

The initial values of `nowPlaying` and `pin` arrive via SSR (see below). After that, sessions start and stop externally — there's no user action to hook onto — so the sidebar keeps them live via a client-side poll shared across tabs with `BroadcastChannel`.

Two additions beyond the basic poll: a `visibilitychange` listener fires `poll()` directly (bypassing the 60s rate limit) when returning to a tab that's been away for 15+ seconds, and a `polling` flag prevents concurrent fetches if the interval and a visibility event race.

```ts
// In +layout.svelte
const channel = new BroadcastChannel('sidebar-poll')

channel.onmessage = ({ data: msg }) => {
    applyNowPlaying(msg.nowPlaying ?? null)
    store.pin = msg.pin ?? null
}

let polling = false
async function poll() {
    if (polling) return
    polling = true
    try {
        const [npRes, pinRes] = await Promise.all([...])
        // update store + channel.postMessage + write localStorage timestamp
    } finally { polling = false }
}

async function maybePoll() {
    const last = Number(localStorage.getItem('sidebar_last_poll') ?? 0)
    if (Date.now() - last < 60_000) return
    await poll()
}

function onVisibilityChange() {
    if (document.hidden) return
    const last = Number(localStorage.getItem('sidebar_last_poll') ?? 0)
    if (Date.now() - last > 15_000) poll()
}

document.addEventListener('visibilitychange', onVisibilityChange)
setInterval(maybePoll, 60_000)
maybePoll()
```

Tab 1 opens → SSR seeds the card instantly, poll runs in background, broadcasts result. Tabs 2–8 open → SSR again, timestamp fresh, skip poll. Returning to a background tab → visibility event triggers immediate refresh if 15s have elapsed. **Result: card visible on first paint; 1 relay request per minute at steady state.**

### 3. One EventSource, one component — DownloadsPage

Only `DownloadsPage.svelte` needs live updates. The others don't:

- **GuidesModal** — one-time REST fetch on open to hydrate job state, then shows "Queued" on enqueue. No progress bar in the modal; that's what the downloads page is for. Guide jobs SSE stream is not needed anywhere.
- **Guide viewer pages** — display already-downloaded content, no live state needed.

`DownloadsPage` opens a direct `EventSource` on mount, but also closes it when the tab goes into the background — the relay sends a snapshot on every connect, so switching back immediately resyncs:

```ts
onMount(() => {
    let es: EventSource | null = null

    function open() {
        if (es) return
        es = new EventSource('/relay/api/progress-suggest/jobs/stream')
        es.onmessage = (e) => { /* update state */ }
    }

    function close() {
        es?.close()
        es = null
    }

    document.addEventListener('visibilitychange', () => {
        document.hidden ? close() : open()
    })

    if (!document.hidden) open()

    return () => close()
})
```

At rest (browsing games): **0 persistent connections.**  
On the downloads page, tab visible: **1 EventSource.**  
Downloads page in background tab: **0** — closes on hide, reopens on focus.

---

## SharedWorker — Remove It

The SharedWorker was introduced to avoid per-tab SSE connections. With SSR handling initial data and job SSE moving per-page, the SharedWorker has no remaining job.

**Files to clean up:**
- `static/relay-events.worker.js` — delete
- `src/routes/relay-events.worker.js/+server.ts` — delete (and directory)
- `src/lib/sidebar-polling.svelte.ts` — delete
- `src/lib/guide-jobs.svelte.ts` — revert to direct EventSource (or just remove connect/disconnect; page handles it)
- `src/lib/tracker-suggest-jobs.svelte.ts` — same
- `vite.config.js` — remove `__RELAY_WORKER_VER__` define

---

## Implementation

### Files changed

| File | Change |
|---|---|
| `src/routes/+layout.server.ts` | **New.** SSR load function — calls services directly, hits relay server-to-server |
| `src/routes/+layout.svelte` | Removed all mount fetches and SharedWorker calls. Seeds store from `data`. BroadcastChannel polling for now-playing/pin |
| `src/lib/guide-jobs.svelte.ts` | Removed SharedWorker. Added `applyEvent()` (fed by DownloadsPage) and `fetchAll()` (called by GuidesModal on open) |
| `src/lib/tracker-suggest-jobs.svelte.ts` | Same pattern as guide-jobs |
| `src/lib/svelte/downloads/DownloadsPage.svelte` | Opens two `EventSource` streams on mount (`/relay/api/guides/jobs/stream` + tracker stream), closes on `visibilitychange:hidden`, reopens on focus |
| `src/lib/svelte/journal/guide/GuidesModal.svelte` | Added `jobStore.fetchAll()` in `onMount` — one REST call on open, no SSE needed |
| `vite.config.js` | Removed `__RELAY_WORKER_VER__` define |

### Files deleted

| File | Reason |
|---|---|
| `static/relay-events.worker.js` | SharedWorker eliminated |
| `src/routes/relay-events.worker.js/+server.ts` | Route that served the worker JS |
| `src/lib/sidebar-polling.svelte.ts` | Replaced by BroadcastChannel in `+layout.svelte` |

### What the SSR load function fetches

`+layout.server.ts` calls these in parallel on every initial page load:

- `getAllFlags()` — for collection counts (favorites, in-progress, backlog, etc.)
- `getJournalService().getAll()` — sidebar pages list
- `getFranchiseService().getAll()` — franchise count
- `getAlerts()` — alerts badge count (this hits the relay internally; it's expensive if many games are on alert, but it's a server-side call so it doesn't touch the browser pool)
- `fetch(relay + '/api/account')` — library + wishlist counts
- `fetch(relay + '/api/steam/playtime/last-played')` — history backdrop appid
- `fetch(relay + '/api/games/{appid}')` — last-played game name (sequential, only if playtime has data)
- `fetch(relay + '/api/steam/now-playing')` — seeds `store.nowPlaying` so the Now Playing card renders on first paint
- `fetch(relay + '/api/pin')` — seeds `store.pin`; 204 (no pin) is handled by the safe fetch wrapper

SvelteKit caches the result for the session — client-side navigation does not re-run this function unless a dependency is invalidated.

### Notes on the DownloadsPage streams

Both streams open on mount: one for guide downloads, one for AI tracker suggestions. The relay sends a full snapshot on every `EventSource` connect, so there's no stale-state problem when reopening after a hide. `fetchAll()` in the old `onMount` was removed as a result.

### BroadcastChannel polling detail

The `localStorage` key `sidebar_last_poll` is used as a cross-tab timestamp. Any tab that fires `maybePoll()` first claims the slot by writing the timestamp before the fetch returns, so two tabs racing at the 60s mark each check the key and one backs off. This is best-effort (not a lock) but the worst case is two polls in the same second once per hour, which is acceptable.

---

## End State

| Scenario | Connections held open |
|---|---|
| Browsing game pages (8 tabs) | 0 |
| Now-playing poll (8 tabs) | 0 — fires and closes every 60s, shared via BroadcastChannel |
| On downloads page, tab active | 2 EventSources (guide-jobs + tracker-jobs) |
| On downloads page, tab hidden | 0 — closes on hide, reopens on focus |

Mount burst: eliminated — data arrives with SSR HTML.  
Ongoing polling: 1–2 short-lived requests per minute total.  
Connection pool pressure: effectively zero.

---

## Addendum (2026-07-11): tracker-suggest shared monitor

The AI tracker-suggest download now needs to be **visible and live on the game
page** (where you start it), not just the downloads page — and must survive a
refresh and be watchable from any of N open tabs. Reopening a per-page
EventSource for it would reintroduce the connection pressure this doc fixed, so
the tracker stream moved to a **single leader-elected connection**:

- **One leader tab** holds the only `EventSource('/relay/api/progress-suggest/jobs/stream')`.
  Election is via the **Web Locks API** (`navigator.locks.request('tracker-stream-leader', {mode:'exclusive'})`) — the tab that holds the lock is the leader; if it closes, the lock auto-releases and another tab takes over.
- The leader re-broadcasts every update over `BroadcastChannel('tracker-jobs')`.
  **Every tab** (leader included) updates `trackerSuggestJobStore` from that channel.
  → **12 tabs = 1 relay connection = 1 undici hop.**
- **SSR seed:** `+layout.server.ts` fetches `/api/progress-suggest/jobs` server-side
  and returns `trackerJobs`; `+layout.svelte` seeds the store before connecting, so
  a refresh paints the in-flight job from the HTML with **zero** client fetches.
- The relay broadcasts a lightweight `{type:'log',id,line}` **delta** per log line
  (not the whole growing job) so the single connection stays cheap; late tabs still
  get the full log via the connect snapshot.

**Guides are unchanged** — the guide stream keeps its per-page,
visibility-gated EventSource on DownloadsPage. Only the tracker stream is shared.

Tradeoff vs. the "0 at rest" target above: the leader holds **1** idle tracker
connection while the app is open. With leader election that's 1 connection total
regardless of tab count (5 pool slots still free), so it does **not** reintroduce
the exhaustion problem — the thing this doc actually guards against. A future
refinement could drop the connection when no job is active and reopen on the next
enqueue broadcast.

### Test coverage

`src/tests/e2e/connections.test.js` covers all of the above behaviours end-to-end:

- No SharedWorker errors in console
- `/api/flags`, `/api/franchises`, `/api/pages` not fetched client-side (SSR confirmed)
- `relay-events.worker.js` never requested
- DownloadsPage opens both SSE streams on visit
- DownloadsPage closes streams on visibility hidden, reopens on focus
- Streams not open after leaving DownloadsPage
- Sidebar poll fires at most 2 relay requests per cycle
- GuidesModal triggers `jobStore.fetchAll()` on open
- Second tab skips poll if first tab polled within 60s

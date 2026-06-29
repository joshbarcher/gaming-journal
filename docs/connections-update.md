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

Now-playing and pin must stay client-side — Steam sessions start and stop externally, no user action to hook onto. But each tab polling independently is wasteful.

`BroadcastChannel` lets tabs share the result without a SharedWorker:

```ts
// In +layout.svelte
const channel = new BroadcastChannel('sidebar-poll')

channel.onmessage = ({ data }) => {
    store.nowPlaying = data.nowPlaying
    store.pin = data.pin
}

function maybePoll() {
    const last = Number(localStorage.getItem('sidebar_last_poll') ?? 0)
    if (Date.now() - last < 60_000) return
    localStorage.setItem('sidebar_last_poll', String(Date.now()))
    Promise.all([
        fetch('/relay/api/steam/now-playing'),
        fetch('/relay/api/pin'),
    ]).then(async ([npRes, pinRes]) => {
        const { playing } = await npRes.json()
        const pin = pinRes.status === 204 ? null : await pinRes.json()
        const msg = { nowPlaying: playing ?? null, pin }
        store.nowPlaying = msg.nowPlaying
        store.pin = msg.pin
        channel.postMessage(msg)
        localStorage.setItem('sidebar_last_poll', String(Date.now()))
    })
}

setInterval(maybePoll, 60_000)
maybePoll()
```

Tab 1 opens → polls, broadcasts, writes timestamp. Tabs 2–8 open → timestamp is fresh, skip. 60s later, whichever tab fires first wins. **Result: 1 relay request per minute regardless of tab count.**

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

## End State

| Scenario | Connections held open |
|---|---|
| Browsing game pages (8 tabs) | 0 |
| Now-playing poll (8 tabs) | 0 — fires and closes every 60s, shared via BroadcastChannel |
| On downloads page, tab active | 1 EventSource |
| On downloads page, tab hidden | 0 — closes on hide, reopens on focus |

Mount burst: eliminated — data arrives with SSR HTML.  
Ongoing polling: 1–2 short-lived requests per minute total.  
Connection pool pressure: effectively zero.

# Pinned Community Content

Live Reddit content polling for games you're playing or have pinned.

---

## Overview

When a game is **pinned**, the relay server periodically re-syncs its Reddit data in the background. The community page shows a live indicator and prompts a page refresh when new content has arrived.

**Two ways a game becomes pinned:**

| Trigger | Lifetime |
|---------|----------|
| Steam session starts (auto) | Stays active for the duration of play, plus a configurable grace period after the session ends |
| User manually pins (manual) | Expires after a fixed time window or a max-posts threshold, whichever comes first |

---

## Staleness & Expiry Rules

A pin is considered **expired** when ANY of the following is true:

1. **Session ended + grace period elapsed** (auto-pins only) — session is closed and `Date.now() > sessionEndedAt + PIN_GRACE_MS` (default: 30 minutes)
2. **Time limit reached** — `Date.now() > pinnedAt + PIN_MAX_DURATION_MS` (default: 4 hours)
3. **Post accumulation limit** — total unique posts accumulated across all refreshes for this pin cycle exceeds `PIN_MAX_POSTS` (default: 200)
4. **Manual unpin** — user explicitly removes the pin via UI

Expired pins are cleaned up on the next poller tick. The last-fetched Reddit data is kept in cache as normal; only the active polling stops.

---

## Refresh Cadence

- **Default interval:** every 20 minutes (`PIN_REFRESH_INTERVAL_MS`)
- Configurable via relay env var
- Each refresh calls the existing `syncGame` logic (same path as on-demand sync)
- No refresh fires if a sync is already in progress for that appid (relay returns 409 — skip and wait for next tick)

---

## Thread Deduplication & Merging

On each refresh, the relay merges incoming posts into the existing cached `{appid}.json`:

1. **Existing post, same ID** — update mutable fields only: `score`, `numComments`. All other fields (title, author, media, flair) are left as-is to avoid overwriting cached local media paths.
2. **New post, unseen ID** — run through the normal filter + shape pipeline and append.
3. **Post no longer returned by Reddit** — leave it in the cache (it may just be outside the current fetch window, not deleted). If `score` drops to ≤ 0 on the next update that does return it, the standard filter will catch it.
4. **Sort order** — after merge, posts within each source are re-sorted by `createdUtc` descending.

A `mergedAt` timestamp is written to the cache file alongside `fetchedAt` so the frontend can distinguish "initial sync" from "live update."

---

## Data Model

### Relay — Pin State (`pin.json`)

```json
{
  "appid": 730,
  "name": "Counter-Strike 2",
  "pinnedAt": "2026-06-17T14:00:00.000Z",
  "reason": "playing",
  "sessionEndedAt": null,
  "postsAccumulated": 47,
  "lastRefreshedAt": "2026-06-17T14:20:00.000Z"
}
```

`reason`: `"playing"` | `"manual"`

### Frontend — `PinState` type (`types.ts`)

```typescript
export interface PinState {
    appid:            number
    name:             string
    pinnedAt:         string
    reason:           'playing' | 'manual'
    sessionEndedAt:   string | null
    postsAccumulated: number
    lastRefreshedAt:  string | null
    expiresAt:        string   // computed by relay, sent to client
}
```

---

## Relay Server Changes

### New: `src/services/pin/pin.service.js`

Responsibilities:
- Load/persist pin state to `{DATA_DIR}/relay/pin.json`
- `set(appid, name, reason)` — start a pin, start the refresh interval
- `clearIfPlaying()` — called when session ends; records `sessionEndedAt`, starts grace period countdown
- `clear()` — hard unpin (manual)
- `get()` — returns current pin state or `null`
- `_tick()` — the 20-min interval callback: check expiry rules, call `syncGame` if still active, increment `postsAccumulated`
- `_computeExpiresAt()` — returns the earliest of the two time-based expiry walls so the UI can display a countdown

### New: `src/routers/pin/pin.router.js`

```
GET    /api/pin            → current pin state (or 204 if none)
POST   /api/pin/:appid     → manual pin (body: { name })
DELETE /api/pin            → manual unpin
```

### Modified: `src/services/steam/now-playing.service.js`

- On session open → `pin.set(appid, name, 'playing')`
- On session close → `pin.clearIfPlaying()`

### Modified: `src/server.js`

- Register `pin.router.js`
- Call `pin.service.startPoller()` on startup (restores persisted pin state)

---

## Gaming Journal Frontend Changes

### Modified: `src/lib/types.ts`

- Add `PinState` interface (see above)

### New: `src/lib/js/pin.ts`

Thin API client:
- `getPin(): Promise<PinState | null>`
- `pinGame(appid, name): Promise<PinState>`
- `unpinGame(): Promise<void>`

### Modified: `src/lib/svelte/community/CommunityPage.svelte`

**Pin indicator (top of page):**

- **Active pin** (reason `'playing'` and session still open, or within grace period): pulsing green dot + "Live — updating every 20 min"
- **Inactive / manual pin**: thumbtack icon + "Pinned · expires in Xh Ym" (from `expiresAt`)
- **Not pinned**: thumbtack icon, muted, clickable → pins the game manually

**Refresh prompt:**

- On mount (and every 60 seconds via `setInterval`), poll `GET /relay/api/reddit/:appid` and compare `lastRefreshedAt` (or `mergedAt`) against the value we loaded on initial mount
- If the timestamp has advanced → show a dismissible banner: **"Community content updated — refresh to see new posts"**
- Clicking the banner reloads the page (V1; in-place merge is V2)
- The 60-second client poll is lightweight — it only reads the already-cached JSON, no Reddit calls

### Modified: `src/lib/Sidebar.svelte` (or layout)

- On mount, fetch `GET /relay/api/pin` and poll every 2 minutes
- If a pin is active, show a small indicator next to the game name in the sidebar (pulsing dot for playing, thumbtack for manual)

### Modified: Game page / `GameHero.svelte`

- Show a pin button (thumbtack icon) in the game header actions row
- If `pin.appid === current appid` → show filled pin with current state
- Click: toggle pin on/off

---

## Implementation Phases

### Phase 1 — Relay foundation
1. `pin.service.js` — state, persistence, expiry logic (no Reddit calls yet)
2. `pin.router.js` — 3 endpoints
3. Register router in `server.js`
4. Wire into `now-playing.service.js`

### Phase 2 — Background Reddit refresh
5. Add `_tick()` to `pin.service.js` that calls the existing `syncGame`
6. Implement merge logic in `reddit.service.js` (`mergeAndCache` function)
7. Write `mergedAt` to cache files

### Phase 3 — Community page UI
8. `pin.ts` API client in gaming journal
9. Pin indicator + state display on `CommunityPage.svelte`
10. 60-second polling + refresh banner

### Phase 4 — Global pin indicator + game page button
11. Sidebar pin indicator
12. Pin/unpin button on game page header

---

## Open Questions / Deferred to V2

- **In-place post merge** on community page without full reload
- **Per-subreddit staleness** — right now we refresh all subreddits for a pinned game; could be selective
- **Push via WebSocket/SSE** instead of client polling (relay already has SSE for sync progress — good candidate)
- **Multiple manual pins** — currently one pin at a time; multi-pin would need a pin list
- **Notification** when a pinned game picks up a highly-upvoted post

# Recommendations — "What Should I Play?" Explorer

A gamified, graph-based recommendation page that guides the user through a series of randomly chosen filter questions to narrow down their library and surface games to play.

---

## User Experience

### Entry point
New sidebar nav item in the **Discovery** section: compass icon, label "Recommend", route `/recommend`.

### Depth toggle
A three-way toggle displayed at the top of the page (or on the center node) before the session begins:

| Setting | Questions asked |
|---------|-----------------|
| Shallow | 3 |
| Normal  | 5 |
| Deep    | 7 |

### Flow
1. User picks depth and presses **Start** (or the center node acts as the start trigger).
2. The engine randomly selects N filter types (no repeats) from the registry.
3. For each question:
   - Center node shows the question label.
   - 3–5 option nodes radiate outward via animated elbow paths.
   - User clicks an option → chosen node slides to center, others fade out, next question fans in.
4. After all N questions, the final center node shows "Here's what to play" and game poster nodes radiate outward (up to ~8 results).
5. **Reset** button is always visible — clears state, re-rolls filter sequence, returns to start.

### Visual design
- Full content-area SVG graph canvas.
- **Center node**: larger, glowing ring, displays current question or result headline.
- **Option nodes**: medium circles showing option label; color-coded by filter type.
- **Game result nodes**: rectangular poster thumbnails (Steam header image), link to `/game/{appid}`.
- **Edges**: bent elbow SVG paths. Elbow offset (horizontal vs. vertical knee position) randomized per session so the layout never looks identical.
- Transitions: chosen node scales up and translates to center; siblings scale down and fade; new children grow in with a staggered delay.
- If fewer than 3 games remain after all filters, relax the most-restrictive filter automatically and show a "loosened one filter" notice.

---

## Filter Registry

Each filter is a plain object:

```ts
interface FilterDef {
  id: string          // unique key
  label: string       // question shown in center node, e.g. "What genre?"
  weight: number      // relative likelihood of being picked (1 = normal)
  getOptions: (games: Game[]) => FilterOption[]   // derive choices from current library
  apply: (games: Game[], value: string) => Game[] // narrow the list
}
```

Adding a new filter = adding one entry to the registry array. No other wiring needed.

### Initial filter set

| id | Label | Options (derived from) |
|----|-------|----------------------|
| `genre` | What genre? | Top genres by frequency in library |
| `length` | How long a game? | Short (<5 h HLTB), Medium (5–20 h), Long (20–50 h), Epic (>50 h) |
| `tags` | Pick a vibe | Random sample of 5 popular tags across library |
| `rating` | How well-reviewed? | Mixed (<70%), Good (70–85%), Great (>85%) Steam score |
| `era` | Old or new? | Classic (<2010), Modern (2010–2018), Recent (>2018) |
| `popularity` | Niche or popular? | Niche (<500 reviews), Popular (500–5 k), Blockbuster (>5 k) |
| `status` | Play state | Unplayed, In Progress, Replay (played >0 min) |
| `developer` | Familiar studio? | Studios with 3+ games in library vs. one-off studios |
| `platform_score` | PC friendliness | ProtonDB/PCGW rating buckets (if available) |
| `metacritic` | Critics say? | Below average (<60), Average (60–74), Good (75–89), Acclaimed (≥90) |

Options that yield zero matching games are filtered out before being shown.

---

## API Design

### Endpoint
```
POST /api/recommend
```
Served by the relay server. The SvelteKit frontend proxies through `/relay/recommend → relay /api/recommend`.

### Request body
```jsonc
{
  "depth": "normal",                          // "shallow" | "normal" | "deep"
  "filters": [                                // applied so far (empty on first call)
    { "type": "genre", "value": "RPG" }
  ]
}
```

### Response — next question
```jsonc
{
  "done": false,
  "question": {
    "type": "length",
    "label": "How long a game?",
    "options": [
      { "value": "short",  "label": "Short  (<5 h)",  "count": 12 },
      { "value": "medium", "label": "Medium (5–20 h)", "count": 34 },
      { "value": "long",   "label": "Long   (20–50 h)", "count": 18 }
    ]
  }
}
```

### Response — final results
```jsonc
{
  "done": true,
  "games": [
    { "appid": 292030, "name": "The Witcher 3", "playtimeMinutes": 0 }
  ],
  "relaxed": false   // true if a filter was loosened to meet minimum result count
}
```

### Session state
The filter sequence (which N filter types will be asked, in what order) is determined **server-side on the first call** (when `filters` is empty) and returned alongside the first question:

```jsonc
{
  "done": false,
  "sequence": ["genre", "length", "tags"],   // only on first response
  "question": { ... }
}
```

The client stores `sequence` and sends it back on subsequent calls so the server can deterministically step through it. This avoids server-side session state.

```jsonc
// subsequent requests
{
  "depth": "normal",
  "sequence": ["genre", "length", "tags"],
  "filters": [{ "type": "genre", "value": "RPG" }]
}
```

---

## Implementation Steps

### Step 1 — Relay server: filter registry + `/api/recommend`
- [ ] Create `src/services/recommend/filters.js` — filter registry array
- [ ] Create `src/services/recommend/recommend.service.js` — sequence picker, option builder, game filter engine
- [ ] Create `src/controllers/recommend/recommend.controller.js`
- [ ] Create `src/routers/recommend/recommend.router.js`
- [ ] Register router in `app.js` / main entry
- [ ] Verify: `POST /api/recommend` with empty filters returns first question + sequence

### Step 2 — SvelteKit: proxy route
- [ ] Add relay proxy for `/recommend` (follow existing `/relay/` proxy pattern)
- [ ] Verify: frontend can POST through to relay

### Step 3 — Graph components
- [ ] `src/lib/svelte/recommend/GraphCanvas.svelte` — SVG layer, manages node positions
- [ ] `src/lib/svelte/recommend/GraphNode.svelte` — circle node with label, handles click
- [ ] `src/lib/svelte/recommend/ElbowEdge.svelte` — animated SVG elbow path between two nodes
- [ ] `src/lib/svelte/recommend/GameResultCard.svelte` — poster thumbnail node

### Step 4 — Recommend page
- [ ] `src/routes/recommend/+page.svelte` — state machine, fetches from proxy, drives graph
- [ ] Depth toggle UI (Shallow / Normal / Deep)
- [ ] Reset button
- [ ] Transition animations between question steps

### Step 5 — Sidebar
- [ ] Add `recommend` entry to Discovery section in `Sidebar.svelte`
- [ ] Add `getActiveId` case for `'recommend'`

### Step 6 — CSS & polish
- [ ] Node color scheme by filter type
- [ ] Glowing center node ring animation
- [ ] Elbow edge draw-on animation (SVG stroke-dashoffset)
- [ ] Responsive layout (tablet fallback)

---

## Accuracy Checkpoints

| Step | How to verify |
|------|---------------|
| 1 | `curl -X POST http://localhost:3001/api/recommend -d '{}'` returns question + sequence |
| 2 | Browser network tab shows 200 from `/relay/recommend` passthrough |
| 3 | Storybook / isolated render shows nodes and edges correctly positioned |
| 4 | Full click-through: depth → 3 questions → results with game posters |
| 5 | Sidebar highlights "Recommend" when on `/recommend` |
| 6 | Visual QA: animations feel smooth, elbow offsets vary on reset |

---

## Open Questions / Decisions Made

| Question | Decision |
|----------|----------|
| Random sequence each reset? | Yes — fully random every time |
| Depth options | Shallow=3, Normal=5, Deep=7 |
| Minimum results before relaxing filter | 3 games |
| Max game results shown | 8 |
| Server-side session? | No — sequence token passed by client |
| Tags source | Steam store tags (SteamSpy-sourced), already in relay `games.service.js` |

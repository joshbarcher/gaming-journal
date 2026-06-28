# Recommendations

Interactive quiz at `/recommend` that narrows your unplayed library games through a series of filter questions, displayed as an animated node graph on desktop.

## Flow

Three phases:
1. **Start** — depth selector + "Start exploring" button
2. **Playing** — one question at a time; each answer adds a filter and fetches the next question
3. **Results** — up to 8 game suggestions laid out as nodes

## Depth settings

| Depth | Questions |
|-------|-----------|
| Shallow | 3 |
| Normal | 5 |
| Deep | 7 |

Depth is only selectable on the start screen. Once playing it shows as a read-only badge.

## API

All interaction goes through a single endpoint:

```
POST /relay/api/recommend
{
  depth:    'shallow' | 'normal' | 'deep',
  sequence: string[] | undefined,   // null on first call, then fixed for the session
  filters:  { type: string; value: string | null }[]
}
```

Response:
- If more questions remain: `{ question: RecommendQuestion, sequence: string[] }`
- When done: `{ done: true, games: RecommendGame[], relaxed?: boolean }`

`sequence` is server-generated on the first call and returned as an array of question type strings. It stays fixed for the entire session — sends it back on every subsequent call. This ensures the question order doesn't shift after each answer.

`relaxed: true` means one filter was loosened because the strict combination produced too few results. A banner appears in the UI.

## Question/filter types

8 types, each with a distinct edge color in the graph:

| Type | Color |
|------|-------|
| `genre` | gold `#c9a84c` |
| `length` | teal `#4ecdc4` |
| `tags` | orange `#e07b54` |
| `era` | tan `#a8956a` |
| `popularity` | blue `#7db5d8` |
| `status` | purple `#c17aad` |
| `metacritic` | dark orange `#d4904a` |

(8th type if added will get a fallback off-white edge color.)

Each question has `{ type, label, options[] }` where each option has `{ value, label, count }` — `count` is how many games in your library match that option.

## Skipping

The Skip button adds `{ type: question.type, value: null }` to the filter list, which tells the relay to ignore that filter dimension. This still advances the step counter and sequence position.

## Graph UI (desktop ≥ 480px)

SVG canvas at `1000 × 640` viewBox. A center "hub" node connects via elbow edges to option nodes arranged radially:
- **≤ 3 options**: symmetric arc centered at top (−π/2), ~120° spread per step
- **> 3 options**: full circle starting at top

Game result nodes use radius 260 (vs 230 for option nodes), capped at 8 games visible.

Node phases: `entering` → `idle` → `chosen` (selected) / `dismissed` (others after a choice). A 350ms outgoing transition animates dismissed nodes before new content loads.

Elbow edges have a randomized midpoint T (0.3–0.7) for organic variety. Edge color matches the current question type.

## Mobile layout (≤ 479px)

Instead of the SVG graph, a stacked vertical list:
- Question type label + question text as a card
- Options as pill buttons with staggered entrance animation
- Game results as image + name rows

Same API, same state machine — just a different presentation layer.

## Progress pips

A row of `sequence.length` horizontal pip bars appears below the topbar during the playing phase. Pips fill gold as steps complete.

## Key files

| File | Role |
|------|------|
| `src/routes/recommend/+page.svelte` | Page shell — state machine, API calls, layout |
| `src/lib/svelte/recommend/RecommendGraph.svelte` | SVG graph component (questions + results) |
| `src/lib/svelte/recommend/GraphNode.svelte` | Individual option node (SVG foreignObject) |
| `src/lib/svelte/recommend/GameResultNode.svelte` | Game result node with header image |
| `src/lib/svelte/recommend/ElbowEdge.svelte` | Animated elbow-routed edge line |
| `relay-server/src/controllers/recommend/recommend.controller.js` | `POST /api/recommend` handler |

## Common questions

**Q: Results seem random / not relevant to my choices.**
The relay filters your actual library (unplayed or lightly played games) using the accumulated filters. If your library is small or the filters are strict, `relaxed: true` may loosen one filter. The question type order is fixed per session (`sequence`) but the options shown depend on what's in your library.

**Q: I want to restart. Where's the button?**
The Reset button (↺) appears in the top bar once you start. It returns to the start screen and clears all filters and the session sequence.

**Q: The graph looks empty / nothing shows.**
The SVG renders at 1000×640 and scales to fit. On very small screens (< 480px) it switches to the mobile stacked layout automatically. If the desktop graph shows empty nodes, the question may have 0 options (no matching games) — the relay should handle this gracefully.

## Gotchas

- **`sequence` is fixed after the first call** — don't discard it between calls. It's stored in component state and re-sent on each filter submission. Losing it means the relay would generate a new random order.
- **Up to 8 game results shown** — even if the relay returns more, `displayGames.slice(0, 8)` caps the graph nodes. The mobile layout also only shows what the relay returns (no slice).
- **Edge colors are purely cosmetic** — they help visually distinguish question types but carry no functional meaning.

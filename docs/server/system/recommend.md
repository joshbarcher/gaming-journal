# Recommendations

Graph-based "what should I play next?" flow. Asks a sequence of filter questions and narrows the owned library to a handful of suggestions. Stateless — nothing is stored; the client resends the full answer history each call. Folded into the gaming-journal SvelteKit app; UI at `/recommend`.

## Data flow

1. Client POSTs `POST /relay/api/recommend` with `{ depth, sequence?, filters }`.
2. `ensureBuilt()` makes sure the in-memory games cache exists (built lazily on first request), then `getRecommendation()` runs.
3. `depth` → question count via `DEPTH_STEPS`: `shallow=3`, `normal=5`, `deep=7`.
4. First call (no `sequence`): `pickSequence(n)` builds a weighted-random, deduped sequence of filter ids and returns it; the client echoes `sequence` on every later call.
5. `applyFilters(ownedGames(), filters)` applies each answered `{ type, value }` in order:
   - `value === null` = skipped question — position advances, set not narrowed.
   - If the LAST filter would drop results below `MIN_RESULTS = 3`, it's relaxed (dropped) and `relaxed: true` is returned.
6. The next question is the first sequence entry (past the answered ones) whose `getOptions(filtered)` yields ≥ 2 non-empty options.
7. Response is either:
   - `{ done: false, sequence, question: { type, label, options } }` — more to ask.
   - `{ done: true, sequence, games, relaxed }` — final list, capped at `MAX_RESULTS = 8`, shuffled. Also returned early when the filtered set is `≤ EARLY_SHOW (5)` or no usable question remains.
8. Each returned game is `{ appid, name, playtimeMinutes, header }`.

### Filters (7, in `recommend/filters.js`)
`genre`, `length` (short/medium/long/epic by HLTB `gameplayMain` hours), `tags` (random 5 of top-20), `era` (classic/modern/recent), `popularity` (by store review count), `status` (unplayed/tried/played), `metacritic` (weight `0.7`; others `1`). Each has `id`, `label`, `weight`, `getOptions(games)`, `apply(games, value)`.

### Weighting
`pickSequence` expands each filter into `round(weight*10)` pool slots, shuffles, then dedupes into the first `n` ids — higher-weight filters appear more often. Padded with any leftover filters if the pool is short.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/recommend/recommend.service.js` | `getRecommendation`, `pickSequence`, `applyFilters`, `ownedGames`, `DEPTH_STEPS`, `MIN_RESULTS`, `EARLY_SHOW`, `MAX_RESULTS` |
| `src/lib/server/relay/recommend/filters.js` | `FILTERS` — the 7 filter definitions |
| `src/lib/server/relay/games/games.service.js` | `getAll()` candidate pool; `ensureBuilt()` lazy boot |
| `src/routes/relay/api/recommend/+server.ts` | `POST /relay/api/recommend` — body validation, `relayRoute('recommend', …)` |
| `src/routes/recommend/+page.svelte` | Graph UI: depth toggle (shallow/normal/deep), question nodes, results |

Public URL `POST /relay/api/recommend` (:8061).

## Storage layout

None. Fully stateless — no session id, no files. The only state is the in-memory games cache (`games.service.js`), shared with the rest of the app.

## Common questions

**Q: Why is the pool only owned library games?**
`ownedGames()` filters `getAll()` to `source === 'library' || 'both'`. Wishlist/discovery titles can't be played, so recommending them is pointless.

**Q: Is there a session id?**
No. The client holds the full `sequence` + `filters` history and resends both each call; the server re-derives everything from scratch. The one input that must be echoed is `sequence` (so the same questions recur across a session).

**Q: What is `MAX_RESULTS = 8`?**
The final list is shuffled and sliced to 8; more than 8 matches yields a random 8.

## Gotchas

- `pickSequence` and the final `games` slice both use `Math.random()` — order and picks vary per session; that variety is intentional.
- `EARLY_SHOW` is a game-count exit (`filtered.length ≤ 5`), independent of how many questions were answered — a strong early filter ends the flow early.
- A filter is silently skipped mid-sequence if it can't offer ≥ 2 populated options for the current set, so the number of questions actually asked can be less than `depth`.
- The exported entry point is `getRecommendation({ depth, sequence, filters })` — there is no `startSession`; `applyFilters`/`pickSequence`/`ownedGames` are internal.
```

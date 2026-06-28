# Abandoned

Games flagged as `dropped` at `/abandoned`. For games you started but stopped playing permanently.

Note: the flag is called `dropped` in the codebase (`flag.dropped`, `SidebarCounts.dropped`) even though the page and nav item are labeled "Abandoned." Use `f.dropped` when filtering by this flag in code — `f.abandoned` does not exist.

## Layout

A simple card grid — no queue, no hero, no ordering. Each card shows the game header and name. Subtitle shows count and total time invested.

## Data source

- `GET /api/flags` filtered for `flag.dropped === true`
- `GET /relay/api/steam/games` for game metadata

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/abandoned/Abandoned.svelte` | Abandoned component |
| `src/routes/abandoned/+page.svelte` | Route shell |

## Gotchas

- **`dropped` vs `abandoned`**: the flag field is `dropped`, not `abandoned`. This naming mismatch exists throughout the codebase — SidebarCounts uses `dropped`, the route is `/abandoned`, the nav label is "Abandoned." Always use `flag.dropped` in code.

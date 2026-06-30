# Progress Tracker Pages

The four tracker types (`progress`, `progress-bars`, `counter`, `multi-counter`) are individual pages loaded at `/{pageId}`. Each renders a different editing UI; all persist to the same `Page` record schema via `PUT /api/pages/{pageId}`.

See [progress.md](progress.md) for the list view (`/journal/{appid}/progress`) and HLTB integration. See [auto-trackers.md](auto-trackers.md) for AI-generated tracker creation.

## Data flow

1. User navigates to `/{pageId}` → route loads `Page` record → passes it as `page` prop to the matching component
2. All edits call `api.pages.update(id, patch)` — the patch contains only the changed fields
3. After each successful save, `refreshSidebarItem(updated)` syncs the sidebar title/badge
4. Save timing: state/title/reorder changes are immediate; counter adjustments debounce 400ms; notes debounce 800ms

## Tracker types

### `progress` — `Progress.svelte`

Segmented task list. Each task has one of four states: `started`, `working`, `done`, or `null` (not started).

```
{ tasks: [{ id, title, state: 'started'|'working'|'done'|null, optional?: bool }], notes: string }
```

- Three state buttons per task (STARTED / WORKING / DONE); clicking the active state clears it back to null
- Drag handle ⠿ to reorder tasks
- Right-click context menu: "Mark Optional" / "Delete"
- Optional tasks get an "OPTIONAL" badge and render with reduced opacity
- Particles fire (`fireParticles`) when all **required** (non-optional) tasks are marked done

### `progress-bars` — `ProgressBars.svelte`

Rows of named bars, each containing step chips. Steps cycle state on click: `null → started → working → done → null`.

```
{ bars: [{ id, title, optional?: bool, steps: [{ id, title, state, optional?: bool }] }], notes: string }
```

- Click a chip body to cycle its state; click the chip label to edit its text inline
- Drag ⠿ to reorder bars; drag chips to reorder steps within a bar
- Right-click bar: "Mark Optional" / "Duplicate" / "Delete"
- Right-click chip: "Mark Optional" / "Delete"
- `barProgressPercent` counts only non-optional steps; optional steps are visually dimmed
- Particles fire per-bar when all required steps in that bar reach `done`

### `counter` — `Counter.svelte`

Single numeric counter with a target.

```
{ current: number, target: number, description?: string }
```

- +/− buttons adjust `current` by 1; click-drag on the bar scrubs to any value
- The target is editable in-place (click the target number on the bar overlay)
- Description is editable inline below the title
- Delete button in the sub-header navigates back to the journal on confirm

### `multi-counter` — `MultiCounter.svelte`

Multiple named counters in one page. Global aggregate bar shows `sum(current) / sum(target)`.

```
{ counters: [{ id, name, current, target }] }
```

- Each row: name editable, target editable, +/− or click-drag on the row bar
- Right-click a row to delete it (uses `confirmDialog`)
- Delete button in the sub-header removes the whole page
- No notes field

## Color system

All tracker colors come from `progress-helpers.ts`:

| State / pct | Color |
|-------------|-------|
| `done` | teal `#4ecdc4` |
| `working` | gold `#c9a84c` |
| `started` | blue `#7ab8f5` |
| null / 0% | dim `rgba(255,255,255,0.10)` |
| pct ≥ 100 | teal (done) |
| pct ≥ 50 | gold (working) |
| pct > 0 | blue (started) |

`segmentColor(state)` maps named states. `percentToColor(pct)` maps completion percentages.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/progress-tracker/Progress.svelte` | `progress` — task list, state buttons, drag-reorder |
| `src/lib/svelte/progress/ProgressBars.svelte` | `progress-bars` — bars with step chips, two independent drag systems |
| `src/lib/svelte/counter/Counter.svelte` | `counter` — scrubbing bar, inline target edit |
| `src/lib/svelte/multi-counter/MultiCounter.svelte` | `multi-counter` — per-row counters, aggregate bar |
| `src/lib/js/views/progress-helpers.ts` | `segmentColor`, `globalSegments`, `pagePct`, `percentToColor`, `barProgressPercent` |
| `src/lib/js/views/journal-render.ts` | `TRACKER_TYPES` array, `TRACKER_META` display labels |

## Common questions

**Q: Why does the dashboard percentage sometimes differ from what the tracker shows?**
`pagePct` (used for dashboard summaries) for the `progress` type counts ALL tasks including optional ones. `barProgressPercent` in `progress-bars` excludes optional steps. A tracker with many optional tasks will show a lower dashboard pct than the user expects.

**Q: Can I drag a chip from one bar to another?**
No. `ProgressBars` chip drag validates that the source and target chips share the same parent element. Drops across bars are silently rejected.

**Q: Do `counter` and `multi-counter` pages have notes?**
`counter` has a `description` field (one inline line of text, no textarea). `multi-counter` has no notes at all. Only `progress` and `progress-bars` have a full notes textarea.

## Gotchas

- **Two independent drag systems in ProgressBars.** Bar drag and chip drag use separate module-level refs (`_dragBarSrc`, `_dragChipSrc`). The bar's `ondragover` returns early if `_dragChipSrc` is set, preventing bar reorder while a chip is in flight.
- **Progress and ProgressBars have no in-page Delete button.** Deletion must be done from the `JournalProgress` list (`/journal/{appid}/progress`). Counter and MultiCounter have their own Delete button in the sub-header.
- **Particles are per-bar in ProgressBars**, not global. Completing all required steps in one bar fires particles for that bar; completing the last bar does not fire again globally.
- **Counter save is debounced 400ms.** Rapid +/− clicks batch into one write; navigating away before the timer fires will drop unsaved increments.
- **Breadcrumb fetches game name on mount** from `GET /relay/api/games/{appid}`. It shows "…" until that resolves. If `appid` is missing, the breadcrumb is omitted entirely.

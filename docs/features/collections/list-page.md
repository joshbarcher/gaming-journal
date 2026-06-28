# List Page (Custom Journal Lists)

A generic checklist/to-do list for journal use. Accessed at `/{pageId}` when `page.type === 'list'`. Created from within a game's journal (e.g., "Things to do before NG+").

This is not a game collection page — it has no flag-based filtering. It's for arbitrary freeform lists tied to a journal entry.

## Data model

```ts
{
  type:    'list',
  items:   Array<{
    id:       string    // uuid
    title:    string    // shown as contenteditable text
    order:    number    // float for drag-reorder midpoint insertion
    done:     boolean   // checkbox state
    subtasks: string[]  // chip list under each item
  }>,
  ordered: boolean,     // true = numbered (1. 2. 3.), false = bullet
}
```

Saved via `PUT /api/pages/{pageId}` (full item array + `ordered` flag on every mutation).

## Features

| Feature | How it works |
|---------|-------------|
| Add item | Appends new item with empty title, auto-focuses it |
| Inline title editing | `contenteditable` span; saves on `blur` |
| Done toggle | Checkbox; toggles `item.done`; saves immediately |
| Ordered/unordered toggle | Switches between numbered and bullet display; saved to `ordered` |
| Subtasks | Chips below each item; added via inline input (Enter or blur commits) |
| Remove subtask | × button on each chip |
| Drag items | Row-level drag to reorder items |
| Drag subtask chips | Chip-level drag within an item to reorder subtasks |

## Drag-and-drop architecture

Two independent drag systems coexist:

1. **Item drag**: event delegation on the list container — `onListDragstart`/`onListDragend` find the nearest `.list-item[data-id]` parent. Saves `order` field using midpoint floats.

2. **Chip drag**: `use:chipDrag` Svelte action on each chip. `e.stopPropagation()` prevents the item-drag from firing when dragging a chip. After drop, `persistChipOrder()` reads DOM order of `.subtask-chip` elements to reconstruct the array.

Both save immediately on drop completion.

## Route

`/{pageId}` → `src/routes/[pageId]/+page.svelte` fetches `GET /api/pages/{pageId}`, reads `pageData.type`, and dynamically imports the matching component:

```ts
const PAGE_COMPONENTS = {
  list:            () => import('$lib/svelte/list/ListPage.svelte'),
  progress:        () => import('$lib/svelte/progress-tracker/Progress.svelte'),
  'progress-bars': () => import('$lib/svelte/progress/ProgressBars.svelte'),
  notes:           () => import('$lib/svelte/notes/Notes.svelte'),
  page:            () => import('$lib/svelte/page-editor/PageEditor.svelte'),
  counter:         () => import('$lib/svelte/counter/Counter.svelte'),
  'multi-counter': () => import('$lib/svelte/multi-counter/MultiCounter.svelte'),
}
```

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/list/ListPage.svelte` | List editor component |
| `src/routes/[pageId]/+page.svelte` | Dynamic page type router |
| `src/routes/api/pages/[pageId]/+server.ts` | CRUD for page records |

## Common questions

**Q: Can I nest subtask lists inside subtasks?**
No — subtasks are flat strings under each item. Only one level of nesting. For deeper structure, create separate ListPage records.

**Q: The order gets weird after many drags.**
`order` uses midpoint floats (`(a.order + b.order) / 2`). After many reorders, precision can theoretically degrade (floating-point midpoints converge). In practice this rarely causes issues, but if it does, saving the list re-assigns clean integer orders.

## Gotchas

- **Full array saved on every mutation** — there's no partial update. Every checkbox toggle, title edit, subtask add, or reorder sends the complete `items` array. This is simple but means no diffing/conflict resolution.
- **`order` is a float, not an integer index** — never rely on `item.order` as a 0-based position. Always sort by `order` before rendering; treat the value as opaque.

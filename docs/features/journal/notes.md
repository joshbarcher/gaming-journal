# Journal Notes & Pages

Two types of user-created content per game: **sticky notes** (a draggable corkboard wall) and **rich pages** (block-based editor). Both live under the journal for a specific game.

## Sticky Notes

A freeform corkboard at `/journal/{appid}` → Notes sub-page. Powered by a vendor `StickyWall` library.

### Data flow
1. `onMount` → parallel: import `StickyWall` from vendor + `GET /api/journal-notes/{appid}`
2. `StickyWall` initialized on the mount element with `{ notes, editable: true, draggable: true, tape: true, addForm: 'modal' }`
3. On any `sw:add`, `sw:update`, `sw:remove`, `sw:reorder` event → `wall.serialize()` → `PUT /api/journal-notes/{appid}`
4. Notes persist to the relay server (JSON on disk), not localStorage

### Key detail
`JournalNotes.svelte` hides StickyWall's built-in add button (`.sw-add { display: none }`) and replaces it with a custom "+ Add Note" button in the sub-header that programmatically clicks `.sw-add__toggle`.

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalNotes.svelte` | StickyWall mount, save, add-button wiring |
| `src/lib/js/vendor/stickywall.js` | Vendor library (draggable sticky notes) |
| `relay-server/src/controllers/…` | `GET/PUT /api/journal-notes/{appid}` |

## Rich Pages & Notes Pages

Block-based rich text pages at `/journal/{appid}` → Pages sub-page. Routed to `/{pageId}` for editing.

### Page types

| Type | Description |
|------|-------------|
| `page` | Full rich-text block editor (PageEditor) |
| `notes` | Lighter notes format |
| `progress` | Progress tracker (see [progress.md](progress.md)) |
| `progress-bars` | Multi-bar tracker |
| `counter` | Single counter |
| `multi-counter` | Multiple named counters |

`JournalPages` filters for `type === 'page'` or `type === 'notes'`. `JournalProgress` filters for `TRACKER_TYPES`.

### Data flow
1. `JournalPages` → `GET /api/pages?appid={appid}` → shows list of page/notes type entries
2. "+ New Page" → `POST /api/pages` with `{ type: 'page', title: 'New Page', appid }` → relay creates record → `navigate(page.id)` → opens editor at `/{pageId}`
3. PageEditor saves content block-by-block to the relay

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalPages.svelte` | Page list, create, delete |
| `src/lib/svelte/page-editor/PageEditor.svelte` | Block-based rich text editor |
| `src/lib/svelte/notes/Notes.svelte` | Notes-type page view |

## Common questions

**Q: Are sticky notes stored in localStorage?**
No — they're server-side. `api.journalNotes.set(appid, notes)` posts to the relay. This means notes survive browser clears and are accessible from any browser hitting the same relay.

**Q: What's the difference between a "Notes page" and a sticky note?**
Sticky notes are the corkboard (unstructured, draggable, visual). A "Notes page" (`type: 'notes'`) is a structured page in the Pages section — it uses the block editor, not StickyWall.

**Q: How is `noteCount` displayed in the Notes header button?**
It's set from `wall.serialize().length` after each add/remove event. Initialized from the loaded notes array length at mount.

## Gotchas

- **StickyWall is a vendor library** (`src/lib/js/vendor/stickywall.js`) — it's not an npm package. Treat it as opaque; don't modify unless you know what you're changing.
- **`wall.destroy()` is called in `onDestroy`** — important for cleanup, as StickyWall attaches DOM listeners.
- **Deleting a page requires `confirmDialog`** (not `confirm()`) — the app uses a custom dialog system throughout. See the no-native-dialogs memory entry.

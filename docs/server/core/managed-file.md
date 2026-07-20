# ManagedFile

Manages a single JSON file through its full lifecycle: atomic load, in-memory cache, background flush, checkpoint recovery, audit/quarantine, and graceful shutdown. Every persistent data store in `src/lib/server/relay/` is backed by a ManagedFile instance.

## Data flow

### Read path
1. `load()` reads the file once and populates `_value` in memory.
2. Subsequent `get()` calls are synchronous — no disk I/O.
3. Concurrent `load()` calls share the same in-flight promise; only one disk read occurs.

### Write path
1. `set(newValue)` runs the audit fn (if configured), updates `_value`, calls `_markDirty()`.
2. `_markDirty()` schedules a flush respecting `maxFlushIntervalMs` (default 60s).
3. `flush()` runs `_doFlush()` immediately — callers needing data on disk promptly call this after `set()`.
4. `_doFlush()` serializes to JSON, writes `.tmp`, fsyncs, renames atomically over the target.
5. After a successful flush, `{filePath}.checkpoint.json` is written fire-and-forget.

### Shutdown path
`close()` cancels the flush timer, drains pending dirty state, awaits any in-flight checkpoint/backup, then returns. In practice singletons are not `close()`d per-request — only `flush()` after writes.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/shared/managed-file.js` | Full implementation — load, set, flush, audit, checkpoint, backup, close |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay/`), via `featureDir('<cat>')`:
```
steam/
  games.json                  ← main data file
  games.json.checkpoint.json  ← written after every successful flush
  games.json.tmp              ← transient; only during the atomic write
  games.quarantine-{ts}.json  ← audit-violation dump; up to 10 kept
```

## Singleton pattern (cache the load PROMISE, not the file)

Services hold a module-level promise and a lazy loader:
```js
let _filePromise = null
function _loadXxxFile() {
    if (!_filePromise) {
        const file = makeFile(...)
        _filePromise = file.load().then(() => file)   // cache the promise
    }
    return _filePromise
}
```
Caching the *promise* (not the file object) is load-bearing: an earlier pattern assigned `_file` synchronously before awaiting `load()`, so a second concurrent caller saw `_file` truthy, skipped loading, and called `get()` on an unloaded file (`not loaded`). That race silently corrupted the wishlist merge at boot. Every concurrent caller now awaits the same in-flight load.

## Common questions

**Q: Why must `set()` receive a new object instead of mutating `get()`?**
The audit compares the prior snapshot against the new value. Mutating the object from `get()` means `_value` is already changed before `set()` — the audit sees no change. Always spread: `file.set({ ...file.get(), [key]: value })`.

**Q: What happens if the main file is corrupt on load?**
`_doLoad()` catches the parse error and falls back to `{filePath}.checkpoint.json`; if that also fails, the `defaultValue` factory is used. The source (`main`/`checkpoint`/`default`) is logged and in `getStats().loadSource`.

**Q: What is the audit / count-guard for?**
An optional `audit(prev, next)` can reject a write. The data-integrity pass added count-guards on stores like `games` and `wishlist`: a write that collapses a non-empty count to 0 is refused (`count collapsed N → 0 — refusing to wipe good data`) and quarantined, so a transient empty upstream can't clobber good cached data.

## Gotchas

- `get()` throws `not loaded` if called before `load()` completes — all lazy loaders `await` the load promise before returning.
- Concurrent `set()` calls are serialized by the write chain (`_writeChain`) so `_doFlush()` calls never overlap on disk.
- The audit runs at `set()` time AND again at `_doFlush()` as a safety net for any path that bypassed `set()`.
- `maxFlushIntervalMs` is a max-interval guarantee, not a debounce — rapid writes coalesce but flush within the interval.
- Quarantine files accumulate on audit violations; up to `quarantineKeep` (10) are kept, older pruned.

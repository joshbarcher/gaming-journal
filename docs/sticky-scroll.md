# Sticky Scroll — Per-Page Scroll Position Persistence

Scroll positions are saved to `localStorage` and restored when the user returns to a page.
All logic lives in `public/js/router.js`.

---

## How It Works

### Saving
Two mechanisms write to `localStorage`:

1. **Debounced scroll listener** — attached to `#main-content` on first navigation.
   Fires 150ms after the user stops scrolling. Covers normal in-session usage.

2. **Navigate-away save** — called at the start of `navigate()` for every navigation
   *after* the initial page load (guarded by `_initialized`). Catches the case where
   the user clicks a link before the debounced save has fired.

### Restoring
After a view's render promise resolves, `_restoreScroll(path)` is called. It defers
the actual `scrollTop` assignment into a `requestAnimationFrame` so the browser has
finished layout before we set the position.

### Storage Keys
`scroll:/on-hold`, `scroll:/library`, etc. — keyed by the URL pathname.

---

## The Race Conditions (Already Fixed)

### 1. Restore before layout (rAF fix)
**Symptom:** `scrollTop` is set immediately after `await render()` but snaps back to 0.

**Cause:** The render promise resolves when the JS finishes, but the browser hasn't
recalculated layout yet. `scrollTop` silently clamps to 0 if `scrollHeight` is too
small at the moment of assignment.

**Fix:** Wrap the `scrollTop` assignment in `requestAnimationFrame`.

```js
requestAnimationFrame(() => {
    const el = mainEl()
    if (el) el.scrollTop = Number(saved)
})
```

---

### 2. Initial page load overwrites stored position (the tricky one)
**Symptom:** Scroll restore works in-session but not after a hard refresh.

**Cause:** On a fresh page load, the browser URL is already `/on-hold` (or whatever).
`navigate('on-hold')` is called to bootstrap the app. At that moment `scrollTop` is 0.
The save-on-navigate fires first and **overwrites the stored value with 0**, before
the page even renders. The debounced listener fires 150ms later — too late.

**Trace that reveals it:**
```
[scroll] save on-hold → 0          ← overwrites the stored 575 with 0
[scroll] restore requested on-hold → saved: 0
[scroll] rAF firing, scrollHeight: 1922, setting scrollTop to 0
[scroll] scrollTop after set: 0
[scroll] save on-hold → 575        ← debounced save fires, but restore already ran
```

**Fix:** Skip the navigate-away save on the very first `navigate()` call by checking
the `_initialized` flag, which is `false` only during that initial bootstrap call.

```js
// Only save when leaving a page we've actually been on — not on initial load
if (_initialized) _saveScroll(getRoutePath())
```

---

## Debugging

Add these trace statements to `router.js` to see the full picture:

```js
function _saveScroll(path) {
    const el = mainEl()
    const top = el?.scrollTop ?? 0
    console.log('[scroll] save', path, '→', top)
    if (el) localStorage.setItem(_scrollKey(path), top)
}

function _restoreScroll(path) {
    const saved = localStorage.getItem(_scrollKey(path))
    console.log('[scroll] restore requested', path, '→ saved:', saved)
    if (saved === null) return
    requestAnimationFrame(() => {
        const el = mainEl()
        console.log('[scroll] rAF firing, el.scrollHeight:', el?.scrollHeight, 'setting scrollTop to', Number(saved))
        if (el) el.scrollTop = Number(saved)
        console.log('[scroll] scrollTop after set:', el?.scrollTop)
    })
}
```

Key things to check in the output:
- **`save` fires with 0 on a path you're restoring to** → initial-load overwrite bug (check `_initialized` guard)
- **`rAF firing, scrollHeight` is tiny (e.g. 300)** → content not rendered yet, need double-rAF or a longer defer
- **`scrollTop after set` is 0 despite saved value being non-zero** → layout not ready, same as above

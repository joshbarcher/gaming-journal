# Feature Documentation Guidance

Feature docs exist for one reason: **give an AI assistant enough context to answer questions and make changes without re-deriving everything from scratch in each conversation.**

They are not tutorials. They are not changelogs. They are dense reference sheets for a developer (human or AI) who already understands the codebase but needs a quick orientation on one specific area.

---

## Target reader

An AI assistant starting cold — no memory of previous conversations, no prior read of the relevant files. Point them at this doc at the start of the conversation and they should be able to answer operational questions and make targeted changes without broad codebase exploration.

---

## What to include

### 1. Overview (2–4 sentences)
What does this feature do, from the user's perspective? What problem does it solve?

### 2. Data flow
The most important section. Trace the path from user action → relay → disk → UI for the happy path. Use a numbered list or ASCII diagram. Be specific about file names, function names, and API endpoints — not just "the server processes it."

**Example:**
```
1. User clicks Download → POST /api/guides/:steamId/download
2. Controller spawns fetch-guide.js → Puppeteer BFS → writes _raw/*.html + _manifest.json
3. Controller spawns parse-guide.js → reads _raw/ → writes content.json per page + _meta.json
4. UI polls job store SSE → shows progress → on done, nav to guide viewer
```

### 3. Key files
Only the load-bearing files — the ones you'd actually open to debug or change this feature. Not an exhaustive list. Include the relay-server path for backend files.

| File | Role |
|------|------|
| `relay-server/src/services/guides/ign/fetcher.js` | BFS page discovery + Puppeteer fetch |
| `src/lib/svelte/journal/guide/GuidesModal.svelte` | Download UI, refresh button |

### 4. Storage layout
If the feature reads/writes files on disk, show the directory structure with a brief note on each file. Disk state is often the thing that's surprising.

### 5. Common questions & answers
Questions that have actually come up in past conversations. Write them as real questions, answer them directly. This is the highest-value section for reducing repeated debugging.

**Format:**
```
**Q: Does clicking Refresh re-fetch pages already on disk?**
No. fetch-guide.js defaults to force=false — existing .html files are read from cache.
Only pages missing from disk are fetched from the network.
```

### 6. Gotchas / non-obvious behavior
Things that would surprise a reader of the code. Constraints, edge cases, historical decisions that aren't obvious from the implementation.

---

## What to omit

- **Things obvious from the code.** If the answer is "read the function name," don't document it.
- **Full API reference.** Document the key endpoints; not every param.
- **Step-by-step setup.** That belongs in README. These docs assume the app is running.
- **Who wrote what or when.** That's git blame's job.
- **Aspirational or planned behavior.** Only document what the code actually does today.

---

## Format rules

- **Short sentences.** Each sentence should carry one fact.
- **Specific over general.** "writes `_manifest.json` to `_raw/`" beats "saves metadata."
- **Use code formatting** for file paths, function names, CLI flags, and API routes.
- **Keep it under ~150 lines.** If a feature needs more, split it into two docs.
- **Update when behavior changes.** A stale doc is worse than no doc — it causes confident wrong answers.

---

## File naming & location

```
docs/features/
  guidance.md              ← this file
  {area}/
    {feature}.md           ← one doc per distinct user-facing feature or pipeline
```

Area = the part of the app the feature lives in: `guides/`, `journal/`, `game/`, `library/`, `discovery/`, `community/`.

When one feature is large enough to need multiple docs (like guides), split by the natural seams — usually fetch vs. view vs. search.

---

## Maintenance

- Update the doc in the same PR/commit as the code change.
- If you're unsure whether a doc is still accurate, add a `> ⚠️ Verify: ...` callout rather than leaving a silently stale section.
- If a Q&A entry gets resolved permanently by a code change, remove the Q and note the fix in the data flow section instead.

---

## Template

Copy this to start a new feature doc:

```markdown
# [Feature Name]

One sentence: what does this do for the user?

## Data flow

1. ...
2. ...

## Key files

| File | Role |
|------|------|
| | |

## Storage layout (if applicable)

\```
path/
  file    ← what it contains
\```

## Common questions

**Q: ?**
Answer.

## Gotchas

- ...
```

// Ported verbatim from relay-server src/services/progress-suggest/progress-suggest.service.js (docs/relay-fold-in.md §6 — byte-identical logic).
import { randomUUID } from 'crypto';

export function buildPrompt(gameName) {
    return `You are helping a gamer set up progress trackers to 100% complete "${gameName}".

Search the web for completion information about this game. Look for:
- 100% completion guide or checklist
- All achievements/trophies list
- Collectibles and their exact counts
- Chapter, act, or mission list
- Side quests or optional content list

Based on what you find, design a set of progress tracker definitions that cover everything a completionist would want to track.

Return ONLY a valid JSON array — no markdown fences, no explanation, just the raw JSON starting with [ and ending with ].

Tracker types:

1. "progress" — named sequential tasks (chapters, missions, quests). Max 20 tasks.
{"type":"progress","title":"string","tasks":[{"title":"string"}]}

2. "progress-bars" — grouped tasks with sub-steps. Max 10 bars, max 20 steps each.
{"type":"progress-bars","title":"string","bars":[{"title":"string","steps":[{"title":"string"}]}]}

3. "counter" — large numbered collection with a known total.
{"type":"counter","title":"string","target":100}

4. "multi-counter" — multiple related named counts.
{"type":"multi-counter","title":"string","counters":[{"name":"string","target":10}]}

Rules:
- Sub-item titles must use actual in-game names (character names, zone/region names, item names, quest names) — never generic labels like "Task 1" or "Item"
- Do not double-count: if you have a counter for a total (e.g. 169 World Intel), do not also list its sub-components as separate tracker items
- Use "progress" for a single linear sequence (chapters, acts, ordered quests)
- Use "progress-bars" when the same set of steps repeats across parallel groups (e.g. 4 nodes × 7 regions, bond level × 6 characters)
- Use "counter" for large collections where naming every item is impractical (more than 20 items)
- Prefer named tasks over counters when specific names are known and count is 20 or fewer
- No tracker may exceed 20 sub-items; split large categories across multiple trackers
- Minimize overlap — each completable thing appears in at most one tracker
- Let the completion guides you find determine how many trackers are needed — no more than 12, and only as many as the game's actual completion content justifies`;
}

const id8 = () => randomUUID().replace(/-/g, '').slice(0, 8);

function withIds(trackers) {
    return trackers.map(t => {
        if (t.type === 'progress') {
            return { ...t, tasks: (t.tasks ?? []).map(task => ({ ...task, id: id8(), state: null })) };
        }
        if (t.type === 'progress-bars') {
            return {
                ...t,
                bars: (t.bars ?? []).map(bar => ({
                    ...bar,
                    id: id8(),
                    steps: (bar.steps ?? []).map(step => ({ ...step, id: id8(), state: null })),
                })),
            };
        }
        if (t.type === 'multi-counter') {
            return { ...t, counters: (t.counters ?? []).map(c => ({ ...c, id: id8(), current: 0 })) };
        }
        if (t.type === 'counter') {
            return { ...t, current: 0 };
        }
        return t;
    });
}

export function parseTrackers(text) {
    // Strip markdown code fences if present (Claude sometimes wraps JSON despite instructions)
    const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '');

    // Scan left-to-right: find each '[' and check if it opens a valid JSON array of objects.
    // This handles brackets in explanatory text (e.g. "[1]", "[source]") that come before
    // the real array — those fail JSON.parse or don't produce an object array, so we skip them.
    for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] !== '[') continue;

        // Walk forward counting bracket depth, respecting strings
        let depth = 0, end = -1, inString = false, escape = false;
        for (let j = i; j < cleaned.length; j++) {
            const c = cleaned[j];
            if (escape)              { escape = false; continue; }
            if (c === '\\' && inString) { escape = true; continue; }
            if (c === '"')           { inString = !inString; continue; }
            if (inString)            continue;
            if (c === '[' || c === '{') depth++;
            else if (c === ']' || c === '}') {
                depth--;
                if (depth === 0) { end = j; break; }
            }
        }

        if (end === -1) continue;

        try {
            const raw = JSON.parse(cleaned.slice(i, end + 1));
            if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
                return withIds(raw);
            }
        } catch { /* not a valid JSON array of objects — try next '[' */ }
    }

    throw new Error('No valid JSON array in AI response');
}

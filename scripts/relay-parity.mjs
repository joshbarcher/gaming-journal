// Relay parity harness — Phase 0 of docs/relay-fold-in.md.
//
// Replays the GET corpus from relay-endpoints.json against two bases and
// deep-diffs the JSON responses. Used as the correctness gate for every
// migration wave: base A = live relay, base B = local journal implementation.
//
//   node scripts/relay-parity.mjs \
//     --a http://192.168.86.65:8050 \
//     --b http://localhost:5173/relay \
//     [--manifest scripts/relay-endpoints.json] [--params scripts/relay-parity-params.json] \
//     [--only api/itad] [--report scripts/relay-parity-report.json]
//
// Notes:
// - GET routes only; mail/sms/meta routes are excluded by default (see EXCLUDE).
// - Parameterized paths are expanded via the params file; `:appid` is auto-filled
//   from $DATA_DIR/relay/steam/games.json samples when available.
// - Volatile keys (fetchedAt etc.) are ignored during diff — see IGNORE_KEYS.
// - Run with journal schedulers OFF (dev default) so a cache-miss 202 doesn't
//   kick off writes from a dev machine.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const argVal = (flag, dflt) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : dflt
}
const A = argVal('--a', 'http://192.168.86.65:8050')
const B = argVal('--b', 'http://localhost:5173/relay')
const MANIFEST = argVal('--manifest', 'scripts/relay-endpoints.json')
const PARAMS_FILE = argVal('--params', 'scripts/relay-parity-params.json')
const ONLY = argVal('--only', null)
const REPORT = argVal('--report', 'scripts/relay-parity-report.json')

// Never part of the migration (mail/sms) or journal-native already (meta routes).
// SSE endpoints are excluded too: they're infinite streams the harness would hang
// consuming — streaming behavior gets its own explicit test at Wave 2.
const EXCLUDE = [
    /^\/api\/mail\b/, /^\/api\/sms\b/, /^\/(sloc|coverage|activity|health)\b/, /^\/$/,
    /\/jobs\/stream$/, /\/sync\/progress$/,
    // Returns a RANDOM poster sample each call (A=B smoke showed different sets,
    // not just different order) — cannot be diffed; Wave 3 verifies it by shape.
    /^\/api\/games\/posters$/,
]

// Endpoints whose top-level array order is process/platform-dependent —
// compared order-insensitively. community-reviews' index is readdir order
// (no sort in the service); clients don't depend on it. store/details is the
// same shape: getGameDetailIndex() walks the store dir in readdir order.
const UNORDERED = new Set(['/api/steam/community-reviews', '/api/steam/store/details'])

// Volatile / non-deterministic keys ignored during diff.
const IGNORE_KEYS = new Set([
    'fetchedAt', 'updatedAt', 'lastSync', 'lastSyncAt', 'lastChecked', 'checkedAt',
    'generatedAt', 'startedAt', 'finishedAt', 'timestamp', 'ts', 'uptime', 'now',
])

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
let params = {}
try { params = JSON.parse(await readFile(PARAMS_FILE, 'utf8')) } catch { /* optional */ }

// Auto-fill :appid samples from the relay games cache when reachable.
if (!params[':appid'] && process.env.DATA_DIR) {
    try {
        const raw = await readFile(path.join(process.env.DATA_DIR, 'relay', 'steam', 'games.json'), 'utf8')
        const games = JSON.parse(raw).games ?? []
        // Spread of samples: first, middle, last — stable across runs.
        const pick = [games[0], games[Math.floor(games.length / 2)], games.at(-1)].filter(Boolean)
        params[':appid'] = pick.map(g => String(g.appid))
    } catch { /* NAS not reachable — params file must cover :appid */ }
}

// Expand a route pattern into concrete URLs using the params map.
// params keys: ':token' → [values]; or exact route path → ['/full/concrete/path'].
function expand(route) {
    if (params[route.path]) return params[route.path]
    let paths = [route.path]
    for (const token of route.path.match(/:[A-Za-z]+/g) ?? []) {
        const values = params[token]
        if (!values) return null // unresolvable
        paths = paths.flatMap(p => values.map(v => p.replace(token, encodeURIComponent(v))))
    }
    // Wildcard routes need explicit samples via the params file.
    return paths.some(p => p.includes('*')) ? null : paths
}

function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') {
        const out = {}
        for (const k of Object.keys(value).sort()) {
            if (!IGNORE_KEYS.has(k)) out[k] = normalize(value[k])
        }
        return out
    }
    return value
}

function diffPaths(a, b, prefix = '', out = [], budget = 20) {
    if (out.length >= budget) return out
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) { out.push(`${prefix}.length ${a.length} != ${b.length}`); return out }
        for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${prefix}[${i}]`, out, budget)
        return out
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (!(k in a)) out.push(`${prefix}.${k} missing in A`)
            else if (!(k in b)) out.push(`${prefix}.${k} missing in B`)
            else diffPaths(a[k], b[k], `${prefix}.${k}`, out, budget)
            if (out.length >= budget) return out
        }
        return out
    }
    if (a !== b) out.push(`${prefix}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
    return out
}

async function fetchSide(base, urlPath) {
    const res = await fetch(base + urlPath, { headers: { accept: 'application/json' } })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, json, text: json ? null : text.slice(0, 200) }
}

const gets = manifest.routes.filter(r =>
    r.method === 'GET'
    && !EXCLUDE.some(re => re.test(r.path))
    && (!ONLY || r.path.includes(ONLY)))

const results = { ok: [], diff: [], error: [], unresolved: [] }
for (const route of gets) {
    const urls = expand(route)
    if (!urls) { results.unresolved.push(route.path); continue }
    for (const u of urls) {
        try {
            const [ra, rb] = [await fetchSide(A, u), await fetchSide(B, u)] // sequential: be polite
            if (ra.status !== rb.status) {
                results.diff.push({ url: u, kind: 'status', a: ra.status, b: rb.status })
            } else if (ra.json || rb.json) {
                let [na, nb] = [normalize(ra.json), normalize(rb.json)]
                if (UNORDERED.has(route.path) && Array.isArray(na) && Array.isArray(nb)) {
                    const key = x => JSON.stringify(x)
                    na = [...na].sort((x, y) => key(x).localeCompare(key(y)))
                    nb = [...nb].sort((x, y) => key(x).localeCompare(key(y)))
                }
                const diffs = diffPaths(na, nb)
                if (diffs.length) results.diff.push({ url: u, kind: 'body', diffs })
                else results.ok.push(u)
            } else if (ra.text === rb.text) {
                results.ok.push(u)
            } else {
                results.diff.push({ url: u, kind: 'text', a: ra.text, b: rb.text })
            }
        } catch (err) {
            results.error.push({ url: u, error: String(err) })
        }
    }
}

await writeFile(REPORT, JSON.stringify({ a: A, b: B, ranAt: new Date().toISOString(), ...results }, null, 2))
console.log(`OK ${results.ok.length} | DIFF ${results.diff.length} | ERROR ${results.error.length} | UNRESOLVED ${results.unresolved.length}`)
if (results.unresolved.length) console.log('Unresolved (add to params file):\n  ' + results.unresolved.join('\n  '))
for (const d of results.diff.slice(0, 10)) console.log('DIFF', d.url, d.kind, d.diffs?.slice(0, 3) ?? `${d.a} vs ${d.b}`)
if (results.diff.length || results.error.length) process.exitCode = 1

// Generates scripts/relay-parity-params.json from real NAS data — sample values
// for the parameterized routes relay-parity.mjs can't fill from :appid alone
// (guides, news gid, nexus modId, reddit postId).
//
// Usage: node --env-file .env scripts/relay-parity-params-gen.mjs

import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(process.env.DATA_DIR.replace(/\\/g, '/'), 'relay')

async function json(p) {
    try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null }
}
async function dirs(p) {
    try { return (await readdir(p, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
}
async function files(p, ext = '.json') {
    try { return (await readdir(p)).filter(f => f.endsWith(ext) && !f.includes('checkpoint') && !f.startsWith('_')) } catch { return [] }
}

const params = {}

// ── Guides: find a steamId/source/guideId that actually has sections ─────────
outer:
for (const steamId of await dirs(path.join(ROOT, 'guides'))) {
    for (const source of await dirs(path.join(ROOT, 'guides', steamId))) {
        for (const guideId of await dirs(path.join(ROOT, 'guides', steamId, source))) {
            const meta = await json(path.join(ROOT, 'guides', steamId, source, guideId, 'meta.json'))
            const sections = await dirs(path.join(ROOT, 'guides', steamId, source, guideId))
            const section = meta?.sections?.[0]?.id ?? sections.find(s => s !== 'img')
            params['/api/guides/:steamId'] = [`/api/guides/${steamId}`]
            params['/api/guides/:steamId/search'] = [`/api/guides/${steamId}/search?q=boss`]
            params['/api/guides/:steamId/:source/:guideId/meta'] = [`/api/guides/${steamId}/${source}/${guideId}/meta`]
            params['/api/guides/:steamId/:source/:guideId/fulltext'] = [`/api/guides/${steamId}/${source}/${guideId}/fulltext`]
            params['/api/guides/:steamId/:source/:guideId/pins'] = [`/api/guides/${steamId}/${source}/${guideId}/pins`]
            if (section) params['/api/guides/:steamId/:source/:guideId/:section'] = [`/api/guides/${steamId}/${source}/${guideId}/${section}`]
            break outer
        }
    }
}

// ── News: an appid + gid from a cached news entry ────────────────────────────
for (const f of (await files(path.join(ROOT, 'steam', 'news'))).slice(0, 10)) {
    const entry = await json(path.join(ROOT, 'steam', 'news', f))
    const item = entry?.items?.[0] ?? entry?.newsitems?.[0]
    if (item?.gid) {
        params['/api/news/:appid/:gid'] = [`/api/news/${path.basename(f, '.json')}/${item.gid}`]
        break
    }
}

// ── Nexus: appid + modId ─────────────────────────────────────────────────────
for (const f of (await files(path.join(ROOT, 'nexus'))).slice(0, 10)) {
    const entry = await json(path.join(ROOT, 'nexus', f))
    const mod = entry?.mods?.[0]
    if (mod?.modId ?? mod?.mod_id) {
        params['/api/nexus/:appid/mod/:modId'] = [`/api/nexus/${path.basename(f, '.json')}/mod/${mod.modId ?? mod.mod_id}`]
        break
    }
}

// ── Reddit: appid + thread postId (+ sub query the route requires) ───────────
for (const f of (await files(path.join(ROOT, 'reddit'))).slice(0, 10)) {
    const entry = await json(path.join(ROOT, 'reddit', f))
    // Entry shape: { appid, gameName, subreddit, sources: [{ subreddit, posts: [...] }] }
    const source = entry?.sources?.find(s => s?.posts?.length)
    const post = source?.posts?.[0]
    const sub = source?.subreddit
    if (post?.id && sub) {
        params['/api/reddit/:appid/thread/:postId'] = [`/api/reddit/${path.basename(f, '.json')}/thread/${post.id}?sub=${encodeURIComponent(sub)}`]
        break
    }
}

const out = 'scripts/relay-parity-params.json'
await writeFile(out, JSON.stringify(params, null, 2))
console.log(`Wrote ${Object.keys(params).length} param entries → ${out}`)
for (const [k, v] of Object.entries(params)) console.log(' ', k, '→', v[0])

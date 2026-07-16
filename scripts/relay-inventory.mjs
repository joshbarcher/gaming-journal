// Relay endpoint inventory — Phase 0 of docs/relay-fold-in.md.
//
// Statically scans the relay repo (no relay code is executed): reads server.js
// for `app.use('<mount>', <router>)` + static mounts, then each router file for
// `router.<method>('<path>', ...)`, and emits a JSON manifest of every route.
// The manifest is the migration checklist and the corpus for relay-parity.mjs.
//
// Usage: node scripts/relay-inventory.mjs [--relay C:\dev\relay-server] [--out scripts/relay-endpoints.json]

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const argVal = (flag, dflt) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : dflt
}
const RELAY = argVal('--relay', 'C:\\dev\\relay-server')
const OUT = argVal('--out', path.join('scripts', 'relay-endpoints.json'))

const serverSrc = await readFile(path.join(RELAY, 'src', 'server.js'), 'utf8')

// 1. import name → router file  (import xRouter from './routers/x/x.router.js')
const importRe = /import\s+(\w+)\s+from\s+'(\.\/routers\/[^']+)'/g
const routerFiles = new Map()
for (const m of serverSrc.matchAll(importRe)) routerFiles.set(m[1], m[2].replace('./', 'src/'))

// 2. mount prefix → router import name  (app.use('/api/x', xRouter))
const mountRe = /app\.use\('([^']+)',\s*(\w+)\)/g
const mounts = []
for (const m of serverSrc.matchAll(mountRe)) {
    if (routerFiles.has(m[2])) mounts.push({ prefix: m[1], name: m[2], file: routerFiles.get(m[2]) })
}

// 3. static/media mounts (express.static / serveWithWebp / app.get with a path handler)
const staticMounts = []
for (const m of serverSrc.matchAll(/app\.use\('([^']+)',\s*express\.static\(([^)]+)\)\)/g)) {
    staticMounts.push({ prefix: m[1], kind: 'static', root: m[2].trim() })
}
for (const m of serverSrc.matchAll(/app\.get\('([^']+)',\s*\(req, res, next\) => serveWithWebp\(req, res, next,\s*(\w+)\)\)/g)) {
    staticMounts.push({ prefix: m[1], kind: 'static-webp', root: m[2] })
}

// 4. per-router routes
const routeRe = /router\.(get|post|put|patch|delete|use)\(\s*'([^']*)'/g
const routes = []
for (const { prefix, file } of mounts) {
    const src = await readFile(path.join(RELAY, file), 'utf8')
    for (const m of src.matchAll(routeRe)) {
        const [, method, sub] = m
        const full = (prefix === '/' ? '' : prefix) + (sub === '/' ? '' : sub) || '/'
        routes.push({ method: method.toUpperCase(), path: full, router: file })
    }
}

routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

const manifest = {
    generatedAt: new Date().toISOString(),
    relayRepo: RELAY,
    counts: { routes: routes.length, routers: mounts.length, staticMounts: staticMounts.length },
    staticMounts,
    routes,
}
await writeFile(OUT, JSON.stringify(manifest, null, 2))

// Console summary grouped by router
const byRouter = new Map()
for (const r of routes) byRouter.set(r.router, (byRouter.get(r.router) ?? 0) + 1)
console.log(`Routes: ${routes.length} across ${mounts.length} routers, ${staticMounts.length} static mounts → ${OUT}\n`)
for (const [file, n] of [...byRouter].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), file)

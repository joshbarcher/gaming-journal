import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// The app is served over plain http on the LAN (a bare IP, or a *.home name), which is NOT a
// secure context — so crypto.randomUUID is undefined there and calling it throws a TypeError
// that kills the click handler outright. Client code must go through uuid() in lib/js/utils.ts
// (or the self-contained copy inside the vendored stickywall). Sibling secure-context-only APIs
// to watch for if they ever show up: crypto.subtle, navigator.clipboard, navigator.mediaDevices.

const SRC   = join(process.cwd(), 'src') // vitest root is the repo root
const SKIP  = new Set(['server', 'tests', 'node_modules'])
const EXT   = /\.(ts|js|svelte)$/
const SERVER_FILE = /\.server\.(ts|js)$|^\+server\.(ts|js)$/

function clientFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            if (!SKIP.has(entry)) clientFiles(full, out)
        } else if (EXT.test(entry) && !SERVER_FILE.test(entry)) {
            out.push(full)
        }
    }
    return out
}

describe('secure-context-only APIs', () => {
    it('no client code calls crypto.randomUUID() directly', () => {
        const files = [...clientFiles(join(SRC, 'lib')), ...clientFiles(join(SRC, 'routes'))]
        expect(files.length).toBeGreaterThan(50) // the walk actually found the source tree

        const offenders = files
            .filter(f => /\bcrypto\s*\.\s*randomUUID\s*\(/.test(readFileSync(f, 'utf8')))
            .map(f => relative(SRC, f).split(sep).join('/'))

        expect(offenders, `use uuid() from lib/js/utils.ts instead:\n  ${offenders.join('\n  ')}`).toEqual([])
    })
})

// Streaming static helper — the contract relay's express.static/sendFile gave
// clients, now hand-rolled (docs/relay-fold-in.md § Phase 1). Range support is
// what keeps <video> seekable; 304s are what keep hard reloads off the NAS.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serveStatic, parseRange, safeJoin } from '../../lib/server/relay/shared/static-files.js'

let root: string
const BODY = '0123456789abcdefghij' // 20 bytes

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'gj-static-'))
    await writeFile(path.join(root, 'file.mp4'), BODY)
    await mkdir(path.join(root, 'sub'), { recursive: true })
    await writeFile(path.join(root, 'sub', 'pic.png'), BODY)
})

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

const req = (headers: Record<string, string> = {}, method = 'GET') =>
    new Request('http://test/x', { method, headers })

describe('safeJoin', () => {
    it('resolves inside the root', () => {
        expect(safeJoin(root, 'sub/pic.png')).toBe(path.join(root, 'sub', 'pic.png'))
    })
    it('refuses traversal escapes', () => {
        expect(safeJoin(root, '../outside.txt')).toBeNull()
        expect(safeJoin(root, 'sub/../../outside.txt')).toBeNull()
    })
    it('allows the root itself only as an exact match', () => {
        expect(safeJoin(root, '.')).toBe(path.resolve(root))
    })
})

describe('parseRange', () => {
    it('parses start-end', () => expect(parseRange('bytes=2-5', 20)).toEqual({ start: 2, end: 5 }))
    it('parses open-ended', () => expect(parseRange('bytes=5-', 20)).toEqual({ start: 5, end: 19 }))
    it('parses suffix', () => expect(parseRange('bytes=-4', 20)).toEqual({ start: 16, end: 19 }))
    it('clamps end to size', () => expect(parseRange('bytes=0-999', 20)).toEqual({ start: 0, end: 19 }))
    it('rejects start beyond EOF as unsatisfiable', () => expect(parseRange('bytes=20-', 20)).toBe('unsatisfiable'))
    it('rejects zero-length suffix as unsatisfiable', () => expect(parseRange('bytes=-0', 20)).toBe('unsatisfiable'))
    it('ignores malformed and multi-range headers (→ full 200)', () => {
        expect(parseRange('bytes=1-2,4-5', 20)).toBeNull()
        expect(parseRange('items=1-2', 20)).toBeNull()
        expect(parseRange(null, 20)).toBeNull()
    })
})

describe('serveStatic', () => {
    it('serves a full 200 with mime, immutable cache, etag, accept-ranges', async () => {
        const res = (await serveStatic(req(), root, 'file.mp4'))!
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('video/mp4')
        expect(res.headers.get('cache-control')).toContain('immutable')
        expect(res.headers.get('accept-ranges')).toBe('bytes')
        expect(res.headers.get('etag')).toBeTruthy()
        expect(await res.text()).toBe(BODY)
    })

    it('returns null for a missing file (caller 404s)', async () => {
        expect(await serveStatic(req(), root, 'nope.mp4')).toBeNull()
    })

    it('returns 403 for traversal attempts', async () => {
        const res = (await serveStatic(req(), root, '../etc/passwd'))!
        expect(res.status).toBe(403)
    })

    it('answers a satisfiable Range with 206 + content-range + partial body', async () => {
        const res = (await serveStatic(req({ range: 'bytes=2-5' }), root, 'file.mp4'))!
        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe('bytes 2-5/20')
        expect(res.headers.get('content-length')).toBe('4')
        expect(await res.text()).toBe('2345')
    })

    it('answers a suffix Range with the file tail', async () => {
        const res = (await serveStatic(req({ range: 'bytes=-4' }), root, 'file.mp4'))!
        expect(res.status).toBe(206)
        expect(await res.text()).toBe('ghij')
    })

    it('answers an unsatisfiable Range with 416 + bytes */size', async () => {
        const res = (await serveStatic(req({ range: 'bytes=99-' }), root, 'file.mp4'))!
        expect(res.status).toBe(416)
        expect(res.headers.get('content-range')).toBe('bytes */20')
    })

    it('answers If-None-Match with 304 and no body', async () => {
        const first = (await serveStatic(req(), root, 'file.mp4'))!
        const etag = first.headers.get('etag')!
        const res = (await serveStatic(req({ 'if-none-match': etag }), root, 'file.mp4'))!
        expect(res.status).toBe(304)
        expect(res.body).toBeNull()
    })

    it('answers If-Modified-Since with 304 for an unchanged file', async () => {
        const future = new Date(Date.now() + 60_000).toUTCString()
        const res = (await serveStatic(req({ 'if-modified-since': future }), root, 'file.mp4'))!
        expect(res.status).toBe(304)
    })

    it('a stale If-None-Match still serves the body', async () => {
        const res = (await serveStatic(req({ 'if-none-match': '"stale"' }), root, 'file.mp4'))!
        expect(res.status).toBe(200)
        expect(await res.text()).toBe(BODY)
    })

    it('HEAD returns headers with no body', async () => {
        const res = (await serveStatic(req({}, 'HEAD'), root, 'file.mp4'))!
        expect(res.status).toBe(200)
        expect(res.headers.get('content-length')).toBe('20')
        expect(res.body).toBeNull()
    })

    it('unknown extensions fall back to octet-stream', async () => {
        await writeFile(path.join(root, 'blob.xyz'), 'x')
        const res = (await serveStatic(req(), root, 'blob.xyz'))!
        expect(res.headers.get('content-type')).toBe('application/octet-stream')
    })
})

// Streaming static-file responses for relay media routes (docs/relay-fold-in.md
// § Phase 1). Replaces relay's express.static / res.sendFile mounts:
//   /relay/images/steam, /relay/videos/steam|reddit, /relay/guides-img  → serveStatic
//   /relay/images/reddit|nexus                                          → serveWithWebp
//
// Contract carried over from the relay:
// - Range support is REQUIRED — <video> seeking breaks without 206 responses.
// - Conditional requests (If-None-Match / If-Modified-Since) answer 304 so a
//   hard reload never re-reads the NAS.
// - Media is content-addressed → served hard-cached and immutable.
// - serveWithWebp converts jpg/png/gif to a .webp sidecar on first request
//   (an intentional request-path NAS write — dev instances should be running
//   RELAY_FORWARD so this only ever happens on the prod box).

import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import logger from '../../logger.js'

const MIME: Record<string, string> = {
    '.webp': 'image/webp',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.json': 'application/json',
    '.txt':  'text/plain; charset=utf-8',
}

const CONVERTIBLE = new Set(['.jpg', '.jpeg', '.png', '.gif'])

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** Resolve rel under root, refusing anything that escapes root. Null = refuse. */
export function safeJoin(root: string, rel: string): string | null {
    const abs = path.resolve(root, rel)
    const normRoot = path.resolve(root)
    if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null
    return abs
}

/** Parse a single-range `bytes=` header against a file size. */
export function parseRange(header: string | null, size: number): { start: number, end: number } | 'unsatisfiable' | null {
    if (!header) return null
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!m || (!m[1] && !m[2])) return null            // malformed / multi-range → ignore, serve 200
    if (!m[1]) {                                       // suffix: bytes=-N (last N bytes)
        const suffix = Number(m[2])
        if (suffix === 0) return 'unsatisfiable'
        return { start: Math.max(0, size - suffix), end: size - 1 }
    }
    const start = Number(m[1])
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) return 'unsatisfiable'
    return { start, end }
}

function etagFor(size: number, mtimeMs: number): string {
    return `"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`
}

function baseHeaders(mime: string, size: number, mtimeMs: number): Headers {
    return new Headers({
        'content-type':   mime,
        'cache-control':  IMMUTABLE_CACHE,
        'accept-ranges':  'bytes',
        'etag':           etagFor(size, mtimeMs),
        'last-modified':  new Date(mtimeMs).toUTCString(),
        'content-length': String(size),
    })
}

function fileStream(abs: string, opts?: { start: number, end: number }): ReadableStream {
    return Readable.toWeb(createReadStream(abs, opts)) as ReadableStream
}

/**
 * Serve one file from `root` at `rel`, honoring conditional and Range headers.
 * Returns null when the file does not exist (caller decides the 404 shape) and
 * 403 when the path escapes the root.
 */
export async function serveStatic(request: Request, root: string, rel: string, mimeOverride?: string): Promise<Response | null> {
    const abs = safeJoin(root, rel)
    if (!abs) return new Response('Forbidden', { status: 403 })

    let info
    try {
        info = await stat(abs)
    } catch {
        return null
    }
    if (!info.isFile()) return null

    const mime = mimeOverride ?? MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
    const headers = baseHeaders(mime, info.size, info.mtimeMs)

    // Conditional: ETag first (stronger), then Last-Modified.
    const inm = request.headers.get('if-none-match')
    const ims = request.headers.get('if-modified-since')
    const notModified = inm
        ? inm === headers.get('etag')
        : ims !== null && info.mtimeMs <= Date.parse(ims) + 999   // HTTP dates have 1s resolution
    if (notModified) {
        headers.delete('content-length')
        return new Response(null, { status: 304, headers })
    }

    const range = parseRange(request.headers.get('range'), info.size)
    if (range === 'unsatisfiable') {
        return new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' },
        })
    }
    if (range) {
        headers.set('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        headers.set('content-length', String(range.end - range.start + 1))
        return new Response(fileStream(abs, range), { status: 206, headers })
    }

    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(fileStream(abs), { status: 200, headers })
}

/**
 * serveStatic + on-demand WebP sidecar conversion for jpg/png/gif (ports
 * relay images.service.serveWithWebp). `sharp` is imported lazily so the
 * dependency is only needed once media waves land.
 */
export async function serveWithWebp(request: Request, root: string, rel: string): Promise<Response | null> {
    const ext = path.extname(rel).toLowerCase()
    if (!CONVERTIBLE.has(ext)) return serveStatic(request, root, rel)

    const sidecarRel = rel.slice(0, -ext.length) + '.webp'
    const sidecar = await serveStatic(request, root, sidecarRel)
    if (sidecar && sidecar.status !== 403) return sidecar

    const abs = safeJoin(root, rel)
    if (!abs) return new Response('Forbidden', { status: 403 })
    try {
        await stat(abs)
    } catch {
        return null
    }

    try {
        // Lazy import: sharp is a heavy native dep only this conversion path
        // needs — keep it off the boot path.
        const { default: sharp } = await import('sharp')
        const sidecarAbs = safeJoin(root, sidecarRel)!
        await sharp(abs).webp({ quality: 85 }).toFile(sidecarAbs)
        logger.debug('[static] WebP sidecar created', { src: path.basename(abs) })
        return serveStatic(request, root, sidecarRel)
    } catch (err) {
        logger.warn('[static] WebP conversion failed — serving original', { file: path.basename(abs), err: err instanceof Error ? err.message : String(err) })
        return serveStatic(request, root, rel)
    }
}

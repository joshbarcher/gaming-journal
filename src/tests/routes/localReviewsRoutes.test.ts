import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import { GET as getAllRoute } from '../../routes/api/local-reviews/+server.js'
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from '../../routes/api/local-reviews/[appid]/+server.js'
import { POST as postNote } from '../../routes/api/local-reviews/[appid]/notes/+server.js'
import { PATCH as patchNote, DELETE as deleteNoteRoute } from '../../routes/api/local-reviews/[appid]/notes/[noteId]/+server.js'

// Adversarial tests for the local-reviews API routes. Handlers are invoked
// directly with mock events; the service persists under process.env.DATA_DIR,
// so each test gets a throwaway directory (same pattern as localReviewsService.test.ts).

function tmpDataDir() {
    return path.join(os.tmpdir(), `lr-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function jsonRequest(body: unknown, method = 'PUT'): Request {
    return new Request('http://test.local/', {
        method,
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
    })
}

function rawRequest(raw: string, method = 'PUT'): Request {
    return new Request('http://test.local/', {
        method,
        headers: { 'content-type': 'application/json' },
        body:    raw,
    })
}

function validReview(overrides: Record<string, unknown> = {}) {
    return { stars: 4, ratings: {}, tags: [], notes: [], review: 'text', ...overrides }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (params: Record<string, string>, request?: Request) => ({ params, request } as any)

describe('local-reviews routes (adversarial)', () => {
    let dataDir: string
    let savedDataDir: string | undefined

    beforeEach(() => {
        savedDataDir = process.env.DATA_DIR
        dataDir = tmpDataDir()
        process.env.DATA_DIR = dataDir
    })

    afterEach(async () => {
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('GET /api/local-reviews (collection)', () => {
        it('returns an empty object, not an error, when nothing has ever been stored', async () => {
            const res = await getAllRoute()
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({})
        })

        it('returns a 500 JSON envelope (not a throw) when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await getAllRoute()
            expect(res.status).toBe(500)
            const body = await res.json()
            expect(body.error).toMatch(/DATA_DIR/)
        })
    })

    describe('GET /api/local-reviews/[appid]', () => {
        it('404s for a nonexistent numeric appid', async () => {
            const res = await getOne(ev({ appid: '999999' }))
            expect(res.status).toBe(404)
            expect((await res.json()).error).toBe('No review found')
        })

        it.each(['abc', '__proto__', 'constructor'])(
            '400s for invalid appid %j (regression: once read the shared NaN bucket)',
            async (appid) => {
                const res = await getOne(ev({ appid }))
                expect(res.status).toBe(400)
            },
        )

        it('normalizes "007" and "7" to the same review (Number coercion contract)', async () => {
            await putOne(ev({ appid: '7' }, jsonRequest(validReview({ review: 'seven' }))))
            const res = await getOne(ev({ appid: '007' }))
            expect(res.status).toBe(200)
            expect((await res.json()).review).toBe('seven')
        })

        it('500 JSON envelope when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await getOne(ev({ appid: '1' }))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })

    describe('PUT /api/local-reviews/[appid]', () => {
        // BUG (medium): src/routes/api/local-reviews/[appid]/+server.ts:16 — a malformed
        // JSON body is a client error, but request.json()'s SyntaxError falls into the
        // generic catch and comes back as 500. Should be 400. (Compare the notes POST
        // route, which at least validates its one field.)
        it('malformed JSON body must return 400 (client error), not 500', async () => {
            const res = await putOne(ev({ appid: '1' }, rawRequest('{"stars": tru')))
            expect(res.status).toBe(400)
        })

        // Regression: Number(params.appid) was never validated, so every non-numeric
        // appid collapsed to the single "NaN" key — a review written via /abc was
        // readable via /xyz. Writes and reads now reject invalid appids with 400.
        it('non-numeric appids must not collapse into one shared "NaN" review', async () => {
            const put = await putOne(ev({ appid: 'abc' }, jsonRequest(validReview({ review: 'via abc' }))))
            expect(put.status).toBe(400)
            const res = await getOne(ev({ appid: 'xyz' }))
            expect(res.status).toBe(400)
        })

        it('re-stamps updatedAt — a client-supplied updatedAt is ignored', async () => {
            const res = await putOne(ev({ appid: '2' }, jsonRequest(validReview({ updatedAt: '1999-01-01T00:00:00.000Z' }))))
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.updatedAt).not.toBe('1999-01-01T00:00:00.000Z')
            expect(Number.isNaN(new Date(body.updatedAt).getTime())).toBe(false)
        })

        // Regression: the route once accepted ANY JSON root — `null` stored a bare
        // { updatedAt } review and a string body character-spread into {0:'h',1:'i'}.
        // Non-object roots are now 400s and nothing persists.
        it.each([['null body', 'null'], ['string body', '"hi"'], ['array body', '[1,2]']])(
            'rejects a non-object JSON root (%s) with 400',
            async (_label, raw) => {
                const put = await putOne(ev({ appid: '3' }, rawRequest(raw)))
                expect(put.status).toBe(400)
                const got = await getOne(ev({ appid: '3' }))
                expect(got.status).toBe(404)  // nothing was stored
            },
        )

        it('a PUT with notes:[] silently wipes existing notes (full-replace semantics)', async () => {
            await postNote(ev({ appid: '5' }, jsonRequest({ text: 'precious note' }, 'POST')))
            await putOne(ev({ appid: '5' }, jsonRequest(validReview({ notes: [] }))))
            const got = await (await getOne(ev({ appid: '5' }))).json()
            expect(got.notes).toEqual([])
        })

        it('500 JSON envelope when DATA_DIR is unset (valid body)', async () => {
            delete process.env.DATA_DIR
            const res = await putOne(ev({ appid: '1' }, jsonRequest(validReview())))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })

    describe('DELETE /api/local-reviews/[appid]', () => {
        it('is idempotent — deleting a nonexistent review returns { ok: true }', async () => {
            const res = await deleteOne(ev({ appid: '424242' }))
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ ok: true })
        })

        it('deletes only the targeted review', async () => {
            await putOne(ev({ appid: '10' }, jsonRequest(validReview({ review: 'keep' }))))
            await putOne(ev({ appid: '11' }, jsonRequest(validReview({ review: 'drop' }))))
            await deleteOne(ev({ appid: '11' }))
            expect((await getOne(ev({ appid: '10' }))).status).toBe(200)
            expect((await getOne(ev({ appid: '11' }))).status).toBe(404)
        })
    })

    describe('POST /api/local-reviews/[appid]/notes', () => {
        it('400 when text is missing', async () => {
            const res = await postNote(ev({ appid: '1' }, jsonRequest({}, 'POST')))
            expect(res.status).toBe(400)
            expect((await res.json()).error).toBe('text is required')
        })

        it('400 when text is an empty string', async () => {
            const res = await postNote(ev({ appid: '1' }, jsonRequest({ text: '' }, 'POST')))
            expect(res.status).toBe(400)
        })

        it('400 when text is whitespace-only', async () => {
            const res = await postNote(ev({ appid: '1' }, jsonRequest({ text: '   \n\t ' }, 'POST')))
            expect(res.status).toBe(400)
        })

        it('400 when text is the number 42', async () => {
            const res = await postNote(ev({ appid: '1' }, jsonRequest({ text: 42 }, 'POST')))
            expect(res.status).toBe(400)
        })

        it('400 when text is an object', async () => {
            const res = await postNote(ev({ appid: '1' }, jsonRequest({ text: { evil: true } }, 'POST')))
            expect(res.status).toBe(400)
        })

        it('400 when the body is a bare JSON string (destructures to undefined text)', async () => {
            const res = await postNote(ev({ appid: '1' }, rawRequest('"just a string"', 'POST')))
            expect(res.status).toBe(400)
        })

        // BUG (medium): src/routes/api/local-reviews/[appid]/notes/+server.ts:6 —
        // malformed JSON is a client error but lands in the generic catch as 500.
        it('malformed JSON body must return 400, not 500', async () => {
            const res = await postNote(ev({ appid: '1' }, rawRequest('{not json', 'POST')))
            expect(res.status).toBe(400)
        })

        // BUG (medium): same line — a JSON `null` body throws at destructuring
        // (`const { text } = null`) and comes back 500. It is a client error: 400.
        it('JSON null body must return 400, not 500', async () => {
            const res = await postNote(ev({ appid: '1' }, rawRequest('null', 'POST')))
            expect(res.status).toBe(400)
        })

        it('accepts a 100k-character note and round-trips it (trimmed)', async () => {
            const big = 'x'.repeat(100_000)
            const res = await postNote(ev({ appid: '20' }, jsonRequest({ text: `  ${big}  ` }, 'POST')))
            expect(res.status).toBe(200)
            const note = await res.json()
            expect(note.text.length).toBe(100_000)
            const got = await (await getOne(ev({ appid: '20' }))).json()
            expect(got.notes[0].text.length).toBe(100_000)
        })

        it('scaffolds a blank review when adding a note to an unreviewed game', async () => {
            const res = await postNote(ev({ appid: '21' }, jsonRequest({ text: 'first' }, 'POST')))
            expect(res.status).toBe(200)
            const got = await (await getOne(ev({ appid: '21' }))).json()
            expect(got.stars).toBe(0)
            expect(got.notes.length).toBe(1)
        })
    })

    describe('PATCH /api/local-reviews/[appid]/notes/[noteId]', () => {
        it('404 for a nonexistent appid', async () => {
            const res = await patchNote(ev({ appid: '777', noteId: 'nope' }, jsonRequest({ pinned: true }, 'PATCH')))
            expect(res.status).toBe(404)
            expect((await res.json()).error).toBe('Note not found')
        })

        it('404 for a nonexistent noteId on a real review', async () => {
            await postNote(ev({ appid: '30' }, jsonRequest({ text: 'real' }, 'POST')))
            const res = await patchNote(ev({ appid: '30', noteId: 'bogus-id' }, jsonRequest({ pinned: true }, 'PATCH')))
            expect(res.status).toBe(404)
        })

        // BUG (medium): src/routes/api/local-reviews/[appid]/notes/[noteId]/+server.ts:6 —
        // malformed JSON is a client error but returns 500 via the generic catch.
        it('malformed JSON body must return 400, not 500', async () => {
            const res = await patchNote(ev({ appid: '30', noteId: 'x' }, rawRequest('{{{{', 'PATCH')))
            expect(res.status).toBe(400)
        })

        // BUG (medium): same line — JSON `null` body throws at destructuring → 500.
        it('JSON null body must return 400, not 500', async () => {
            const res = await patchNote(ev({ appid: '30', noteId: 'x' }, rawRequest('null', 'PATCH')))
            expect(res.status).toBe(400)
        })

        it('ignores id/createdAt/text in the body — only pinned is honored, identity survives', async () => {
            const note = await (await postNote(ev({ appid: '31' }, jsonRequest({ text: 'original' }, 'POST')))).json()
            const res = await patchNote(ev({ appid: '31', noteId: note.id }, jsonRequest({
                pinned:    true,
                id:        'hacked-id',
                createdAt: '1970-01-01T00:00:00.000Z',
                text:      'rewritten',
            }, 'PATCH')))
            expect(res.status).toBe(200)
            const updated = await res.json()
            // The route only extracts `pinned`; the service additionally strips id/createdAt.
            // Consequence worth knowing: note TEXT is not editable through this route at all.
            expect(updated.id).toBe(note.id)
            expect(updated.createdAt).toBe(note.createdAt)
            expect(updated.text).toBe('original')
            expect(updated.pinned).toBe(true)
        })

        // Contract (quirk): pinned goes through Boolean(), so the STRING "false" pins
        // the note. Any truthy junk ({}, "no", 1) pins; only falsy values unpin.
        it('coerces pinned with Boolean() — string "false" pins the note', async () => {
            const note = await (await postNote(ev({ appid: '32' }, jsonRequest({ text: 'n' }, 'POST')))).json()
            const res = await patchNote(ev({ appid: '32', noteId: note.id }, jsonRequest({ pinned: 'false' }, 'PATCH')))
            expect((await res.json()).pinned).toBe(true)
        })

        it('missing pinned field unpins (undefined → Boolean → false)', async () => {
            const note = await (await postNote(ev({ appid: '33' }, jsonRequest({ text: 'n' }, 'POST')))).json()
            await patchNote(ev({ appid: '33', noteId: note.id }, jsonRequest({ pinned: true }, 'PATCH')))
            const res = await patchNote(ev({ appid: '33', noteId: note.id }, jsonRequest({}, 'PATCH')))
            expect((await res.json()).pinned).toBe(false)
        })
    })

    describe('DELETE /api/local-reviews/[appid]/notes/[noteId]', () => {
        it('returns { ok: true } for a nonexistent appid (idempotent)', async () => {
            const res = await deleteNoteRoute(ev({ appid: '999', noteId: 'ghost' }))
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ ok: true })
        })

        it('returns { ok: true } for a nonexistent noteId and leaves other notes intact', async () => {
            const note = await (await postNote(ev({ appid: '40' }, jsonRequest({ text: 'stay' }, 'POST')))).json()
            const res = await deleteNoteRoute(ev({ appid: '40', noteId: 'not-real' }))
            expect(res.status).toBe(200)
            const got = await (await getOne(ev({ appid: '40' }))).json()
            expect(got.notes.map((n: { id: string }) => n.id)).toEqual([note.id])
        })

        it('deletes only the targeted note', async () => {
            const n1 = await (await postNote(ev({ appid: '41' }, jsonRequest({ text: 'one' }, 'POST')))).json()
            const n2 = await (await postNote(ev({ appid: '41' }, jsonRequest({ text: 'two' }, 'POST')))).json()
            await deleteNoteRoute(ev({ appid: '41', noteId: n1.id }))
            const got = await (await getOne(ev({ appid: '41' }))).json()
            expect(got.notes.map((n: { id: string }) => n.id)).toEqual([n2.id])
        })
    })
})

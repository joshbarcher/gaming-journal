import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { GET } from '../../routes/api/config/+server.js'

describe('GET /api/config', () => {
    let savedRelayUrl: string | undefined

    beforeEach(() => {
        savedRelayUrl = process.env.RELAY_URL
    })

    afterEach(() => {
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
    })

    it('falls back to http://localhost:8050 when RELAY_URL is unset', async () => {
        delete process.env.RELAY_URL
        const res = GET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ relayUrl: 'http://localhost:8050' })
    })

    it('strips a single trailing slash', async () => {
        process.env.RELAY_URL = 'http://relay.example:9000/'
        expect((await GET().json()).relayUrl).toBe('http://relay.example:9000')
    })

    it('leaves a slashless URL untouched', async () => {
        process.env.RELAY_URL = 'http://relay.example:9000'
        expect((await GET().json()).relayUrl).toBe('http://relay.example:9000')
    })

    it('only strips ONE trailing slash — "http://x//" keeps one (documented quirk)', async () => {
        process.env.RELAY_URL = 'http://relay.example:9000//'
        expect((await GET().json()).relayUrl).toBe('http://relay.example:9000/')
    })

    it('an empty-string RELAY_URL wins over the default (documented ?? vs || quirk)', async () => {
        // `'' ?? default` keeps '' — a blank (but set) env var ships an empty
        // relayUrl to the client. Defensible-if-known; pinned here so a change
        // to || is a conscious one.
        process.env.RELAY_URL = ''
        expect((await GET().json()).relayUrl).toBe('')
    })

    it('does not validate the URL shape (garbage in, garbage out)', async () => {
        process.env.RELAY_URL = 'not a url at all/'
        expect((await GET().json()).relayUrl).toBe('not a url at all')
    })
})

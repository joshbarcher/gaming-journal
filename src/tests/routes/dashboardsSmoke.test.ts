import { describe, it, expect } from 'vitest'

// Thin wiring over vendored fleet handlers (sloc.js / activity.js /
// coverage.js at the repo root — drop-in code we don't own). One smoke test
// per route: the GET export exists and produces a Response. No deep assertions
// on vendored internals.

import { GET as slocGET } from '../../routes/sloc/+server.js'
import { GET as slocDashGET } from '../../routes/sloc/dashboard/+server.js'
import { GET as activityGET } from '../../routes/activity/+server.js'
import { GET as activityDashGET } from '../../routes/activity/dashboard/+server.js'
import { GET as coverageGET } from '../../routes/coverage/+server.js'
import { GET as coverageDashGET } from '../../routes/coverage/dashboard/+server.js'

describe('vendored dashboard route wiring', () => {
    it('GET /sloc returns a JSON Response', async () => {
        expect(typeof slocGET).toBe('function')
        const res = await slocGET({ url: new URL('http://x/sloc') } as never)
        expect(res).toBeInstanceOf(Response)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('application/json')
    }, 60_000) // full repo tree walk — allow time on a cold disk cache

    it('GET /sloc/dashboard returns a Response', async () => {
        const res = await slocDashGET()
        expect(res).toBeInstanceOf(Response)
        expect(res.status).toBe(200)
    })

    it('GET /activity returns a Response (may be 500 when no tracker is installed — hooks.server.ts installs it in prod)', async () => {
        const res = await activityGET()
        expect(res).toBeInstanceOf(Response)
        expect([200, 500]).toContain(res.status)
        expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('GET /activity/dashboard returns a Response', async () => {
        const res = await activityDashGET()
        expect(res).toBeInstanceOf(Response)
        expect(res.status).toBe(200)
    })

    it('GET /coverage returns a JSON Response', async () => {
        const res = await coverageGET({ url: new URL('http://x/coverage') } as never)
        expect(res).toBeInstanceOf(Response)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('GET /coverage/dashboard returns a Response', async () => {
        const res = await coverageDashGET()
        expect(res).toBeInstanceOf(Response)
        expect(res.status).toBe(200)
    })
})

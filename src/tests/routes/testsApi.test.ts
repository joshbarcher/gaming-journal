import { describe, it, beforeEach, expect, vi } from 'vitest'

// Mock the testRunner service — the real one spawns `vitest run` recursively.
vi.mock('$lib/server/services/testRunner.js', () => ({
    runTests:   vi.fn(),
    getResults: vi.fn(),
    isRunning:  vi.fn(),
}))

import { POST, GET } from '../../routes/api/tests/+server.js'
import { GET as statusGET } from '../../routes/api/tests/status/+server.js'
import { runTests, getResults, isRunning } from '$lib/server/services/testRunner.js'

const mockRunTests   = vi.mocked(runTests)
const mockGetResults = vi.mocked(getResults)
const mockIsRunning  = vi.mocked(isRunning)

const FAKE_RESULTS = { summary: { pass: 1, fail: 0, total: 1, duration: 5 }, suites: [], ranAt: '2026-07-16T00:00:00.000Z' }

beforeEach(() => {
    vi.clearAllMocks()
})

describe('POST /api/tests', () => {
    it('returns the runner results as JSON on success', async () => {
        mockRunTests.mockResolvedValue(FAKE_RESULTS as never)
        const res = await POST()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(FAKE_RESULTS)
        expect(mockRunTests).toHaveBeenCalledTimes(1)
    })

    it('maps the concurrent-run guard to 409 with an error key', async () => {
        mockRunTests.mockRejectedValue(new Error('Tests already running'))
        const res = await POST()
        expect(res.status).toBe(409)
        expect((await res.json()).error).toBe('Tests already running')
    })

    it('maps any other runner failure to 500 with an error key', async () => {
        mockRunTests.mockRejectedValue(new Error('spawn ENOENT'))
        const res = await POST()
        expect(res.status).toBe(500)
        expect((await res.json()).error).toBe('spawn ENOENT')
    })

    it('a message merely CONTAINING the guard text is still a 500 (exact-match contract)', async () => {
        mockRunTests.mockRejectedValue(new Error('fatal: Tests already running elsewhere'))
        const res = await POST()
        expect(res.status).toBe(500)
    })

    it('a thrown non-Error still yields a JSON error response, not a crash', async () => {
        // (err as Error).message is undefined for a thrown string — the route
        // must still produce a 500 JSON body (the error key is dropped by
        // JSON.stringify; pinned so a shape change is deliberate).
        mockRunTests.mockRejectedValue('string throw')
        const res = await POST()
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({})
    })
})

describe('GET /api/tests', () => {
    it('returns 404 with an error key before any run has completed', async () => {
        mockGetResults.mockReturnValue(null as never)
        const res = GET()
        expect(res.status).toBe(404)
        expect((await res.json()).error).toMatch(/run tests first/i)
    })

    it('returns the cached results once available', async () => {
        mockGetResults.mockReturnValue(FAKE_RESULTS as never)
        const res = GET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(FAKE_RESULTS)
    })
})

describe('GET /api/tests/status', () => {
    it('reports running: true', async () => {
        mockIsRunning.mockReturnValue(true)
        expect(await statusGET().json()).toEqual({ running: true })
    })

    it('reports running: false', async () => {
        mockIsRunning.mockReturnValue(false)
        expect(await statusGET().json()).toEqual({ running: false })
    })

    it('coerces nothing — a truthy non-boolean leaks through as-is (shape contract)', async () => {
        // isRunning() is typed boolean; if the service ever returned something
        // else the route would serialize it verbatim. Pins the passthrough.
        mockIsRunning.mockReturnValue(1 as never)
        expect((await statusGET().json()).running).toBe(1)
    })
})

import { describe, it, expect } from 'vitest'
import { GET as healthGET, _formatUptime } from '../../routes/health/+server.js'
import { GET as testsPageGET } from '../../routes/tests/+server.js'

describe('GET /health', () => {
    it('returns status ok and a formatted uptime string', async () => {
        const res = healthGET()
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.status).toBe('ok')
        expect(body.uptime).toMatch(/^(\d+d( \d+h)?|\d+h( \d+m)?|\d+m)$/)
    })
})

describe('_formatUptime', () => {
    it.each([
        [0, '0m'],
        [59, '0m'],
        [60, '1m'],
        [3599, '59m'],
        [3600, '1h'],
        [3660, '1h 1m'],
        [86399, '23h 59m'],
        [86400, '1d'],
        [90000, '1d 1h'],
        [86460, '1d'],        // minutes are dropped once days are shown
        [172800 + 3600, '2d 1h'],
    ])('formats %ds as %j', (seconds, expected) => {
        expect(_formatUptime(seconds)).toBe(expected)
    })

    it('garbage in, garbage out for impossible inputs (documented, uptime is never negative/NaN)', () => {
        // Pins the current behavior so a hardening change is deliberate:
        expect(_formatUptime(-61)).toBe('-2m')
        expect(_formatUptime(NaN)).toBe('NaNm')
    })
})

describe('GET /tests (static test-dashboard page)', () => {
    it('serves public/tests.html as HTML', async () => {
        const res = await testsPageGET()
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
        const html = await res.text()
        expect(html.length).toBeGreaterThan(0)
        expect(html).toMatch(/<\w+/) // looks like markup, not an error string
    })
})

import { it, expect } from 'vitest'
import { _formatUptime, GET } from '../routes/health/+server.js'

it('formatUptime: minutes only', () => {
    expect(_formatUptime(90)).toBe('1m')
})

it('formatUptime: zero seconds', () => {
    expect(_formatUptime(0)).toBe('0m')
})

it('formatUptime: exactly one hour', () => {
    expect(_formatUptime(3600)).toBe('1h')
})

it('formatUptime: hours and minutes', () => {
    expect(_formatUptime(3661)).toBe('1h 1m')
})

it('formatUptime: exactly one day', () => {
    expect(_formatUptime(86400)).toBe('1d')
})

it('formatUptime: days and hours', () => {
    expect(_formatUptime(90000)).toBe('1d 1h')
})

it('formatUptime: days only when no leftover hours', () => {
    expect(_formatUptime(172800)).toBe('2d')
})

it('GET /health: returns status ok', async () => {
    const response = GET()
    const data = await response.json()
    expect(data.status).toBe('ok')
})

it('GET /health: returns uptime as non-empty string', async () => {
    const response = GET()
    const data = await response.json()
    expect(typeof data.uptime).toBe('string')
    expect(data.uptime.length).toBeGreaterThan(0)
})

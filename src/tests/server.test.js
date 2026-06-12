import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _formatUptime, GET } from '../routes/health/+server.js'

test('formatUptime: minutes only', () => {
    assert.equal(_formatUptime(90), '1m')
})

test('formatUptime: zero seconds', () => {
    assert.equal(_formatUptime(0), '0m')
})

test('formatUptime: exactly one hour', () => {
    assert.equal(_formatUptime(3600), '1h')
})

test('formatUptime: hours and minutes', () => {
    assert.equal(_formatUptime(3661), '1h 1m')
})

test('formatUptime: exactly one day', () => {
    assert.equal(_formatUptime(86400), '1d')
})

test('formatUptime: days and hours', () => {
    assert.equal(_formatUptime(90000), '1d 1h')
})

test('formatUptime: days only when no leftover hours', () => {
    assert.equal(_formatUptime(172800), '2d')
})

test('GET /health: returns status ok', async () => {
    const response = GET()
    const data = await response.json()
    assert.equal(data.status, 'ok')
})

test('GET /health: returns uptime as non-empty string', async () => {
    const response = GET()
    const data = await response.json()
    assert.equal(typeof data.uptime, 'string')
    assert.ok(data.uptime.length > 0)
})

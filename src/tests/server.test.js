import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatUptime, getHealth } from '../controllers/healthController.js'

test('formatUptime: minutes only', () => {
    assert.equal(formatUptime(90), '1m')
})

test('formatUptime: zero seconds', () => {
    assert.equal(formatUptime(0), '0m')
})

test('formatUptime: exactly one hour', () => {
    assert.equal(formatUptime(3600), '1h')
})

test('formatUptime: hours and minutes', () => {
    assert.equal(formatUptime(3661), '1h 1m')
})

test('formatUptime: exactly one day', () => {
    assert.equal(formatUptime(86400), '1d')
})

test('formatUptime: days and hours', () => {
    assert.equal(formatUptime(90000), '1d 1h')
})

test('formatUptime: days only when no leftover hours', () => {
    assert.equal(formatUptime(172800), '2d')
})

test('getHealth: returns status ok', () => {
    let result
    const req = {}
    const res = { json: (data) => { result = data } }
    getHealth(req, res)
    assert.equal(result.status, 'ok')
})

test('getHealth: returns uptime as non-empty string', () => {
    let result
    const req = {}
    const res = { json: (data) => { result = data } }
    getHealth(req, res)
    assert.equal(typeof result.uptime, 'string')
    assert.ok(result.uptime.length > 0)
})

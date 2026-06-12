import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import logger, { _formatStderrChunk } from '../lib/server/logger.js'

// ── _formatStderrChunk ────────────────────────────────────────────────────────

describe('_formatStderrChunk', () => {
    it('returns empty string unchanged', () => {
        assert.equal(_formatStderrChunk(''), '')
    })

    it('returns whitespace-only strings unchanged', () => {
        assert.equal(_formatStderrChunk('   \n'), '   \n')
    })

    it('returns already-formatted ISO lines unchanged', () => {
        const line = '2026-05-17T12:00:00.000Z  INFO  src/foo.js:10  hello'
        assert.equal(_formatStderrChunk(line), line)
    })

    it('prefixes unformatted lines with a timestamp and STDERR label', () => {
        const result = _formatStderrChunk('something went wrong')
        assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z  STDERR  something went wrong$/)
    })

    it('only prefixes the first line of multi-line output', () => {
        const result = _formatStderrChunk('first\nsecond')
        const lines = result.split('\n')
        assert.ok(lines[0].includes('STDERR'), 'first line should have STDERR prefix')
        assert.equal(lines[1], 'second')
    })
})

// ── Logger — basic log methods ────────────────────────────────────────────────

describe('Logger', () => {
    it('debug() does not throw', () => {
        assert.doesNotThrow(() => logger.debug('test debug message'))
    })

    it('info() does not throw', () => {
        assert.doesNotThrow(() => logger.info('test info message'))
    })

    it('warn() does not throw', () => {
        assert.doesNotThrow(() => logger.warn('test warn message'))
    })

    it('error() does not throw', () => {
        assert.doesNotThrow(() => logger.error('test error message'))
    })

    it('accepts a plain object as meta', () => {
        assert.doesNotThrow(() => logger.info('with object meta', { foo: 'bar', count: 42 }))
    })

    it('accepts an Error as meta', () => {
        assert.doesNotThrow(() => logger.info('with error meta', new Error('something broke')))
    })

    it('startup() writes a banner without throwing', () => {
        assert.doesNotThrow(() => logger.startup({ name: 'test-app', version: '1.2.3' }))
    })

    it('startup() works with no arguments', () => {
        assert.doesNotThrow(() => logger.startup())
    })

    it('startup() works with version omitted', () => {
        assert.doesNotThrow(() => logger.startup({ name: 'no-version' }))
    })
})

// ── StreamLogger ──────────────────────────────────────────────────────────────

describe('StreamLogger', () => {
    it('stream() returns an object with debug/info/warn/error methods', () => {
        const sl = logger.stream('test-stream')
        assert.equal(typeof sl.debug, 'function')
        assert.equal(typeof sl.info,  'function')
        assert.equal(typeof sl.warn,  'function')
        assert.equal(typeof sl.error, 'function')
    })

    it('stream().debug() does not throw', () => {
        assert.doesNotThrow(() => logger.stream('svc').debug('debug line'))
    })

    it('stream().info() does not throw', () => {
        assert.doesNotThrow(() => logger.stream('svc').info('info line'))
    })

    it('stream().warn() does not throw', () => {
        assert.doesNotThrow(() => logger.stream('svc').warn('warn line'))
    })

    it('stream().error() does not throw', () => {
        assert.doesNotThrow(() => logger.stream('svc').error('error line'))
    })

    it('includes the stream name in stdout output', () => {
        const captured = []
        const orig = process.stdout.write.bind(process.stdout)
        process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return orig(chunk, ...rest) }
        try {
            logger.stream('my-named-stream').info('hello')
        } finally {
            process.stdout.write = orig
        }
        assert.ok(captured.some(c => c.includes('[my-named-stream]')), 'stream name should appear in output')
    })
})

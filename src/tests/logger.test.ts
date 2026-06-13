import { describe, it, expect } from 'vitest'
import logger, { _formatStderrChunk } from '../lib/server/logger.js'

// ── _formatStderrChunk ────────────────────────────────────────────────────────

describe('_formatStderrChunk', () => {
    it('returns empty string unchanged', () => {
        expect(_formatStderrChunk('')).toBe('')
    })

    it('returns whitespace-only strings unchanged', () => {
        expect(_formatStderrChunk('   \n')).toBe('   \n')
    })

    it('returns already-formatted ISO lines unchanged', () => {
        const line = '2026-05-17T12:00:00.000Z  INFO  src/foo.js:10  hello'
        expect(_formatStderrChunk(line)).toBe(line)
    })

    it('prefixes unformatted lines with a timestamp and STDERR label', () => {
        const result = _formatStderrChunk('something went wrong')
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z  STDERR  something went wrong$/)
    })

    it('only prefixes the first line of multi-line output', () => {
        const result = _formatStderrChunk('first\nsecond')
        const lines = result.split('\n')
        expect(lines[0]).toContain('STDERR')
        expect(lines[1]).toBe('second')
    })
})

// ── Logger — basic log methods ────────────────────────────────────────────────

describe('Logger', () => {
    it('debug() does not throw', () => {
        expect(() => logger.debug('test debug message')).not.toThrow()
    })

    it('info() does not throw', () => {
        expect(() => logger.info('test info message')).not.toThrow()
    })

    it('warn() does not throw', () => {
        expect(() => logger.warn('test warn message')).not.toThrow()
    })

    it('error() does not throw', () => {
        expect(() => logger.error('test error message')).not.toThrow()
    })

    it('accepts a plain object as meta', () => {
        expect(() => logger.info('with object meta', { foo: 'bar', count: 42 })).not.toThrow()
    })

    it('accepts an Error as meta', () => {
        expect(() => logger.info('with error meta', new Error('something broke'))).not.toThrow()
    })

    it('startup() writes a banner without throwing', () => {
        expect(() => logger.startup({ name: 'test-app', version: '1.2.3' })).not.toThrow()
    })

    it('startup() works with no arguments', () => {
        expect(() => logger.startup()).not.toThrow()
    })

    it('startup() works with version omitted', () => {
        expect(() => logger.startup({ name: 'no-version' })).not.toThrow()
    })
})

// ── StreamLogger ──────────────────────────────────────────────────────────────

describe('StreamLogger', () => {
    it('stream() returns an object with debug/info/warn/error methods', () => {
        const sl = logger.stream('test-stream')
        expect(typeof sl.debug).toBe('function')
        expect(typeof sl.info).toBe('function')
        expect(typeof sl.warn).toBe('function')
        expect(typeof sl.error).toBe('function')
    })

    it('stream().debug() does not throw', () => {
        expect(() => logger.stream('svc').debug('debug line')).not.toThrow()
    })

    it('stream().info() does not throw', () => {
        expect(() => logger.stream('svc').info('info line')).not.toThrow()
    })

    it('stream().warn() does not throw', () => {
        expect(() => logger.stream('svc').warn('warn line')).not.toThrow()
    })

    it('stream().error() does not throw', () => {
        expect(() => logger.stream('svc').error('error line')).not.toThrow()
    })

    it('includes the stream name in stdout output', () => {
        const captured: string[] = []
        const orig = process.stdout.write.bind(process.stdout)
        process.stdout.write = (chunk: any, ...rest: any[]) => { captured.push(String(chunk)); return orig(chunk, ...rest) }
        try {
            logger.stream('my-named-stream').info('hello')
        } finally {
            process.stdout.write = orig
        }
        expect(captured.some(c => c.includes('[my-named-stream]'))).toBe(true)
    })
})

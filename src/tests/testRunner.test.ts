import { describe, it, beforeEach, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

vi.mock('node:child_process', () => {
    const spawn = vi.fn()
    return { spawn, default: { spawn } }
})

import { spawn } from 'node:child_process'
import { runTests, isRunning, getResults } from '../lib/server/services/testRunner.js'

const spawnMock = vi.mocked(spawn)

const ROOT        = process.cwd()
const coverageDir = path.join(ROOT, 'coverage')
const summaryFile = path.join(coverageDir, 'coverage-summary.json')

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Extracts the --outputFile= path the runner asked vitest to write. */
function outputFileFromArgs(args: readonly string[]): string | undefined {
    return args.find(a => a.startsWith('--outputFile='))?.slice('--outputFile='.length)
}

/**
 * Configure the spawn mock to behave like a vitest process: optionally write the
 * JSON result file the runner expects, then emit close (or error).
 */
function mockVitestProcess(opts: {
    resultJson?: unknown          // object → JSON.stringify; string → written raw
    writeResult?: boolean         // default true when resultJson given
    exitCode?: number
    error?: Error
} = {}) {
    spawnMock.mockImplementation(((_cmd: string, args: string[]) => {
        const proc = new EventEmitter()
        void (async () => {
            await wait(5) // let the runner attach listeners
            if (opts.error) { proc.emit('error', opts.error); return }
            if (opts.resultJson !== undefined) {
                const resultFile = outputFileFromArgs(args)
                if (resultFile) {
                    const body = typeof opts.resultJson === 'string'
                        ? opts.resultJson
                        : JSON.stringify(opts.resultJson)
                    await fsp.writeFile(resultFile, body)
                }
            }
            proc.emit('close', opts.exitCode ?? 0)
        })()
        return proc
    }) as unknown as typeof spawn)
}

/** Temporarily replace coverage/coverage-summary.json, restoring any real one after. */
async function withCoverageSummary<T>(json: unknown, fn: () => Promise<T>): Promise<T> {
    const existing = await fsp.readFile(summaryFile, 'utf8').catch(() => null)
    await fsp.mkdir(coverageDir, { recursive: true })
    await fsp.writeFile(summaryFile, JSON.stringify(json))
    try {
        return await fn()
    } finally {
        if (existing !== null) await fsp.writeFile(summaryFile, existing)
        else await fsp.unlink(summaryFile).catch(() => {})
    }
}

const EMPTY_RESULT = { numPassedTests: 0, numFailedTests: 0, numTotalTests: 0, testResults: [] }

describe('testRunner', () => {
    beforeEach(() => {
        spawnMock.mockReset()
    })

    // NOTE: testRunner keeps module-level singleton state (_running, _lastResults),
    // so test order inside this file matters — the "before any run" assertions come first.
    describe('initial state', () => {
        it('getResults() is null and isRunning() is false before any run', () => {
            expect(getResults()).toBeNull()
            expect(isRunning()).toBe(false)
        })
    })

    describe('spawn argument construction', () => {
        it('spawns node with the vitest bin, json reporter, tmp output file and coverage flags', async () => {
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            await runTests()

            expect(spawnMock).toHaveBeenCalledTimes(1)
            const [cmd, args, options] = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]

            expect(cmd).toBe(process.execPath)
            expect(args[0]).toBe('node_modules/.bin/vitest')
            expect(args[1]).toBe('run')
            expect(args).toContain('--reporter=json')
            expect(args).toContain('--coverage')
            expect(args).toContain('--coverage.reporter=json-summary')

            const outFile = outputFileFromArgs(args)
            expect(outFile).toBeTruthy()
            expect(outFile!.startsWith(os.tmpdir())).toBe(true)
            expect(outFile).toMatch(/vitest-results-\d+\.json$/)

            expect(options).toMatchObject({ cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
        })

        it('deletes the tmp result file after the run', async () => {
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            await runTests()
            const args    = spawnMock.mock.calls[0][1] as unknown as string[]
            const outFile = outputFileFromArgs(args)!
            await wait(100) // unlink is fire-and-forget in the finally block
            await expect(fsp.access(outFile)).rejects.toThrow()
        })
    })

    describe('output parsing', () => {
        it('parses summary counts, suites, failures and durations from vitest JSON', async () => {
            mockVitestProcess({ resultJson: {
                numPassedTests: 2, numFailedTests: 1, numTotalTests: 3,
                testResults: [{
                    name: `${ROOT}/src/tests/journalService.test.ts`,
                    startTime: 1_000, endTime: 1_450,
                    assertionResults: [
                        { ancestorTitles: ['JournalService'], title: 'creates a page', status: 'passed', duration: 7 },
                        { ancestorTitles: ['JournalService'], title: 'updates a page', status: 'passed', duration: 3 },
                        { ancestorTitles: ['JournalService'], title: 'explodes',       status: 'failed', duration: 2,
                          failureMessages: ['AssertionError: boom'] },
                    ],
                }],
            } })

            const result = await runTests()

            expect(result.summary).toEqual({ pass: 2, fail: 1, total: 3, duration: 450 })
            expect(result.suites.length).toBe(1)
            const suite = result.suites[0]
            expect(suite.name).toBe('JournalService')
            expect(suite.pass).toBe(2)
            expect(suite.fail).toBe(1)
            expect(suite.tests[2]).toEqual({ name: 'explodes', pass: false, duration: 2, error: 'AssertionError: boom' })
            expect(suite.tests[0].error).toBeNull()

            expect(result.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
            expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
            expect(getResults()).toBe(result)
        })

        it('falls back to the file basename when an assertion has no ancestorTitles', async () => {
            mockVitestProcess({ resultJson: {
                numPassedTests: 1, numFailedTests: 0, numTotalTests: 1,
                testResults: [{
                    name: `${ROOT}/src/tests/loose.test.ts`,
                    startTime: 0, endTime: 0,
                    assertionResults: [{ title: 'top-level test', status: 'passed' }],
                }],
            } })
            const result = await runTests()
            expect(result.suites[0].name).toBe('loose.test.ts')
        })

        it('contract: suites with the same top-level describe name in DIFFERENT files are merged into one', async () => {
            mockVitestProcess({ resultJson: {
                numPassedTests: 2, numFailedTests: 0, numTotalTests: 2,
                testResults: [
                    {
                        name: `${ROOT}/src/tests/a.test.ts`, startTime: 0, endTime: 0,
                        assertionResults: [{ ancestorTitles: ['Shared'], title: 'from a', status: 'passed' }],
                    },
                    {
                        name: `${ROOT}/src/tests/b.test.ts`, startTime: 0, endTime: 0,
                        assertionResults: [{ ancestorTitles: ['Shared'], title: 'from b', status: 'passed' }],
                    },
                ],
            } })
            const result = await runTests()
            expect(result.suites.length).toBe(1)
            expect(result.suites[0].tests.map((t: { name: string }) => t.name)).toEqual(['from a', 'from b'])
        })

        it('resolves with zeroed summary when the process never writes a result file', async () => {
            mockVitestProcess({}) // close(0) without writing
            const result = await runTests()
            expect(result.summary).toEqual({ pass: 0, fail: 0, total: 0, duration: 0 })
            expect(result.suites).toEqual([])
        })

        it('contract: a nonzero exit code is ignored — results are still parsed', async () => {
            mockVitestProcess({ resultJson: {
                numPassedTests: 0, numFailedTests: 1, numTotalTests: 1,
                testResults: [{
                    name: `${ROOT}/src/tests/x.test.ts`, startTime: 0, endTime: 0,
                    assertionResults: [{ ancestorTitles: ['X'], title: 'f', status: 'failed', failureMessages: ['e'] }],
                }],
            }, exitCode: 1 })
            const result = await runTests()
            expect(result.summary.fail).toBe(1)
        })

        it('contract: garbage (non-JSON) in the result file rejects the run but the guard recovers', async () => {
            mockVitestProcess({ resultJson: 'this is not json {{{' })
            await expect(runTests()).rejects.toThrow()
            expect(isRunning()).toBe(false)

            // Subsequent run works
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            await expect(runTests()).resolves.toBeTruthy()
        })
    })

    describe('error handling', () => {
        it('rejects when the process emits an error, and resets the running guard', async () => {
            mockVitestProcess({ error: new Error('spawn ENOENT') })
            await expect(runTests()).rejects.toThrow('spawn ENOENT')
            expect(isRunning()).toBe(false)
        })

        // NOTE: there is no timeout logic in testRunner.js — a vitest process that
        // never exits would hang runTests() forever. Nothing to assert; documented here.
    })

    describe('concurrent-run guard', () => {
        it('a second runTests() rejects while the first is in flight, then the guard clears', async () => {
            let release!: () => void
            spawnMock.mockImplementation((() => {
                const proc = new EventEmitter()
                release = () => proc.emit('close', 0)
                return proc
            }) as unknown as typeof spawn)

            const first = runTests()
            expect(isRunning()).toBe(true)
            await expect(runTests()).rejects.toThrow(/already running/)
            expect(spawnMock).toHaveBeenCalledTimes(1) // second call never spawned

            release()
            await first
            expect(isRunning()).toBe(false)

            // and a fresh run is allowed again
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            await expect(runTests()).resolves.toBeTruthy()
        })
    })

    describe('coverage parsing', () => {
        const posixRoot = ROOT.replace(/\\/g, '/')

        it('relativizes forward-slash keys, filters non-source files, and averages percentages', async () => {
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            const result = await withCoverageSummary({
                total: { lines: { pct: 80 }, branches: { pct: 70 }, functions: { pct: 90 } },
                [`${posixRoot}/src/lib/utils.ts`]:      { lines: { pct: 50 },  branches: { pct: 40 },  functions: { pct: 60 } },
                [`${posixRoot}/src/lib/other.ts`]:      { lines: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 } },
                [`${posixRoot}/src/lib/utils.test.ts`]: { lines: { pct: 10 },  branches: { pct: 10 },  functions: { pct: 10 } },
                [`${posixRoot}/src/lib/helpers.js`]:    { lines: { pct: 10 },  branches: { pct: 10 },  functions: { pct: 10 } },
                [`${posixRoot}/scripts/tool.js`]:       { lines: { pct: 10 },  branches: { pct: 10 },  functions: { pct: 10 } },
            }, () => runTests())

            const files = result.coverage.files.map((f: { file: string }) => f.file).sort()
            expect(files).toEqual(['src/lib/other.ts', 'src/lib/utils.ts'])
            expect(result.coverage.lines).toBe(75)     // avg(50, 100)
            expect(result.coverage.branches).toBe(70)  // avg(40, 100)
            expect(result.coverage.funcs).toBe(80)     // avg(60, 100)
        })

        it('coverage is null-safe when the summary file is missing', async () => {
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            // Point at a coverage summary that does not exist by removing it if present
            const existing = await fsp.readFile(summaryFile, 'utf8').catch(() => null)
            if (existing !== null) await fsp.unlink(summaryFile)
            try {
                const result = await runTests()
                expect(result.coverage).toEqual({ files: [], lines: null, branches: null, funcs: null })
            } finally {
                if (existing !== null) {
                    await fsp.mkdir(coverageDir, { recursive: true })
                    await fsp.writeFile(summaryFile, existing)
                }
            }
        })

        // REGRESSION: testRunner.js once compared keys with key.startsWith(ROOT.replace(/\\/g,'/')),
        // which never matched the backslash-separated absolute paths v8's json-summary emits
        // on Windows, so files were not relativized, isSourceFile() rejected them all, and
        // every coverage percentage collapsed to null there. Now Windows keys are recognized.
        it('recognizes Windows backslash-separated coverage keys as source files', async () => {
            mockVitestProcess({ resultJson: EMPTY_RESULT })
            const winKey = `${ROOT}${path.sep}src${path.sep}lib${path.sep}winpath.ts`.replace(/\//g, '\\')
            const result = await withCoverageSummary({
                total: { lines: { pct: 42 }, branches: { pct: 42 }, functions: { pct: 42 } },
                [winKey]: { lines: { pct: 42 }, branches: { pct: 42 }, functions: { pct: 42 } },
            }, () => runTests())
            expect(result.coverage.files.map((f: { file: string }) => f.file)).toContain('src/lib/winpath.ts')
        })
    })

    describe('component grouping', () => {
        const resultJson = {
            numPassedTests: 3, numFailedTests: 1, numTotalTests: 4,
            testResults: [
                {
                    name: `${ROOT}/src/tests/journalService.test.ts`, startTime: 0, endTime: 0,
                    assertionResults: [
                        { ancestorTitles: ['JournalService'], title: 'a', status: 'passed' },
                        { ancestorTitles: ['JournalService'], title: 'b', status: 'failed', failureMessages: ['x'] },
                    ],
                },
                {
                    name: `${ROOT}/src/tests/calendar.test.ts`, startTime: 0, endTime: 0,
                    assertionResults: [{ ancestorTitles: ['Calendar'], title: 'c', status: 'passed' }],
                },
                {
                    name: `${ROOT}/src/tests/mystery.test.ts`, startTime: 0, endTime: 0,
                    assertionResults: [{ ancestorTitles: ['Mystery'], title: 'd', status: 'passed' }],
                },
            ],
        }

        it('maps files to their groups and counts pass/fail per component', async () => {
            mockVitestProcess({ resultJson })
            const result: any = await runTests()

            expect(Object.keys(result.components).sort()).toEqual(['server', 'services', 'utils'])
            expect(result.components.services.summary).toEqual({ pass: 1, fail: 1, total: 2, duration: 0 })
            expect(result.components.services.suites.map((s: { name: string }) => s.name)).toEqual(['JournalService'])
            expect(result.components.utils.summary).toEqual({ pass: 1, fail: 0, total: 1, duration: 0 })
            expect(result.components.server.summary).toEqual({ pass: 0, fail: 0, total: 0, duration: 0 })
        })

        it('contract: suites from unrecognized files land in no component (only in the flat suites list)', async () => {
            mockVitestProcess({ resultJson })
            const result: any = await runTests()
            const componentSuiteNames = Object.values(result.components as Record<string, { suites: { name: string }[] }>)
                .flatMap(c => c.suites.map(s => s.name))
            expect(componentSuiteNames).not.toContain('Mystery')
            expect(result.suites.map((s: { name: string }) => s.name)).toContain('Mystery')
        })

        it('contract: every component reports the SAME overall source coverage (not group-scoped)', async () => {
            mockVitestProcess({ resultJson })
            const posixRoot = ROOT.replace(/\\/g, '/')
            const result: any = await withCoverageSummary({
                total: { lines: { pct: 50 }, branches: { pct: 50 }, functions: { pct: 50 } },
                [`${posixRoot}/src/lib/utils.ts`]: { lines: { pct: 50 }, branches: { pct: 50 }, functions: { pct: 50 } },
            }, () => runTests())

            expect(result.components.utils.coverage).toEqual(result.components.services.coverage)
            expect(result.components.utils.coverage).toEqual(result.components.server.coverage)
            expect(result.components.utils.coverage.files.length).toBe(1)
        })
    })
})

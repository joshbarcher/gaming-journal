import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const ROOT = process.cwd()

// ── Shared state (singleton per server process) ───────────────────────────────

let _running     = false
let _lastResults = null

export const isRunning  = () => _running
export const getResults = () => _lastResults

// ── Test grouping ─────────────────────────────────────────────────────────────

const TEST_GROUPS = {
    utils:    { label: 'Utilities', names: new Set(['calendar', 'utils', 'progressHelpers', 'pageHelpers']) },
    services: { label: 'Services',  names: new Set(['journalService', 'localWishlist', 'managedFile']) },
    server:   { label: 'Server',    names: new Set(['server', 'logger']) },
}

function groupForFile(filePath) {
    const stem = path.basename(filePath).replace(/\.test\.[jt]s$/, '')
    for (const [key, { names }] of Object.entries(TEST_GROUPS)) {
        if (names.has(stem)) return key
    }
    return 'other'
}

// ── Vitest JSON parser ────────────────────────────────────────────────────────

function parseVitestJson(json) {
    const suiteMap = new Map()   // suiteName → { name, tests, pass, fail }
    const summary  = {
        pass:     json.numPassedTests  ?? 0,
        fail:     json.numFailedTests  ?? 0,
        total:    json.numTotalTests   ?? 0,
        duration: json.testResults
            ? json.testResults.reduce((s, r) => s + ((r.endTime ?? 0) - (r.startTime ?? 0)), 0)
            : 0,
    }

    for (const fileResult of json.testResults ?? []) {
        for (const assertion of fileResult.assertionResults ?? []) {
            const suiteName = assertion.ancestorTitles?.[0] ?? path.basename(fileResult.name)
            if (!suiteMap.has(suiteName)) {
                suiteMap.set(suiteName, { name: suiteName, tests: [], pass: 0, fail: 0 })
            }
            const suite  = suiteMap.get(suiteName)
            const passed = assertion.status === 'passed'
            suite.tests.push({
                name:     assertion.title,
                pass:     passed,
                duration: assertion.duration ?? 0,
                error:    !passed ? (assertion.failureMessages?.[0] ?? null) : null,
            })
            if (passed) suite.pass++; else suite.fail++
        }
    }

    return { summary, suites: [...suiteMap.values()] }
}

// ── Coverage parser (v8 json-summary format) ──────────────────────────────────

function parseCoverageSummary(json) {
    const files   = []
    const total   = json.total ?? {}

    for (const [key, val] of Object.entries(json)) {
        if (key === 'total') continue
        const rel = key.startsWith(ROOT.replace(/\\/g, '/'))
            ? key.slice(ROOT.replace(/\\/g, '/').length + 1)
            : key
        files.push({
            file:     rel,
            lines:    val.lines?.pct     ?? null,
            branches: val.branches?.pct  ?? null,
            funcs:    val.functions?.pct ?? null,
            uncovered: [],
        })
    }

    return {
        lines:    total.lines?.pct     ?? null,
        branches: total.branches?.pct  ?? null,
        funcs:    total.functions?.pct ?? null,
        files,
    }
}

// ── Runner ────────────────────────────────────────────────────────────────────

function isSourceFile(filePath) {
    const norm = filePath.replace(/\\/g, '/')
    if (!norm.startsWith('src/'))          return false
    if (norm.includes('node_modules'))     return false
    if (norm.match(/\.test\.[jt]s$/))      return false
    if (path.basename(norm) === 'helpers.js') return false
    return true
}

function recalcSummary(coverage) {
    const files = coverage.files ?? []
    if (!files.length) return { ...coverage, lines: null, branches: null, funcs: null }
    const avg = key => +(files.reduce((s, f) => s + (f[key] ?? 0), 0) / files.length).toFixed(2)
    return { ...coverage, lines: avg('lines'), branches: avg('branches'), funcs: avg('funcs') }
}

export async function runTests() {
    if (_running) throw new Error('Tests already running')
    _running = true

    const resultFile   = path.join(os.tmpdir(), `vitest-results-${Date.now()}.json`)
    const coverageDir  = path.join(ROOT, 'coverage')
    const summaryFile  = path.join(coverageDir, 'coverage-summary.json')

    try {
        const startedAt = Date.now()

        await new Promise((resolve, reject) => {
            const proc = spawn(
                process.execPath,
                [
                    'node_modules/.bin/vitest',
                    'run',
                    '--reporter=json',
                    `--outputFile=${resultFile}`,
                    '--coverage',
                    '--coverage.reporter=json-summary',
                ],
                { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
            )
            proc.on('close', () => resolve())
            proc.on('error', reject)
        })

        // Read test results
        const resultJson  = JSON.parse(await fsp.readFile(resultFile, 'utf8').catch(() => '{}'))
        const { summary, suites } = parseVitestJson(resultJson)

        // Read coverage summary
        let allCoverage = { lines: null, branches: null, funcs: null, files: [] }
        try {
            const covJson = JSON.parse(await fsp.readFile(summaryFile, 'utf8'))
            allCoverage = parseCoverageSummary(covJson)
        } catch { /* coverage unavailable */ }

        // Build per-component views
        const components = {}
        const groupMap = {}

        for (const suite of suites) {
            // Find which file owns this suite by cross-referencing testResults
            const fileResult = (resultJson.testResults ?? []).find(r =>
                r.assertionResults?.some(a => a.ancestorTitles?.[0] === suite.name || a.title === suite.name)
            )
            const key = fileResult ? groupForFile(fileResult.name) : 'other'
            ;(groupMap[key] ??= []).push(suite)
        }

        for (const [key, meta] of Object.entries(TEST_GROUPS)) {
            const groupSuites = groupMap[key] ?? []
            const pass  = groupSuites.reduce((s, g) => s + g.pass,  0)
            const fail  = groupSuites.reduce((s, g) => s + g.fail,  0)
            const total = pass + fail

            const ownFiles = (allCoverage.files ?? []).filter(f => isSourceFile(f.file))
            const ownCov   = recalcSummary({ ...allCoverage, files: ownFiles })

            components[key] = {
                label:    meta.label,
                summary:  { pass, fail, total, duration: 0 },
                suites:   groupSuites,
                coverage: ownCov,
            }
        }

        const sourceCovFiles = (allCoverage.files ?? []).filter(f => isSourceFile(f.file))
        const combinedCoverage = recalcSummary({ files: sourceCovFiles })

        _lastResults = {
            summary,
            suites,
            coverage:  combinedCoverage,
            components,
            ranAt:     new Date().toISOString(),
            elapsedMs: Date.now() - startedAt,
        }
        return _lastResults
    } finally {
        _running = false
        fsp.unlink(resultFile).catch(() => {})
    }
}

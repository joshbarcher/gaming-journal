import { spawn }          from 'node:child_process'
import fsp               from 'node:fs/promises'
import path              from 'node:path'

const ROOT     = process.cwd()
const TEST_DIR = path.join(ROOT, 'src', 'tests')

const COVERAGE_FLAG = '--experimental-test-coverage'

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

function groupForFile(filename) {
    const stem = filename.replace('.test.js', '')
    for (const [key, { names }] of Object.entries(TEST_GROUPS)) {
        if (names.has(stem)) return key
    }
    return 'other'
}

// ── Coverage parser (Node 22+ hierarchical TAP format) ────────────────────────

function parseCoverage(lines) {
    const files   = []
    const summary = { lines: null, branches: null, funcs: null }
    const stack   = []   // path components indexed by depth
    let inCoverage = false

    for (const line of lines) {
        if (line.includes('start of coverage report')) { inCoverage = true;  continue }
        if (line.includes('end of coverage report'))   { inCoverage = false; continue }
        if (!inCoverage || !line.startsWith('#'))      continue

        // Strip "# " prefix (always 2 chars)
        const content = line.length > 2 ? line.slice(2) : ''
        if (!content.includes('|')) continue
        if (content.trimStart().startsWith('-')) continue   // separator line

        const pipeIdx = content.indexOf('|')
        const namePart = content.slice(0, pipeIdx)
        const dataPart = content.slice(pipeIdx + 1)

        // depth = number of leading spaces in the name segment
        const depth = namePart.search(/\S/)
        if (depth === -1) continue

        const name = namePart.trim()
        if (!name || name === 'file') continue   // header row

        // Parse the 3 pct columns + uncovered lines
        const cols      = dataPart.split('|').map(s => s.trim())
        const linePct   = cols[0] !== '' ? +cols[0] : null
        const branchPct = cols[1] !== '' ? +cols[1] : null
        const funcPct   = cols[2] !== '' ? +cols[2] : null
        const uncovered = (cols[3] ?? '').trim().split(/[\s,]+/).filter(Boolean)

        if (name === 'all files') {
            if (linePct !== null) {
                summary.lines    = linePct
                summary.branches = branchPct
                summary.funcs    = funcPct
            }
            continue
        }

        // Update path stack to current depth, then push this component
        stack.length    = depth
        stack[depth]    = name

        // Leaf file — has actual coverage numbers
        if (linePct !== null) {
            files.push({
                file:     stack.slice(0, depth + 1).join('/'),
                lines:    linePct,
                branches: branchPct,
                funcs:    funcPct,
                uncovered,
            })
        }
    }

    return { ...summary, files }
}

// ── TAP parser ────────────────────────────────────────────────────────────────

function parseTAP(raw) {
    const lines   = raw.split('\n')
    const suites  = []
    const summary = { pass: 0, fail: 0, total: 0, duration: 0 }

    let currentSuite   = null
    let inError        = false
    let lastTestFailed = false

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Root-level suite header: no leading whitespace before "# Subtest:"
        const suiteMatch = line.match(/^# Subtest: (.+)$/)
        if (suiteMatch) {
            currentSuite = { name: suiteMatch[1], tests: [], pass: 0, fail: 0 }
            suites.push(currentSuite)
            continue
        }

        // Individual test pass — must be indented (inner ok lines)
        const passMatch = line.match(/^\s+ok \d+ - (.+)$/)
        if (passMatch && currentSuite) {
            let duration = 0
            if (lines[i + 1]?.includes('---')) {
                for (let j = i + 2; j < Math.min(i + 10, lines.length); j++) {
                    const d = lines[j].match(/duration_ms:\s*([\d.]+)/)
                    if (d) { duration = +d[1]; break }
                    if (lines[j].includes('...')) break
                }
            }
            currentSuite.tests.push({ name: passMatch[1], pass: true, duration })
            currentSuite.pass++
            summary.pass++
            summary.total++
            lastTestFailed = false
            inError        = false
            continue
        }

        // Individual test fail — must be indented
        const failMatch = line.match(/^\s+not ok \d+ - (.+)$/)
        if (failMatch && currentSuite) {
            currentSuite.tests.push({ name: failMatch[1], pass: false, duration: 0, error: null })
            currentSuite.fail++
            summary.fail++
            summary.total++
            lastTestFailed = true
            inError        = true
            continue
        }

        // Capture error message from YAML block after a failing test
        if (inError && lastTestFailed && currentSuite) {
            const msgMatch = line.match(/^\s+message:\s*'(.+)'$/)
            if (msgMatch) {
                const last = currentSuite.tests.at(-1)
                if (last && !last.pass) {
                    last.error = msgMatch[1].replace(/\\n/g, '\n').replace(/\\'/g, "'")
                }
            }
            if (line.trim() === '...') inError = false
        }

        // Root-level ok/not ok — top-level test() (no describe wrapper)
        // These appear as "# Subtest: name" followed immediately by "ok N - name"
        // with no inner indented tests.
        const rootOkMatch  = line.match(/^ok \d+ - (.+)$/)
        const rootFailMatch = line.match(/^not ok \d+ - (.+)$/)
        if ((rootOkMatch || rootFailMatch) && currentSuite && currentSuite.tests.length === 0 && currentSuite.name === (rootOkMatch ?? rootFailMatch)[1]) {
            const pass = !!rootOkMatch
            let duration = 0
            if (lines[i + 1]?.includes('---')) {
                for (let j = i + 2; j < Math.min(i + 10, lines.length); j++) {
                    const d = lines[j].match(/duration_ms:\s*([\d.]+)/)
                    if (d) { duration = +d[1]; break }
                    if (lines[j].includes('...')) break
                }
            }
            currentSuite.tests.push({ name: currentSuite.name, pass, duration })
            if (pass) { currentSuite.pass++; summary.pass++ } else { currentSuite.fail++; summary.fail++ }
            summary.total++
            currentSuite = null
            continue
        }

        // Overall duration from diagnostic lines
        const durMatch = line.match(/^# duration_ms\s+([\d.]+)$/)
        if (durMatch) summary.duration = +durMatch[1]
    }

    return { summary, suites, coverage: parseCoverage(lines) }
}

// ── Source file predicate ─────────────────────────────────────────────────────

function isSourceFile(filePath) {
    if (!filePath.startsWith('src/'))              return false
    if (filePath.includes('node_modules'))         return false
    if (filePath.endsWith('.test.js'))             return false
    if (path.basename(filePath) === 'helpers.js')  return false
    return true
}

function recalcSummary(coverage) {
    const files = coverage.files ?? []
    if (!files.length) return { ...coverage, lines: null, branches: null, funcs: null }
    const avg = key => +(files.reduce((s, f) => s + (f[key] ?? 0), 0) / files.length).toFixed(2)
    return { ...coverage, lines: avg('lines'), branches: avg('branches'), funcs: avg('funcs') }
}

// ── Per-group runner ──────────────────────────────────────────────────────────

async function runGroup(testFiles) {
    if (!testFiles.length) return {
        summary:  { pass: 0, fail: 0, total: 0, duration: 0 },
        suites:   [],
        coverage: { lines: null, branches: null, funcs: null, files: [] },
    }

    const { stdout } = await new Promise(resolve => {
        const chunks = []
        const proc   = spawn(process.execPath, [
            '--test',
            COVERAGE_FLAG,
            '--test-reporter=tap',
            ...testFiles,
        ], { cwd: ROOT })
        proc.stdout.on('data', d  => chunks.push(d))
        proc.stderr.on('data', d  => chunks.push(d))
        proc.on('close',  ()      => resolve({ stdout: Buffer.concat(chunks).toString('utf8') }))
        proc.on('error', err      => resolve({ stdout: '', spawnError: err.message }))
    })

    return parseTAP(stdout)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runTests() {
    if (_running) throw new Error('Tests already running')
    _running = true

    try {
        const allFiles = (await fsp.readdir(TEST_DIR))
            .filter(f => f.endsWith('.test.js'))
            .map(f => ({ name: f, abs: path.join(TEST_DIR, f) }))

        if (!allFiles.length) {
            _lastResults = { error: 'No test files found', summary: {}, components: {}, suites: [], coverage: {} }
            return _lastResults
        }

        // Group files by domain
        const groups = {}
        for (const { name, abs } of allFiles) {
            const key = groupForFile(name)
            ;(groups[key] ??= []).push(abs)
        }

        const startedAt   = Date.now()
        const groupKeys   = Object.keys(groups)
        const groupResults = await Promise.all(groupKeys.map(k => runGroup(groups[k])))

        const components = {}
        const totals     = { pass: 0, fail: 0, total: 0 }

        for (let i = 0; i < groupKeys.length; i++) {
            const key    = groupKeys[i]
            const result = groupResults[i]
            const meta   = TEST_GROUPS[key] ?? { label: key }

            const ownFiles = (result.coverage.files ?? []).filter(f => isSourceFile(f.file))
            const ownCov   = recalcSummary({ ...result.coverage, files: ownFiles })

            components[key] = {
                label:    meta.label ?? key,
                summary:  result.summary,
                suites:   result.suites,
                coverage: ownCov,
            }

            totals.pass  += result.summary.pass  ?? 0
            totals.fail  += result.summary.fail  ?? 0
            totals.total += result.summary.total ?? 0
        }

        // Combined "all" view — deduplicate by keeping the highest-coverage entry per file
        const allSuites = groupResults.flatMap(r => r.suites)
        const best = new Map()
        for (const r of groupResults) {
            for (const f of r.coverage.files ?? []) {
                if (!isSourceFile(f.file)) continue
                const existing = best.get(f.file)
                if (!existing || f.lines > existing.lines) best.set(f.file, f)
            }
        }
        const combinedCoverage = recalcSummary({ files: [...best.values()] })

        _lastResults = {
            summary:   totals,
            suites:    allSuites,
            coverage:  combinedCoverage,
            components,
            ranAt:     new Date().toISOString(),
            elapsedMs: Date.now() - startedAt,
        }
        return _lastResults
    } finally {
        _running = false
    }
}

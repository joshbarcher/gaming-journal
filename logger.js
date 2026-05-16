import { relative, dirname }  from 'node:path'
import { fileURLToPath }       from 'node:url'

// ── Constants ─────────────────────────────────────────────────────────────────

const CALLER_WIDTH = 40
const STARTUP_BAR  = '━'.repeat(54)

const LABELS = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }

const _ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/

const MAIN_DEPTH         = 3
const STREAM_DEPTH       = 4
const STREAM_ERROR_DEPTH = 3

const LOGGER_DIR = dirname(fileURLToPath(import.meta.url))

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveCaller(depth) {
  const lines = new Error().stack.split('\n')
  const raw   = lines[depth] ?? ''
  const m = raw.match(/\((.+):(\d+):\d+\)/) ?? raw.match(/at (.+):(\d+):\d+/)
  if (!m) return 'unknown'
  let abs = m[1]
  if (abs.startsWith('file://')) { try { abs = fileURLToPath(abs) } catch { /* keep as-is */ } }
  const fromCwd    = relative(process.cwd(), abs)
  const fromLogger = relative(LOGGER_DIR, abs)
  const candidates = [fromCwd, fromLogger].filter(p => p.length > 0 && !p.startsWith('..'))
  const best = candidates.sort((a, b) => a.length - b.length)[0]
  return `${best ?? abs}:${m[2]}`
}

function padCaller(str) {
  if (str.length > CALLER_WIDTH) return '…' + str.slice(-(CALLER_WIDTH - 1))
  return str.padEnd(CALLER_WIDTH)
}

function formatMeta(meta) {
  if (meta == null)             return ''
  if (meta instanceof Error)    return '\n  ' + (meta.stack ?? meta.message)
  if (typeof meta === 'object') { try { return ' ' + JSON.stringify(meta) } catch { return ' [object]' } }
  return ' ' + String(meta)
}

function formatLine(label, caller, message, meta) {
  return `${new Date().toISOString()}  ${label}  ${padCaller(caller)}  ${message}${formatMeta(meta)}`
}

// ── Logger ────────────────────────────────────────────────────────────────────

class Logger {
  debug(msg, meta) { process.stdout.write(formatLine(LABELS.debug, resolveCaller(MAIN_DEPTH), msg, meta) + '\n') }
  info(msg, meta)  { process.stdout.write(formatLine(LABELS.info,  resolveCaller(MAIN_DEPTH), msg, meta) + '\n') }
  warn(msg, meta)  { process.stdout.write(formatLine(LABELS.warn,  resolveCaller(MAIN_DEPTH), msg, meta) + '\n') }
  error(msg, meta) { process.stderr.write(formatLine(LABELS.error, resolveCaller(MAIN_DEPTH), msg, meta) + '\n') }

  startup({ name = 'app', version = null } = {}) {
    const ts    = new Date().toISOString()
    const parts = [`name=${name}`]
    if (version) parts.push(`version=${version}`)
    parts.push(`pid=${process.pid}`, `node=${process.version}`)
    process.stdout.write(`${ts}  ${STARTUP_BAR}\n`)
    process.stdout.write(`${ts}  START  ${parts.join('  ')}\n`)
    process.stdout.write(`${ts}  ${STARTUP_BAR}\n`)
  }

  stream(name) { return new StreamLogger(name) }
}

// ── StreamLogger ──────────────────────────────────────────────────────────────

class StreamLogger {
  #name
  constructor(name) { this.#name = name }

  #stdout(label, msg, meta) {
    process.stdout.write(formatLine(label, resolveCaller(STREAM_DEPTH), `[${this.#name}] ${msg}`, meta) + '\n')
  }

  debug(msg, meta) { this.#stdout(LABELS.debug, msg, meta) }
  info (msg, meta) { this.#stdout(LABELS.info,  msg, meta) }
  warn (msg, meta) { this.#stdout(LABELS.warn,  msg, meta) }
  error(msg, meta) {
    process.stderr.write(formatLine(LABELS.error, resolveCaller(STREAM_ERROR_DEPTH), `[${this.#name}] ${msg}`, meta) + '\n')
  }
}

// ── Stderr intercept ──────────────────────────────────────────────────────────

export function _formatStderrChunk(str) {
  if (!str.trim()) return str
  if (_ISO_RE.test(str)) return str
  const ts = new Date().toISOString()
  return str.replace(/^([^\n]*)/, `${ts}  STDERR  $1`)
}

const _stderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = function stderrCapture(chunk, encoding, callback) {
  if (typeof encoding === 'function') { callback = encoding; encoding = undefined }
  const str = Buffer.isBuffer(chunk) ? chunk.toString(encoding ?? 'utf8') : String(chunk)
  return _stderrWrite(_formatStderrChunk(str), undefined, callback)
}

// ── Export ────────────────────────────────────────────────────────────────────

export default new Logger()

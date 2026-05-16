import fsp from "fs/promises";
import path from "path";

export class ManagedFile {

    constructor(options) {
        if (!options?.filePath)                        throw new Error("ManagedFile: filePath is required");
        if (!options?.name)                            throw new Error("ManagedFile: name is required");
        if (typeof options?.defaultValue !== "function") throw new Error("ManagedFile: defaultValue must be a factory function");

        this._filePath = options.filePath;
        this._name     = options.name;

        this._parse     = options.parse     ?? ((str)   => JSON.parse(str));
        this._serialize = options.serialize ?? ((value) => JSON.stringify(value, null, 4));
        this._defaultValue = options.defaultValue;

        this._audit        = options.audit        ?? null;
        this._auditMetrics = options.auditMetrics ?? null;
        this._quarantineKeep = options.quarantineKeep ?? 10;

        this._maxFlushIntervalMs = options.maxFlushIntervalMs ?? 60_000;
        this._retryDelays        = options.retryDelays        ?? [50, 100, 200, 400, 800, 1200];

        this._enableCheckpoint = options.enableCheckpoint ?? true;

        this._backupDir        = options.backupDir        ?? null;
        this._backupIntervalMs = options.backupIntervalMs ?? 6 * 60 * 60 * 1000;
        this._backupKeep       = options.backupKeep       ?? 30;

        this._logFn = options.log ?? this._defaultLogFn.bind(this);

        this._value       = null;
        this._loaded      = false;
        this._loadPromise = null;

        this._createdAt          = Date.now();
        this._dirty              = false;
        this._flushTimer         = null;
        this._nextFlushAt        = 0;
        this._lastFlushedAt      = 0;
        this._lastBackupAt       = 0;
        this._prevMetrics        = null;
        this._writeChain         = Promise.resolve();
        this._pendingCheckpoint  = null;
        this._pendingBackup      = null;

        this._s = {
            loadedAt:            null,
            loadSource:          null,
            recoveryUsedOnLoad:  false,
            writeCount:          0,
            auditViolationCount: 0,
            lastBackupAt:        null,
            backupCount:         0,
        };
    }

    _defaultLogFn(level, msg, meta) {
        const text = `[ManagedFile ${this._name}] ${msg}`;
        const out  = (level === "error") ? console.error
                   : (level === "warn")  ? console.warn
                                         : console.log;
        meta !== undefined ? out(text, meta) : out(text);
    }

    _info(msg, meta)  { this._logFn("info",  msg, meta); }
    _warn(msg, meta)  { this._logFn("warn",  msg, meta); }
    _error(msg, meta) { this._logFn("error", msg, meta); }

    get _checkpointPath() {
        return this._filePath + ".checkpoint.json";
    }

    _quarantinePath() {
        const ts   = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
        const base = this._filePath.replace(/\.json$/i, "");
        return `${base}.quarantine-${ts}.json`;
    }

    async load() {
        if (this._loaded)      return;
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._doLoad().finally(() => {
            this._loadPromise = null;
        });

        return this._loadPromise;
    }

    async _doLoad() {
        let value;
        let source = "main";

        try {
            const str = await this._readFileSafe(this._filePath);
            if (str === null) {
                if (this._enableCheckpoint) {
                    source = "checkpoint";
                    this._info("File not found — trying checkpoint before default");
                } else {
                    value  = this._defaultValue();
                    source = "default";
                    this._info("File not found — starting with default value");
                }
            } else {
                value = this._parse(str);
            }
        } catch (err) {
            if (!this._enableCheckpoint) {
                throw err;
            }
            this._warn(`Main file unreadable (${err.message}) — trying checkpoint`);
            source = "checkpoint";
        }

        if (source === "checkpoint") {
            try {
                const str = await this._readFileSafe(this._checkpointPath);
                if (str !== null) {
                    value = this._parse(str);
                    this._s.recoveryUsedOnLoad = true;
                    this._warn("Loaded from checkpoint — main file was unreadable");
                } else {
                    value  = this._defaultValue();
                    source = "default";
                    this._warn("No checkpoint found — starting with default value");
                }
            } catch (err) {
                value  = this._defaultValue();
                source = "default";
                this._warn(`Checkpoint also failed (${err.message}) — starting with default value`);
            }
        }

        this._value       = value;
        this._prevMetrics = this._auditMetrics ? this._auditMetrics(value) : null;
        this._loaded      = true;
        this._s.loadedAt  = new Date().toISOString();
        this._s.loadSource = source;

        const extra = this._prevMetrics ? ` — ${JSON.stringify(this._prevMetrics)}` : "";
        this._info(`Loaded from ${source}${extra}`);

        if (this._backupDir && source !== "default") {
            this._ensureInitialBackup();
        }
    }

    _ensureInitialBackup() {
        const base = path.basename(this._filePath, ".json");
        (async () => {
            try {
                const entries  = await fsp.readdir(this._backupDir).catch(() => []);
                const hasBackup = entries.some(
                    (e) => e.startsWith(`${base}-`) && e.endsWith(".json")
                );
                if (!hasBackup) {
                    this._info("No existing backup found — creating initial backup");
                    await this._doBackup(this._serialize(this._value));
                }
            } catch (err) {
                this._warn(`Initial backup check failed: ${err.message}`);
            }
        })();
    }

    async _readFileSafe(filePath) {
        try {
            return String(await fsp.readFile(filePath));
        } catch (err) {
            if (err?.code === "ENOENT") return null;
            throw err;
        }
    }

    get() {
        if (!this._loaded) {
            throw new Error(`[ManagedFile ${this._name}] not loaded — call await load() first`);
        }
        return this._value;
    }

    async set(newValue) {
        if (!this._loaded) {
            throw new Error(`[ManagedFile ${this._name}] not loaded — call await load() first`);
        }

        if (this._audit && this._prevMetrics !== null) {
            const result = this._audit(this._prevMetrics, newValue);
            if (!result.ok) {
                this._s.auditViolationCount++;
                this._error(`AUDIT VIOLATION: ${result.reason}`);

                try {
                    const qPath = this._quarantinePath();
                    await this._atomicWrite(qPath, this._serialize(newValue));
                    this._warn(`Rejected data quarantined → ${path.basename(qPath)}`);
                    this._pruneQuarantines().catch(() => {});
                } catch (qErr) {
                    this._error(`Failed to write quarantine file: ${qErr.message}`);
                }

                throw new Error(`[ManagedFile ${this._name}] Audit violation: ${result.reason}`);
            }
        }

        this._value = newValue;
        this._markDirty();
    }

    _markDirty() {
        this._dirty = true;
        if (this._flushTimer !== null) return;

        const delay = this._lastFlushedAt === 0
            ? this._maxFlushIntervalMs
            : Math.max(0, this._maxFlushIntervalMs - (Date.now() - this._lastFlushedAt));

        this._nextFlushAt = Date.now() + delay;
        this._flushTimer  = setTimeout(() => {
            this._flushTimer  = null;
            this._nextFlushAt = 0;
            this._enqueueFlush().catch((err) => {
                this._error(`Scheduled flush failed: ${err.message}`);
            });
        }, delay);
    }

    async flush() {
        if (this._flushTimer !== null) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        if (!this._dirty) return;
        return this._enqueueFlush();
    }

    _enqueueFlush() {
        const next = this._writeChain.then(() => this._doFlush());
        this._writeChain = next.catch(() => {});
        return next;
    }

    async _doFlush() {
        if (!this._dirty) return;
        this._dirty = false;

        const value      = this._value;
        const serialized = this._serialize(value);

        if (this._audit && this._prevMetrics !== null) {
            const result = this._audit(this._prevMetrics, value);
            if (!result.ok) {
                this._s.auditViolationCount++;
                this._error(`FLUSH AUDIT VIOLATION: ${result.reason} — real file untouched`);
                try {
                    const qPath = this._quarantinePath();
                    await this._atomicWrite(qPath, serialized);
                    this._warn(`Quarantined flush data → ${path.basename(qPath)}`);
                    this._pruneQuarantines().catch(() => {});
                } catch (qErr) {
                    this._error(`Failed to write quarantine file: ${qErr.message}`);
                }
                return;
            }
        }

        let writeErr;
        for (let i = 0; i <= this._retryDelays.length; i++) {
            try {
                await this._atomicWrite(this._filePath, serialized);
                writeErr = null;
                break;
            } catch (err) {
                writeErr = err;
                if (i === this._retryDelays.length) break;
                this._warn(`Write attempt ${i + 1} failed (${err.message}), retrying in ${this._retryDelays[i]} ms`);
                await new Promise((r) => setTimeout(r, this._retryDelays[i]));
            }
        }
        if (writeErr) {
            this._dirty = true;
            this._error(`Write failed after all retries: ${writeErr.message}`);
            throw writeErr;
        }

        if (this._auditMetrics) {
            this._prevMetrics = this._auditMetrics(value);
        }
        this._lastFlushedAt = Date.now();
        this._s.writeCount++;

        const extra = this._prevMetrics ? ` — ${JSON.stringify(this._prevMetrics)}` : "";
        this._info(`Flushed (write #${this._s.writeCount})${extra}`);

        if (this._enableCheckpoint) {
            this._pendingCheckpoint = this._atomicWrite(this._checkpointPath, serialized).catch((err) => {
                this._warn(`Checkpoint write failed: ${err.message}`);
            });
        }

        const backupRef = this._lastBackupAt || this._createdAt;
        if (this._backupDir && Date.now() - backupRef >= this._backupIntervalMs) {
            this._pendingBackup = this._doBackup(serialized).catch((err) => {
                this._warn(`Backup failed: ${err.message}`);
            });
        }
    }

    async backup() {
        if (!this._loaded) return;
        await this._doBackup(this._serialize(this._value));
    }

    async _doBackup(serialized) {
        if (!this._backupDir) return;
        await fsp.mkdir(this._backupDir, { recursive: true });

        const ts         = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
        const base       = path.basename(this._filePath, ".json");
        const backupPath = path.join(this._backupDir, `${base}-${ts}.json`);

        await this._atomicWrite(backupPath, serialized);

        this._lastBackupAt      = Date.now();
        this._s.backupCount++;
        this._s.lastBackupAt    = new Date().toISOString();
        this._info(`Backup written → ${path.basename(backupPath)}`);

        await this._pruneBackups();
    }

    async _pruneBackups() {
        if (!this._backupDir) return;
        try {
            const base    = path.basename(this._filePath, ".json");
            const entries = await fsp.readdir(this._backupDir);
            const mine    = entries
                .filter((e) => e.startsWith(`${base}-`) && e.endsWith(".json"))
                .sort();
            const excess = mine.length - this._backupKeep;
            if (excess > 0) {
                for (let i = 0; i < excess; i++) {
                    await fsp.unlink(path.join(this._backupDir, mine[i])).catch(() => {});
                }
                this._info(`Pruned ${excess} old backup(s)`);
            }
        } catch (err) {
            this._warn(`Failed to prune backups: ${err.message}`);
        }
    }

    async _pruneQuarantines() {
        if (!this._quarantineKeep) return;
        try {
            const dir        = path.dirname(this._filePath);
            const base       = path.basename(this._filePath, ".json");
            const entries    = await fsp.readdir(dir);
            const quarantines = entries
                .filter((e) => e.startsWith(`${base}.quarantine-`) && e.endsWith(".json"))
                .sort();
            const excess = quarantines.length - this._quarantineKeep;
            if (excess > 0) {
                for (let i = 0; i < excess; i++) {
                    await fsp.unlink(path.join(dir, quarantines[i])).catch(() => {});
                }
            }
        } catch (err) {
            this._warn(`Failed to prune quarantine files: ${err.message}`);
        }
    }

    async _atomicWrite(filePath, content) {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const tmp = filePath + ".tmp";
        try {
            const fh = await fsp.open(tmp, "w");
            try {
                await fh.writeFile(content);
                try { await fh.sync(); } catch { /* best-effort fsync */ }
            } finally {
                try { await fh.close(); } catch { /* ignore */ }
            }
            await fsp.rename(tmp, filePath);
        } catch (err) {
            try { await fsp.unlink(tmp); } catch { /* ignore */ }
            throw err;
        }
    }

    getStats() {
        return {
            name:               this._name,
            filePath:           this._filePath,
            loaded:             this._loaded,
            loadedAt:           this._s.loadedAt,
            loadSource:         this._s.loadSource,
            recoveryUsedOnLoad: this._s.recoveryUsedOnLoad,
            dirty:              this._dirty,
            pendingFlushInMs:   this._flushTimer !== null
                ? Math.max(0, this._nextFlushAt - Date.now())
                : null,
            lastFlushedAt:      this._lastFlushedAt > 0
                ? new Date(this._lastFlushedAt).toISOString()
                : null,
            writeCount:          this._s.writeCount,
            auditViolationCount: this._s.auditViolationCount,
            lastBackupAt:        this._s.lastBackupAt,
            backupCount:         this._s.backupCount,
            prevMetrics:         this._prevMetrics,
        };
    }

    async close() {
        if (this._flushTimer !== null) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        if (this._dirty) {
            this._info("Flushing on close...");
            await this._enqueueFlush();
        }
        await Promise.allSettled([
            this._pendingCheckpoint ?? Promise.resolve(),
            this._pendingBackup     ?? Promise.resolve(),
        ]);
        this._info("Closed");
    }
}

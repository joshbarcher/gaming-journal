// Migration: rename flag key 'onHold' → 'inProgress' in flags.json
// Run once: node --env-file .env scripts/migrate-flags.js

import path from 'node:path'
import fsp from 'node:fs/promises'

const dataDir = process.env.DATA_DIR
if (!dataDir) { console.error('DATA_DIR must be set'); process.exit(1) }

const filePath = path.join(dataDir, 'gaming-journal', 'flags.json')

const raw = await fsp.readFile(filePath, 'utf8')
const data = JSON.parse(raw)

let changed = 0
for (const [appid, flags] of Object.entries(data)) {
    if ('onHold' in flags) {
        flags.inProgress = flags.onHold
        delete flags.onHold
        changed++
    }
}

if (changed === 0) {
    console.log('Nothing to migrate — no onHold keys found.')
    process.exit(0)
}

const tmp = filePath + '.tmp'
await fsp.writeFile(tmp, JSON.stringify(data, null, 4))
await fsp.rename(tmp, filePath)
console.log(`Migrated ${changed} game(s): onHold → inProgress`)

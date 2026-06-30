// Migration: add missing id/state fields to tasks in progress pages and bars/steps in progress-bars pages
// Run once: node --env-file .env scripts/migrate-task-ids.js

import path from 'node:path'
import fsp from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const dataDir = process.env.DATA_DIR
if (!dataDir) { console.error('DATA_DIR must be set'); process.exit(1) }

const filePath = path.join(dataDir, 'gaming-journal', 'pages.json')

const raw = await fsp.readFile(filePath, 'utf8')
const data = JSON.parse(raw)

let pagesFixed = 0
let tasksFixed = 0
let barsFixed = 0
let stepsFixed = 0

for (const page of data.pages ?? []) {
    let pageChanged = false

    if (page.type === 'progress' && Array.isArray(page.tasks)) {
        for (const task of page.tasks) {
            if (!task.id) {
                task.id = randomUUID()
                task.state = task.state ?? null
                tasksFixed++
                pageChanged = true
            }
        }
    }

    if (page.type === 'progress-bars' && Array.isArray(page.bars)) {
        for (const bar of page.bars) {
            if (!bar.id) {
                bar.id = randomUUID()
                barsFixed++
                pageChanged = true
            }
            if (Array.isArray(bar.steps)) {
                for (const step of bar.steps) {
                    if (!step.id) {
                        step.id = randomUUID()
                        step.state = step.state ?? null
                        stepsFixed++
                        pageChanged = true
                    }
                }
            }
        }
    }

    if (pageChanged) {
        pagesFixed++
        console.log(`  fixed: [${page.type}] "${page.title}" (${page.id})`)
    }
}

if (pagesFixed === 0) {
    console.log('No missing IDs found — nothing to do.')
    process.exit(0)
}

const backup = filePath + '.bak'
await fsp.copyFile(filePath, backup)
console.log(`\nBacked up original to ${backup}`)

await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
console.log(`Wrote ${filePath}`)
console.log(`\nSummary: ${pagesFixed} page(s) updated — ${tasksFixed} task(s), ${barsFixed} bar(s), ${stepsFixed} step(s) assigned new IDs`)

import { createCoverageHandler } from '../../../coverage.js'

export const prerender = false
export const GET = createCoverageHandler(process.cwd(), { name: 'gaming-journal' })

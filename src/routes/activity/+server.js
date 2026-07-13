import { createActivityHandler } from '../../../activity.js'

// Reports this instance's network + NAS-write activity (see activity.js). The
// tracker is installed in src/hooks.server.ts; this route just serialises it.
export const GET = createActivityHandler({ name: 'gaming-journal' })

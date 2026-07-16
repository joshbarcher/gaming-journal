// Where the guide fetch/parse tools live on disk.
//
// fetch-guide.js / parse-guide.js run as SPAWNED node child processes (relay
// convention: they own their Puppeteer lifecycle and force process.exit(0) on
// completion — the parse-guide hang fix). They are plain .js source files, not
// bundled server modules, so the spawn path must point at the source tree.
// import.meta.dirname is unreliable here (the adapter-node build relocates
// modules into build/server/chunks), so resolve from the process cwd — both
// `vite dev` and the prod pm2 process run from the app checkout root, which
// always carries src/.
import { join } from 'node:path';

export const TOOLS_DIR = join(process.cwd(), 'src', 'lib', 'server', 'relay', 'guides', 'tools');

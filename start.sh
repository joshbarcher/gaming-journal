#!/bin/bash
set -e
# Building happens upstream (process-mgr's update step runs `npm run build`
# before restarting) - not here. This used to build inline on every start,
# but pm2 here is launched via nvm without npm on its PATH, so `npm run
# build` failed with ENOENT and crashed this script before the server ever
# started - the previous build's process just kept serving.
# .env.local (untracked) carries secrets + per-cutover-window flips for the
# relay fold-in — see docs/relay-fold-in.md. Optional so fresh clones still boot.
exec node --env-file=/home/jarcher/gaming-journal/.env --env-file=/home/jarcher/gaming-journal/.env.production --env-file-if-exists=/home/jarcher/gaming-journal/.env.local server.js

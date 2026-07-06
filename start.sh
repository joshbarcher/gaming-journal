#!/bin/bash
set -e
# Building happens upstream (process-mgr's update step runs `npm run build`
# before restarting) - not here. This used to build inline on every start,
# but pm2 here is launched via nvm without npm on its PATH, so `npm run
# build` failed with ENOENT and crashed this script before the server ever
# started - the previous build's process just kept serving.
exec node --env-file=/home/jarcher/gaming-journal/.env server.js

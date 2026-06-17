#!/bin/bash
set -e
npm run build
exec node --env-file=/home/jarcher/gaming-journal/.env server.js

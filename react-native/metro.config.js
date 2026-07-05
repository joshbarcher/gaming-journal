// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..'); // gaming-journal repo root

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// contracts/ (shared Zod schemas, see PLAN.md "Type contracts & verification") is consumed as a
// local `file:` dependency — "gaming-journal-contracts" in package.json — which npm symlinks into
// node_modules/. Metro follows that symlink back to the real folder one level up in the
// gaming-journal repo root, so that real location needs to be a watched root too.
config.watchFolders = [workspaceRoot];

module.exports = config;

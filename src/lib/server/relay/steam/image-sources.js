// Ported verbatim from relay-server src/services/steam/image-sources.js
// (docs/relay-fold-in.md §6). Import rewrites only.
import path from 'node:path';
import { ManagedFile } from '../shared/managed-file.js';
import { featureDir } from '../shared/data-root.js';

function sourcesPath() {
    return path.join(featureDir('steam'), 'images', 'sources.json');
}

export function makeSourcesFile() {
    return new ManagedFile({
        filePath:     sourcesPath(),
        name:         'steam-image-sources',
        defaultValue: () => ({ games: {}, screenshots: {}, achievements: {} }),
    });
}

let _sourcesFile = null;

export async function getSourcesFile() {
    if (!_sourcesFile) {
        _sourcesFile = makeSourcesFile();
        await _sourcesFile.load();
    }
    return _sourcesFile;
}

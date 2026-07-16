// Ported verbatim from relay-server src/services/steam/discover.service.js
// (docs/relay-fold-in.md §6).
import { getAllPaged, getTabPaged } from './featured-history.service.js';

/** @param {string|null} [tab] @param {number} [page] */
export async function getFeatured(tab = null, page = 1) {
    return tab ? getTabPaged(tab, page) : getAllPaged(page);
}

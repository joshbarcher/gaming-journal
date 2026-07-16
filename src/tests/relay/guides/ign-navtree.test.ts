// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/ign-navtree.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { extractSidebarBranch, buildNavTreeFromBranches } from '../../../lib/server/relay/guides/ign/adapter.js';

const WIKI = 'persona-3-reload';

// IGN's sidebar markup: a `.sidebar-section.toc-N` whose first <a> is the page
// whose branch is expanded, followed by its children. Collapsed child groups
// render as <button> with no href — their own children only exist client-side.
const sidebar = (...rows) => cheerio.load(`
    <aside><nav>
        <span class="stack sidebar-section"><button><div class="interface">Find in guide</div></button>
            <a href="/games/${WIKI}"><div class="interface">Game Info</div></a></span>
        <span class="stack sidebar-section toc-1">${rows.join('')}</span>
    </nav></aside>
`);
const link  = (page, label) => `<a href="/wikis/${WIKI}/${page}"><div class="interface">${label}</div></a>`;
const root  = label => `<a href="/wikis/${WIKI}"><div class="interface">${label}</div></a>`;
const group = label => `<button><div class="interface">${label}</div></button>`;

const pages = slugs => slugs.map(s => ({ slug: s, label: s }));

// ── extractSidebarBranch ──────────────────────────────────────────────────────

describe('extractSidebarBranch', () => {
    it('reads the head and its ordered children from the expanded branch', () => {
        const $ = sidebar(
            link('Calendar_Walkthrough', 'Calendar Walkthrough'),
            link('April_Walkthrough', 'April Walkthrough'),
            link('June_Walkthrough', 'June Walkthrough'),
        );
        assert.deepEqual(extractSidebarBranch($, WIKI), {
            head: 'calendar-walkthrough',
            children: [
                { slug: 'april-walkthrough', label: 'April Walkthrough', isGroup: false },
                { slug: 'june-walkthrough',  label: 'June Walkthrough',  isGroup: false },
            ],
        });
    });

    it('reports head:null on the index page, whose head links the wiki root', () => {
        const $ = sidebar(root('Persona 3 Reload Guide'), group('Boss Guides'));
        const branch = extractSidebarBranch($, WIKI);
        assert.equal(branch.head, null);
        assert.deepEqual(branch.children, [{ slug: 'boss-guides', label: 'Boss Guides', isGroup: true }]);
    });

    it('recovers a collapsed group\'s slug from its button label', () => {
        const $ = sidebar(link('Boss_Guides', 'Boss Guides'), group('Tartarus Bosses'));
        assert.deepEqual(extractSidebarBranch($, WIKI).children,
            [{ slug: 'tartarus-bosses', label: 'Tartarus Bosses', isGroup: true }]);
    });

    it('ignores sidebar chrome that links off-wiki', () => {
        const $ = sidebar(link('Boss_Guides', 'Boss Guides'), link('Endings', 'Endings'));
        // "Game Info" (/games/…) lives in the non-toc section and must not appear.
        assert.deepEqual(extractSidebarBranch($, WIKI).children.map(c => c.slug), ['endings']);
    });

    it('returns null when there is no toc section, or no children', () => {
        assert.equal(extractSidebarBranch(cheerio.load('<aside></aside>'), WIKI), null);
        assert.equal(extractSidebarBranch(sidebar(link('Endings', 'Endings')), WIKI), null);
    });

    it('returns null when the head is a collapsed group rather than a link', () => {
        assert.equal(extractSidebarBranch(sidebar(group('Boss Guides'), link('X', 'X')), WIKI), null);
    });
});

// ── buildNavTreeFromBranches ──────────────────────────────────────────────────

const branch = (head, children) => ({ head, children });
const child  = (slug, label, isGroup = false) => ({ slug, label, isGroup });

describe('buildNavTreeFromBranches', () => {
    it('nests groups within groups, preserving IGN\'s order', () => {
        // The reported bug: June belongs to Calendar, which belongs to Walkthrough.
        const { navTree } = buildNavTreeFromBranches([
            branch(null, [child('walkthrough', 'Walkthrough', true), child('endings', 'Endings')]),
            branch('walkthrough', [child('calendar', 'Calendar', true)]),
            branch('calendar', [child('may', 'May'), child('june', 'June'), child('july', 'July')]),
        ], pages(['walkthrough', 'endings', 'calendar', 'may', 'june', 'july']));

        assert.deepEqual(navTree, [
            {
                type: 'group', slug: 'walkthrough', label: 'Walkthrough',
                children: [{
                    type: 'group', slug: 'calendar', label: 'Calendar',
                    children: [
                        { type: 'link', slug: 'may',  label: 'May' },
                        { type: 'link', slug: 'june', label: 'June' },
                        { type: 'link', slug: 'july', label: 'July' },
                    ],
                }],
            },
            { type: 'link', slug: 'endings', label: 'Endings' },
        ]);
    });

    it('returns null when no branch describes the root', () => {
        const built = buildNavTreeFromBranches([branch('calendar', [child('june', 'June')])], pages(['june']));
        assert.equal(built.navTree, null);
    });

    it('drops groups IGN lists but the crawl never fetched, and reports them', () => {
        const built = buildNavTreeFromBranches(
            [branch(null, [child('endings', 'Endings'), child('episode-aigis', 'Episode Aigis', true)])],
            pages(['endings']),
        );
        assert.deepEqual(built.navTree, [{ type: 'link', slug: 'endings', label: 'Endings' }]);
        assert.deepEqual(built.unfetched, ['episode-aigis']);
    });

    it('reports fetched pages absent from the TOC as orphans, without placing them', () => {
        // e.g. "Arqa Part 1" — a stale title that redirects to "Arqa (Floors 23 - 43)".
        const built = buildNavTreeFromBranches(
            [branch(null, [child('arqa-floors-23-43', 'Arqa (Floors 23 - 43)')])],
            pages(['arqa-floors-23-43', 'arqa-part-1']),
        );
        assert.deepEqual(built.navTree.map(n => n.slug), ['arqa-floors-23-43']);
        assert.deepEqual(built.orphans, ['arqa-part-1']);
    });

    it('keeps a page\'s first placement when two branches both claim it', () => {
        const { navTree } = buildNavTreeFromBranches([
            branch(null, [child('a', 'A', true), child('b', 'B', true)]),
            branch('a', [child('shared', 'Shared')]),
            branch('b', [child('shared', 'Shared')]),
        ], pages(['a', 'b', 'shared']));

        assert.deepEqual(navTree[0].children.map(n => n.slug), ['shared']);
        // 'b' has no remaining children, so it degrades from group to link.
        assert.deepEqual(navTree[1], { type: 'link', slug: 'b', label: 'B' });
    });

    it('does not recurse forever when a branch names one of its own ancestors', () => {
        const { navTree } = buildNavTreeFromBranches([
            branch(null, [child('a', 'A', true)]),
            branch('a', [child('b', 'B', true)]),
            branch('b', [child('a', 'A', true), child('leaf', 'Leaf')]),
        ], pages(['a', 'b', 'leaf']));

        assert.deepEqual(navTree, [{
            type: 'group', slug: 'a', label: 'A',
            children: [{
                type: 'group', slug: 'b', label: 'B',
                children: [{ type: 'link', slug: 'leaf', label: 'Leaf' }],
            }],
        }]);
    });

    it('demotes a childless group to a plain link', () => {
        const { navTree } = buildNavTreeFromBranches(
            [branch(null, [child('boss-guides', 'Boss Guides', true)])],
            pages(['boss-guides']),
        );
        assert.deepEqual(navTree, [{ type: 'link', slug: 'boss-guides', label: 'Boss Guides' }]);
    });
});

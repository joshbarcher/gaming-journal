// NOT PORTED — relay-parallel. relay-server src/tests/metrics/render-sources.test.js
// guards the delta-patching contract of the relay dashboard PAGE
// (src/public/dashboard/dashboard.js + dashboard.css): chart palette CVD
// contrast, `.spark-value` class stability across re-renders, CHART_SERIES
// colour-slot coverage.
//
// The dashboard page itself is relay-internal and does not migrate — only the
// /api/dashboard JSON routes moved here (Wave 3 Batch C2). The page (and this
// suite, in the relay repo) keeps running against the relay until the
// decommission phase decides the page's replacement; port the suite then,
// alongside whatever renders the journal-side dashboard.
import { describe, it } from 'vitest';

describe('render-sources (relay dashboard page)', () => {
    it.skip('suite stays in relay-server until the dashboard page is absorbed or retired (see header)', () => {});
});

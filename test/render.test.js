/**
 * What the rendered pages promise to crawlers.
 *
 * These assertions are cheap and the mistakes they catch are expensive and
 * slow to notice: a wrong canonical or a missing noindex doesn't break
 * anything, it just quietly costs you the ranking you built the pages for, and
 * you find out weeks later.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { canonicalOrigin, PROFILES } from '../src/config.js';
import { renderIndexPage, renderLocationPage, escapeHtml } from '../src/render/html.js';
import { stationTideStats } from '../src/profiles/tidepooling.js';
import { forecastFixtureDays, loadTideEvents } from './helpers.js';

const tideStats = stationTideStats(loadTideEvents());

function pageFor(profile, { noindex = false } = {}) {
  const days = forecastFixtureDays({
    profile,
    settings: profile.id === 'tidepooling' ? { tideStats } : {},
    days: 5,
  });
  const best = days.reduce((a, b) => (b.score > a.score ? b : a));
  return renderLocationPage({
    profile,
    location: profile.locations[0],
    days,
    best,
    noindex,
  });
}

describe('rendered pages', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const location = profile.locations[0];
    const expected = `${canonicalOrigin(profile)}/${profile.pathPrefix}/${location.slug}/`;

    test(`${name}: canonical points at its own site, never the serving host`, () => {
      const html = pageFor(profile);
      assert.match(html, new RegExp(`<link rel="canonical" href="${expected}">`));
      assert.match(html, new RegExp(`<meta property="og:url" content="${expected}">`));
      // The other site's domain must not appear anywhere in the markup.
      const other = Object.values(PROFILES).find((candidate) => candidate.id !== profile.id);
      assert.ok(!html.includes(other.hostnames[0]), `${name} leaks ${other.hostnames[0]}`);
    });

    test(`${name}: production pages are indexable, previews are not`, () => {
      assert.ok(!pageFor(profile).includes('noindex'), 'production page carries noindex');
      assert.match(pageFor(profile, { noindex: true }), /<meta name="robots" content="noindex,nofollow">/);
      assert.match(
        renderIndexPage({ profile, noindex: true }),
        /<meta name="robots" content="noindex,nofollow">/,
      );
    });

    test(`${name}: the answer is in the HTML, not left to a script`, () => {
      const html = pageFor(profile);
      assert.ok(!html.includes('<script src'), 'content pages should ship no script');
      // One row per day, in a real table a crawler can read.
      assert.equal((html.match(/<tr>/g) ?? []).length, 6, 'expected a header row plus five days');
      assert.match(html, /<time datetime="\d{4}-\d{2}-\d{2}/);
      // The lead sentence sits in the first paragraph, quotable on its own.
      const lead = html.match(/<h1>.*?<\/h1>\s*<p>(.*?)<\/p>/s)[1].trim();
      assert.ok(lead.includes(location.name) && lead.length > 40, `weak lead: ${lead}`);
    });

    test(`${name}: JSON-LD parses and carries the answer`, () => {
      const raw = pageFor(profile).match(
        /<script type="application\/ld\+json">(.*?)<\/script>/s,
      )[1];
      const graph = JSON.parse(raw)['@graph'];
      const types = graph.map((node) => node['@type']);
      assert.ok(types.includes('Dataset') && types.includes('FAQPage'), `types: ${types}`);
      const faq = graph.find((node) => node['@type'] === 'FAQPage');
      assert.ok(faq.mainEntity[0].acceptedAnswer.text.includes(location.name));
    });
  }

  test('escapeHtml closes the obvious hole', () => {
    assert.equal(escapeHtml(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;');
  });
});

/**
 * Favicons.
 *
 * Two failures are worth pinning here, because neither shows up in local dev.
 * The shell hard-codes the fishing icons and the Worker swaps the profile id
 * into the path, so a rename on one side leaves times4tidepooling.com quietly
 * wearing a fish hook. And an SVG that fails to parse renders as nothing at
 * all: an XML comment can't contain a double hyphen, which is easy to write by
 * accident when the comment is talking about CSS custom properties.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROFILES, iconLinksHtml, swapIconProfile } from '../src/config.js';

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(path(p), 'utf8');
/** The `href` of every icon link in a chunk of HTML. */
const iconHrefs = (html) => [...html.matchAll(/<link[^>]+href="(\/icons\/[^"]+)"/g)].map((m) => m[1]);

describe('favicons', () => {
  test('every file a profile asks for is actually there', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const href of iconHrefs(iconLinksHtml(profile))) {
        assert.ok(existsSync(path(`..${href}`)), `${profile.id} points at a missing ${href}`);
      }
    }
  });

  test('each site names its own icons, and only its own', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const href of iconHrefs(iconLinksHtml(profile))) {
        assert.match(href, new RegExp(`^/icons/${profile.id}/`), `${href} is not ${profile.id}'s`);
      }
    }
  });

  test('the SVGs parse: no double hyphen inside a comment', () => {
    for (const profile of Object.values(PROFILES)) {
      const svg = read(`../icons/${profile.id}/icon.svg`);
      for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
        assert.doesNotMatch(body, /--/, `${profile.id}/icon.svg has a comment XML can't parse`);
      }
      assert.match(svg, /^<svg[\s>]/, `${profile.id}/icon.svg must start with the svg element`);
    }
  });

  test("the rewrite turns the shell's icons into any other site's", () => {
    // The shell can only name one set of files, so the swap has to work for
    // every href in it; a missed one serves the wrong site's icon.
    const shellHrefs = iconHrefs(read('../index.html'));
    assert.ok(shellHrefs.length > 0, 'the shell declares no icons at all');

    for (const href of shellHrefs) {
      assert.match(href, /^\/icons\/fishing\//, 'the shell should ship the default profile');
      for (const profile of Object.values(PROFILES)) {
        const swapped = swapIconProfile(href, profile);
        assert.ok(existsSync(path(`..${swapped}`)), `rewriting ${href} for ${profile.id} lands nowhere`);
      }
    }
  });

  test('the swap goes both ways, not just away from fishing', () => {
    // The Worker serves the tidepooling shell to a browser that then runs
    // main.js; if the swap only recognised `fishing` in the path, the client
    // could never put the icons back, and a `?profile=` preview would show one
    // site's wording under the other's icon.
    const [fishing, tidepooling] = [PROFILES.fishing, PROFILES.tidepooling];
    const there = swapIconProfile('/icons/fishing/icon.svg', tidepooling);
    assert.equal(there, '/icons/tidepooling/icon.svg');
    assert.equal(swapIconProfile(there, fishing), '/icons/fishing/icon.svg');
  });

  test('both render paths declare icons, and the client mirrors the swap', () => {
    // Same drift risk as the support link: the Worker rewrites the shell,
    // render/html.js builds its own head, and main.js covers `?profile=`.
    assert.match(read('../src/render/html.js'), /iconLinksHtml\(profile\)/);
    assert.match(read('../src/worker.js'), /link\[href\^="\/icons\/"\]/);
    assert.match(read('../src/main.js'), /link\[href\^="\/icons\/"\]/);
  });
});

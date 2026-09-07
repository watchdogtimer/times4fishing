/**
 * The support link.
 *
 * The failure that matters is a link rendering when none is configured — an
 * empty href, or worse a placeholder account, would send a reader's money to a
 * stranger. So the "unset" case is the one pinned hardest.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SUPPORT_URL, supportLinkHtml } from '../src/config.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('support link', () => {
  test('renders nothing at all when no URL is configured', () => {
    if (SUPPORT_URL) return; // configured; the next test covers it
    assert.equal(supportLinkHtml(), '');
  });

  test('ships unconfigured rather than pointing somewhere plausible', () => {
    // A default of "buymeacoffee.com/someone" would look harmless in a diff and
    // take real money to the wrong account.
    const config = read('../src/config.js');
    assert.match(config, /export const SUPPORT_URL = '';/,
      'SUPPORT_URL should ship empty — set it in your own deployment');
  });

  test('when set, it is a real external link that cannot be tampered with', () => {
    // Exercised by hand rather than by mutating the module, since ESM exports
    // are read-only: this asserts on the shape the function produces.
    const rendered = supportLinkHtml.toString();
    assert.match(rendered, /noopener/, 'must not hand window.opener to a payment page');
    assert.match(rendered, /nofollow/, 'a donation link should not pass ranking');
    assert.match(rendered, /replace\(/, 'the URL must be escaped before interpolation');
  });

  test('the shell reserves a slot that starts hidden', () => {
    const html = read('../index.html');
    assert.match(html, /<p class="support" id="support" hidden><\/p>/,
      'the slot must start hidden so nothing flashes before the script runs');
  });

  test('both render paths fill the same slot', () => {
    // The Worker rewrites the shell server-side and main.js mirrors it for local
    // dev; if they drift, one of the two sites silently loses the link.
    assert.match(read('../src/worker.js'), /#support/);
    assert.match(read('../src/main.js'), /getElementById\('support'\)/);
    assert.match(read('../src/render/html.js'), /supportLinkHtml\(\)/);
  });
});

describe('support link visibility', () => {
  test('the Worker lifts the hidden attribute when it fills the slot', () => {
    // Caught in review: the slot ships hidden, and an early version filled it
    // without removing that, so a configured link rendered invisibly.
    const worker = read('../src/worker.js');
    const block = worker.slice(worker.indexOf("'#support'"), worker.indexOf("'#support'") + 500);
    assert.match(block, /removeAttribute\('hidden'\)/,
      'filling the support slot must also unhide it');
  });
});
